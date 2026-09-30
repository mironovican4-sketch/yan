"""Preview of the LEGO facepalm rig built by build_lego_motion.jsx.

CFG, RIG and ANIM are parsed from the .jsx, and transforms follow AE's parenting math
(position/anchor/rotation/scale, children in the shared 1122x1500 canvas space), so the preview
matches the AE comp. Motion blur: 180-degree shutter, subsampled.

Usage: python3 render_preview.py --out preview.mp4 [--sheet storyboard.jpg] [--frames 0,30,...]
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
W, H, FPS, DUR = CFG["width"], CFG["height"], CFG["fps"], CFG["duration"]


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


class Scene:
    def __init__(self):
        self.img = {}
        for r in RIG:
            a = np.asarray(Image.open(os.path.join(ROOT, "assets", r["file"])).convert("RGBA"), np.float32) / 255
            a[..., :3] *= a[..., 3:4]
            self.img[r["name"]] = a
        self.rig = {r["name"]: r for r in RIG}
        self.bg = np.array(CFG["background"], np.float32) / 255
        sh = np.zeros((H, W), np.float32)
        cv2.ellipse(sh, (int(CFG["feet"][0]), int(CFG["feet"][1] + 6)), (280, 23), 0, 0, 360, 1.0, -1)
        self.shadow = cv2.GaussianBlur(sh, (0, 0), 22 * 0.45) * 0.18

    def local(self, name, t):
        r, A = self.rig[name], ANIM.get(name, {})
        rot = float(kv(A.get("rot"), t, 0))
        if r["parent"]:
            pos = np.array(r["pivot"], float) + kv(A.get("pos"), t, [0, 0])
            scale = [1.0, 1.0]
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
            M = self.world(r["name"], t)
            lay = cv2.warpAffine(self.img[r["name"]], M[:2], (W, H), flags=cv2.INTER_LINEAR, borderValue=0)
            out = out * (1 - lay[..., 3:4]) + lay[..., :3]
        return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="preview.mp4")
    ap.add_argument("--sheet", default=None)
    ap.add_argument("--mb", type=int, default=4)
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
        acc = sum(sc.render((t + d) % DUR) for d in offs) / len(offs)   # loop: blur wraps around
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
