"""Preview renderer for the LEGO squad built by build_lego_squad.jsx.

Reads the character list, rig and animations (SQUAD block) from the .jsx and the vector parts from
vectors/<NAME>.jsxinc, and mirrors the AE comp: base fill + stacked colour prints + uniform outline
stroke per part, parenting (hands ride on the arms) and breathing. No motion blur, like the comp.

Usage: python3 render_preview.py <NAME|all> [--out-dir preview] [--frames 0,30] [--static out.png]
"""
import argparse
import json
import math
import os
import re
import subprocess

import cv2
import imageio_ffmpeg
import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = open(os.path.join(ROOT, "build_lego_squad.jsx"), encoding="utf-8-sig").read() if os.path.exists(
    os.path.join(ROOT, "build_lego_squad.jsx")) else ""
SS = 3


def js_block(name, opener):
    i = SRC.index("var %s = %s" % (name, opener)) + len("var %s = " % name)
    close = {"{": "}", "[": "]"}[opener]
    depth, j = 0, i
    while True:
        depth += (SRC[j] == opener) - (SRC[j] == close)
        if depth == 0:
            break
        j += 1
    body = re.sub(r"//[^\n]*", "", SRC[i:j + 1])
    body = re.sub(r"([{,]\s*)([A-Za-z_]\w*)\s*:", r'\1"\2":', body)
    return json.loads(body)


def load_vec(name):
    t = open(os.path.join(ROOT, "vectors", name + ".jsxinc")).read().split("\n", 1)[1].strip()
    return json.loads(t[1:-1])


def _bez(u, x1, y1, x2, y2):
    lo, hi = 0.0, 1.0
    for _ in range(40):
        s = (lo + hi) / 2
        x = 3 * (1 - s) ** 2 * s * x1 + 3 * (1 - s) * s * s * x2 + s ** 3
        lo, hi = (s, hi) if x < u else (lo, s)
    s = (lo + hi) / 2
    return 3 * (1 - s) ** 2 * s * y1 + 3 * (1 - s) * s * s * y2 + s ** 3


def kv(keys, t, default):
    if not keys:
        return np.array(default, float)
    if t <= keys[0][0]:
        return np.array(keys[0][1], float)
    if t >= keys[-1][0]:
        return np.array(keys[-1][1], float)
    for a, b in zip(keys, keys[1:]):
        if a[0] <= t <= b[0]:
            ea, eb = (a[2] if len(a) > 2 else [66, 66]), (b[2] if len(b) > 2 else [66, 66])
            p = _bez((t - a[0]) / (b[0] - a[0]), ea[1] / 100, 0, 1 - eb[0] / 100, 1)
            return np.array(a[1], float) + (np.array(b[1], float) - np.array(a[1], float)) * p


def affine(pos, rot, scale, anchor):
    r = math.radians(rot)
    c, s = math.cos(r), math.sin(r)
    M = np.array([[c * scale[0], -s * scale[1], 0], [s * scale[0], c * scale[1], 0], [0, 0, 1.0]])
    M[0, 2] = pos[0] - (M[0, 0] * anchor[0] + M[0, 1] * anchor[1])
    M[1, 2] = pos[1] - (M[1, 0] * anchor[0] + M[1, 1] * anchor[1])
    return M


def flatten(p, M, n=12):
    v, I, O = np.array(p["v"], float), np.array(p["i"], float), np.array(p["o"], float)
    pts, m = [], len(v)
    for k in range(m):
        p0, p3 = v[k], v[(k + 1) % m]
        c1, c2 = p0 + O[k], p3 + I[(k + 1) % m]
        ts = [0.0] if (not O[k].any() and not I[(k + 1) % m].any()) else np.linspace(0, 1, n, endpoint=False)
        for t in ts:
            pts.append((1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * c1 + 3 * (1 - t) * t * t * c2 + t ** 3 * p3)
    return np.array(pts) @ M[:2, :2].T + M[:2, 2]


def raster_part(part, lw, outline, M=np.eye(3)):
    """premultiplied RGBA sprite of one part + canvas offset; M = path transform"""
    groups = [("base", part["base"]["color"], part["base"]["paths"])] + \
             [("print", pr["color"], pr["paths"]) for pr in reversed(part["prints"])]
    polys = [[flatten(p, M) for p in paths] for _, _, paths in groups]
    allp = np.concatenate([q for g in polys for q in g])
    x0, y0 = np.floor(allp.min(0) - lw - 2).astype(int)
    x1, y1 = np.ceil(allp.max(0) + lw + 2).astype(int)
    w, h = x1 - x0, y1 - y0
    shape = (h * SS, w * SS)
    off = np.array([x0, y0], float)
    q = lambda pts: np.round((pts - off) * SS * 16).astype(np.int32)
    col = np.zeros(shape + (3,), np.float32)
    al = np.zeros(shape, np.float32)

    def fill(pl):  # non-zero winding
        acc = np.zeros(shape, np.int16)
        for pts in pl:
            area = 0.5 * np.sum(pts[:, 0] * np.roll(pts[:, 1], -1) - np.roll(pts[:, 0], -1) * pts[:, 1])
            m = np.zeros(shape, np.uint8)
            cv2.fillPoly(m, [q(pts)], 1, lineType=cv2.LINE_8, shift=4)
            acc += np.int16(np.sign(area)) * m
        return (acc != 0).astype(np.float32)

    for (kind, c, _), pl in zip(groups, polys):
        f = fill(pl)
        if kind == "base":
            al = f.copy()
        else:
            f *= al  # prints stay inside the part
        col = col * (1 - f[..., None]) + (np.array(c, np.float32) / 255) * f[..., None]
    st = np.zeros(shape, np.uint8)
    for pts in polys[0]:
        cv2.polylines(st, [q(pts)], True, 1, thickness=int(round(lw * SS)), lineType=cv2.LINE_8, shift=4)
    st = st.astype(np.float32)
    col = col * (1 - st[..., None]) + (np.array(outline, np.float32) / 255) * st[..., None]
    al = np.maximum(al, st)
    small = lambda x: cv2.resize(x, (w, h), interpolation=cv2.INTER_AREA)
    a = small(al)
    return np.dstack([small(col * al[..., None]), a]), off


ORDER = ["LEGS", "ARM_R", "ARM_L", "HEAD", "TORSO", "HAND_R", "HAND_L"]   # arms tuck under the torso edge


def static_check(name, out):
    vec = load_vec(name)
    W, H = vec["size"]
    img = np.ones((H, W, 3), np.float32)
    for p in ORDER:
        if p not in vec["parts"]:
            continue
        spr, off = raster_part(vec["parts"][p], vec["lineWidth"], [18, 18, 18])
        M = np.array([[1, 0, off[0]], [0, 1, off[1]]], float)
        lay = cv2.warpAffine(spr, M, (W, H), flags=cv2.INTER_LINEAR, borderValue=0)
        img = img * (1 - lay[..., 3:4]) + lay[..., :3]
    Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8)).save(out)


PARENT = {"LEGS": "", "TORSO": "LEGS", "HEAD": "TORSO", "ARM_L": "TORSO", "ARM_R": "TORSO", "HAND_L": "ARM_L", "HAND_R": "ARM_R"}


class Scene:
    """mirror of one character comp built by build_lego_squad.jsx"""

    def __init__(self, ch):
        self.cfg, self.ch = js_block("CFG", "{"), ch
        self.anim = js_block("ANIMS", "{")[ch["anim"]]
        self.vec = load_vec(ch["name"])
        self.piv = self.vec["pivots"]
        self.lw = self.vec["lineWidth"]
        self.outline = self.cfg["outline"]
        self.sprites = {p: raster_part(self.vec["parts"][p], self.lw, self.outline) for p in ORDER}
        W, H = self.cfg["width"], self.cfg["height"]
        self.W, self.H = W, H
        self.bg = np.array(ch["bg"], np.float32) / 255

    def prop(self, part, name, t, default):
        return kv(self.anim.get(part, {}).get(name), t, default)

    def local(self, part, t):
        pv = self.piv[part]
        rot = float(self.prop(part, "rot", t, 0))
        if PARENT[part]:
            pos = np.array(pv, float) + self.prop(part, "pos", t, [0, 0])
            scale = self.prop(part, "scale", t, [100, 100]) / 100
        else:
            pos = np.array(self.cfg["feet"], float) + self.prop(part, "pos", t, [0, 0])
            scale = [self.ch["scale"] / 100] * 2
        if part == "TORSO":
            b = self.cfg["breath"] * math.sin(t * 2 * math.pi / self.cfg["breathPeriod"])
            scale = [(100 - b * 0.3) / 100, (100 + b) / 100]
        return affine(pos, rot, scale, pv)

    def world(self, part, t):
        M = self.local(part, t)
        p = PARENT[part]
        return self.world(p, t) @ M if p else M

    def render(self, t):
        out = np.empty((self.H, self.W, 3), np.float32)
        out[:] = self.bg
        feet = self.cfg["feet"]
        lift = max(0.0, -float(self.prop("LEGS", "pos", t, [0, 0])[1]))
        k = 1 - min(lift / 500, 0.55)
        sh = np.zeros((self.H, self.W), np.float32)
        cv2.ellipse(sh, (int(feet[0]), int(feet[1] + 6)), (int(260 * k), int(22 * k)), 0, 0, 360, 1.0, -1)
        sh = cv2.GaussianBlur(sh, (0, 0), 10) * 0.18 * (1 - min(lift / 400, 0.7))
        out *= (1 - sh[..., None])
        for part in ORDER:
            spr, off = self.sprites[part]
            M = self.world(part, t) @ np.array([[1, 0, off[0]], [0, 1, off[1]], [0, 0, 1.0]])
            lay = cv2.warpAffine(spr, M[:2], (self.W, self.H), flags=cv2.INTER_LINEAR, borderValue=0)
            out = out * (1 - lay[..., 3:4]) + lay[..., :3]
        return out


def render_char(ch, out_dir, frames=None, mb=1):
    sc = Scene(ch)
    cfg = sc.cfg
    fps, dur = cfg["fps"], cfg["duration"]
    total = int(round(fps * dur))
    fl = frames if frames is not None else list(range(total))
    offs = np.linspace(-0.25, 0.25, mb) / fps if mb > 1 else [0.0]
    writer = None
    if frames is None:
        writer = subprocess.Popen([imageio_ffmpeg.get_ffmpeg_exe(), "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24",
                                   "-s", "%dx%d" % (sc.W, sc.H), "-r", str(fps), "-i", "-", "-c:v", "libx264", "-pix_fmt", "yuv420p",
                                   "-crf", "18", "-preset", "slow", "-movflags", "+faststart",
                                   os.path.join(out_dir, ch["name"].lower() + ".mp4")], stdin=subprocess.PIPE)
    stills = {}
    for f in fl:
        t = f / fps
        acc = sum(sc.render((t + d) % dur) for d in offs) / len(offs)
        img = (np.clip(acc, 0, 1) * 255 + 0.5).astype(np.uint8)
        if writer:
            writer.stdin.write(img.tobytes())
        stills[f] = img
    if writer:
        writer.stdin.close()
        writer.wait()
    pick = sorted(stills) if frames is not None else sorted(stills)[::max(1, len(stills) // 8)][:8]
    tw, th = sc.W // 4, sc.H // 4
    sheet = Image.new("RGB", (tw * 4, th * math.ceil(len(pick) / 4)), (255, 255, 255))
    for n, f in enumerate(pick):
        im = Image.fromarray(stills[f]).resize((tw, th), Image.LANCZOS)
        ImageDraw.Draw(im).text((6, 4), "%.2fs" % (f / fps), fill=(90, 90, 90))
        sheet.paste(im, ((n % 4) * tw, (n // 4) * th))
    sheet.save(os.path.join(out_dir, ch["name"].lower() + "_storyboard.jpg"), quality=88)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("name")
    ap.add_argument("--static", default=None)
    ap.add_argument("--out-dir", default=os.path.join(ROOT, "preview"))
    ap.add_argument("--frames", default=None)
    ap.add_argument("--mb", type=int, default=1, help="motion-blur subsamples (1 = off, as in the comp)")
    args = ap.parse_args()
    if args.static:
        static_check(args.name, args.static)
    else:
        os.makedirs(args.out_dir, exist_ok=True)
        squad = js_block("SQUAD", "[")
        for ch in squad:
            if args.name in ("all", ch["name"]):
                fr = [int(v) for v in args.frames.split(",")] if args.frames else None
                render_char(ch, args.out_dir, fr, args.mb)
                print("rendered", ch["name"])
