"""Preview of the vector LEGO facepalm built by build_lego_motion.jsx.

CFG, RIG and ANIM are parsed from the .jsx and the shapes from lego_vectors.jsxinc, so the preview
follows the AE comp: every part is filled + stroked from the same bezier paths, the raised arm is
re-rasterized each frame with its group squash (stroke width stays constant, like in AE), and the
hand follows the wrist without inheriting that squash. Motion blur: 180-degree shutter, subsampled.

Usage: python3 render_preview.py --out preview.mp4 [--sheet storyboard.jpg] [--frames 0,30,...] [--mb 10]
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
SRC = open(os.path.join(ROOT, "build_lego_motion.jsx"), encoding="utf-8-sig").read()


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


CFG, RIG, ANIM = js_block("CFG", "{"), js_block("RIG", "["), js_block("ANIM", "{")
VEC = json.loads(open(os.path.join(ROOT, "lego_vectors.jsxinc")).read().split("\n", 1)[1].strip()[1:-1])
W, H, FPS, DUR = CFG["width"], CFG["height"], CFG["fps"], CFG["duration"]
SS = 3  # supersampling for anti-aliased edges


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


# ----------------------------------------------------------------------------- vector raster
def flatten(p, M, n=14):
    v, I, O = np.array(p["v"], float), np.array(p["i"], float), np.array(p["o"], float)
    pts = []
    m = len(v)
    for k in range(m):
        p0, p3 = v[k], v[(k + 1) % m]
        c1, c2 = p0 + O[k], p3 + I[(k + 1) % m]
        ts = [0.0] if (not O[k].any() and not I[(k + 1) % m].any()) else np.linspace(0, 1, n, endpoint=False)
        for t in ts:
            pts.append((1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * c1 + 3 * (1 - t) * t * t * c2 + t ** 3 * p3)
    pts = np.array(pts)
    return pts @ M[:2, :2].T + M[:2, 2]


def raster_part(part, M=np.eye(3)):
    """premultiplied RGBA sprite of a part (canvas px, after group transform M) + its canvas offset"""
    lw = VEC["lineWidth"]
    polys = {id(p): flatten(p, M) for rg in part["regions"] for p in rg["paths"]}
    polys.update({id(p): flatten(p, M) for p in part["details"]})
    allp = np.concatenate(list(polys.values()))
    x0, y0 = np.floor(allp.min(0) - lw - 2).astype(int)
    x1, y1 = np.ceil(allp.max(0) + lw + 2).astype(int)
    w, h = x1 - x0, y1 - y0
    shape = (h * SS, w * SS)
    off = np.array([x0, y0], float)
    q = lambda pts: np.round((pts - off) * SS * 16).astype(np.int32)
    col = np.zeros(shape + (3,), np.float32)
    al = np.zeros(shape, np.float32)
    line = np.array(CFG["outline"], np.float32) / 255

    def fill_nz(paths):  # non-zero winding, like AE's default fill rule
        acc = np.zeros(shape, np.int16)
        for p in paths:
            pts = polys[id(p)]
            area = 0.5 * np.sum(pts[:, 0] * np.roll(pts[:, 1], -1) - np.roll(pts[:, 0], -1) * pts[:, 1])
            m = np.zeros(shape, np.uint8)
            cv2.fillPoly(m, [q(pts)], 1, lineType=cv2.LINE_8, shift=4)
            acc += np.sign(area).astype(np.int16) * m
        return (acc != 0).astype(np.float32)

    def stroke(paths):
        m = np.zeros(shape, np.uint8)
        for p in paths:
            cv2.polylines(m, [q(polys[id(p)])], True, 1, thickness=int(round(lw * SS)), lineType=cv2.LINE_8, shift=4)
        return m.astype(np.float32)

    def over(mask, c):
        nonlocal col, al
        col = col * (1 - mask[..., None]) + c * mask[..., None]
        al = np.maximum(al, mask)

    for rg in reversed(part["regions"]):          # AE: first group in the list is drawn on top
        over(fill_nz(rg["paths"]), np.array(rg["color"], np.float32) / 255)
        over(stroke(rg["paths"]), line)
    over(fill_nz(part["details"]), line)
    small = lambda x: cv2.resize(x, (w, h), interpolation=cv2.INTER_AREA)
    a = small(al)
    return np.dstack([small(col * al[..., None]), a]), off


class Scene:
    def __init__(self):
        self.rig = {r["name"]: r for r in RIG}
        self.sprites = {r["name"]: raster_part(VEC["parts"][r["name"]]) for r in RIG if not r.get("foreshorten")}
        self.bg = np.array(CFG["background"], np.float32) / 255
        sh = np.zeros((H, W), np.float32)
        cv2.ellipse(sh, (int(CFG["feet"][0]), int(CFG["feet"][1] + 6)), (280, 23), 0, 0, 360, 1.0, -1)
        self.shadow = cv2.GaussianBlur(sh, (0, 0), 22 * 0.45) * 0.18

    def squash(self, name, t):
        r = self.rig[name]
        s = kv(ANIM.get(name, {}).get("squash"), t, [100, 100]) / 100
        return affine(r["pivot"], 0, s, r["pivot"])

    def local(self, name, t):
        r, A = self.rig[name], ANIM.get(name, {})
        rot = float(kv(A.get("rot"), t, 0))
        if r["parent"]:
            pos = np.array(r["pivot"], float) + kv(A.get("pos"), t, [0, 0])
            scale = kv(A.get("scale"), t, [100, 100]) / 100
            if r.get("follow"):  # parent.fromComp(arm.toComp(group-transformed wrist))
                f = r["follow"]
                wrist = self.world(f, t) @ self.squash(f, t) @ np.array([*r["pivot"], 1.0])
                pos = (np.linalg.inv(self.world(r["parent"], t)) @ wrist)[:2]
        else:
            pos, scale = CFG["feet"], [CFG["charScale"] / 100] * 2
        if name == "TORSO":  # breathing expression
            s = CFG["breath"] * math.sin(t * 2 * math.pi / CFG["breathPeriod"])
            scale = [(100 - s * 0.3) / 100, (100 + s) / 100]
        return affine(pos, rot, scale, r["pivot"])

    def world(self, name, t):
        M = self.local(name, t)
        p = self.rig[name]["parent"]
        return self.world(p, t) @ M if p else M

    def render(self, t):
        out = np.empty((H, W, 3), np.float32)
        out[:] = self.bg
        out *= (1 - self.shadow[..., None])
        for r in RIG:
            name = r["name"]
            if r.get("foreshorten"):
                spr, off = raster_part(VEC["parts"][name], self.squash(name, t))
            else:
                spr, off = self.sprites[name]
            M = self.world(name, t) @ np.array([[1, 0, off[0]], [0, 1, off[1]], [0, 0, 1.0]])
            lay = cv2.warpAffine(spr, M[:2], (W, H), flags=cv2.INTER_LINEAR, borderValue=0)
            out = out * (1 - lay[..., 3:4]) + lay[..., :3]
        return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="preview.mp4")
    ap.add_argument("--sheet", default=None)
    ap.add_argument("--mb", type=int, default=10)
    ap.add_argument("--frames", default=None)
    args = ap.parse_args()
    sc = Scene()
    total = int(round(DUR * FPS))
    frames = [int(v) for v in args.frames.split(",")] if args.frames else list(range(total))
    offs = np.linspace(-0.25, 0.25, args.mb) / FPS if args.mb > 1 else [0.0]
    writer = None
    if not args.frames:
        writer = subprocess.Popen([imageio_ffmpeg.get_ffmpeg_exe(), "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24",
                                   "-s", "%dx%d" % (W, H), "-r", str(FPS), "-i", "-", "-c:v", "libx264", "-pix_fmt", "yuv420p",
                                   "-crf", "17", "-preset", "slow", "-movflags", "+faststart", args.out], stdin=subprocess.PIPE)
    stills = {}
    for f in frames:
        t = f / FPS
        acc = sum(sc.render((t + d) % DUR) for d in offs) / len(offs)
        img = (np.clip(acc, 0, 1) * 255 + 0.5).astype(np.uint8)
        if writer:
            writer.stdin.write(img.tobytes())
        stills[f] = img
    if writer:
        writer.stdin.close()
        writer.wait()
    if args.sheet:
        pick = sorted(stills) if args.frames else sorted(stills)[::max(1, len(stills) // 12)][:12]
        tw, th = W // 4, H // 4
        sheet = Image.new("RGB", (tw * 4, th * math.ceil(len(pick) / 4)), (255, 255, 255))
        for n, f in enumerate(pick):
            im = Image.fromarray(stills[f]).resize((tw, th), Image.LANCZOS)
            ImageDraw.Draw(im).text((6, 4), "%.2fs" % (f / FPS), fill=(120, 120, 120))
            sheet.paste(im, ((n % 4) * tw, (n // 4) * th))
        sheet.save(args.sheet, quality=90)


if __name__ == "__main__":
    main()
