"""Preview renderer for the LEGO scenes: draws scenes/<SCENE>.jsxinc frame by frame (same data as the AE comp).

Usage: python3 render.py <SCENE|all> [--out-dir ../preview] [--frames 0,30,60]
"""
import argparse
import glob
import math
import os
import subprocess

import imageio_ffmpeg
import numpy as np
from PIL import Image, ImageDraw

from scenekit import Renderer, load

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def render(path, out_dir, frames=None):
    data = load(path)
    R = Renderer(data)
    fps, W, H = data["fps"], data["width"], data["height"]
    total = int(round(fps * data["duration"]))
    name = data["name"].lower()
    fl = frames if frames is not None else list(range(total))
    writer = None
    if frames is None:
        writer = subprocess.Popen([imageio_ffmpeg.get_ffmpeg_exe(), "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24",
                                   "-s", "%dx%d" % (W, H), "-r", str(fps), "-i", "-", "-c:v", "libx264", "-pix_fmt", "yuv420p",
                                   "-crf", "18", "-preset", "slow", "-movflags", "+faststart", os.path.join(out_dir, name + ".mp4")],
                                  stdin=subprocess.PIPE)
    stills = {}
    for f in fl:
        img = (np.clip(R.frame(f / fps), 0, 1) * 255 + 0.5).astype(np.uint8)
        if writer:
            writer.stdin.write(img.tobytes())
        stills[f] = img
    if writer:
        writer.stdin.close()
        writer.wait()
    pick = sorted(stills) if frames is not None else sorted(stills)[::max(1, len(stills) // 8)][:8]
    tw, th = W // 4, H // 4
    sheet = Image.new("RGB", (tw * 4, th * math.ceil(len(pick) / 4)), (255, 255, 255))
    for n, f in enumerate(pick):
        im = Image.fromarray(stills[f]).resize((tw, th), Image.LANCZOS)
        ImageDraw.Draw(im).text((6, 4), "%.2fs" % (f / fps), fill=(90, 90, 90))
        sheet.paste(im, ((n % 4) * tw, (n // 4) * th))
    sheet.save(os.path.join(out_dir, name + "_storyboard.jpg"), quality=88)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("name")
    ap.add_argument("--out-dir", default=os.path.join(ROOT, "preview"))
    ap.add_argument("--frames", default=None)
    a = ap.parse_args()
    os.makedirs(a.out_dir, exist_ok=True)
    paths = sorted(glob.glob(os.path.join(ROOT, "scenes", "*.jsxinc")))
    for p in paths:
        n = os.path.basename(p)[:-7]
        if a.name in ("all", n):
            render(p, a.out_dir, [int(v) for v in a.frames.split(",")] if a.frames else None)
            print("rendered", n)
