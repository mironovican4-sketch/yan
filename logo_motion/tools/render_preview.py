"""Preview of the logo motion built by build_logo_motion.jsx (same timings, geometry, eases).

All constants (CFG, COLORS, GEO, GLYPHS, T, EASE) are parsed from the .jsx, so the preview
follows the AE project. Rectangles use exact pixel coverage (seamless joins like AE's shared fill).

Usage: python3 render_preview.py --out preview.mp4 [--sheet storyboard.jpg] [--svg logo.svg]
Needs: numpy, opencv-python-headless, pillow, imageio-ffmpeg
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
SRC = open(os.path.join(ROOT, "build_logo_motion.jsx"), encoding="utf-8-sig").read()


def js_block(name, opener):
    i = SRC.index("var %s = %s" % (name, opener)) + len("var %s = " % name)
    close = {"{": "}", "[": "]"}[opener]
    depth, j = 0, i
    while True:
        c = SRC[j]
        depth += (c == opener) - (c == close)
        if depth == 0:
            break
        j += 1
    body = re.sub(r"//[^\n]*", "", SRC[i:j + 1])
    body = re.sub(r"([{,]\s*)([A-Za-z_]\w*)\s*:", r'\1"\2":', body)
    return json.loads(body)


CFG, COLORS, GEO, GLYPHS, T, EASE = (js_block(n, o) for n, o in
                                     [("CFG", "{"), ("COLORS", "{"), ("GEO", "{"), ("GLYPHS", "["), ("T", "{"), ("EASE", "{")])
W, H, FPS, DUR = CFG["width"], CFG["height"], CFG["fps"], CFG["duration"]
M = GEO["glyph"] / 3
OX, OY = -GEO["logoW"] / 2, -GEO["logoH"] / 2


# ----------------------------------------------------------------------------- AE-like keyframes
def _bez(u, x1, y1, x2, y2):
    lo, hi = 0.0, 1.0
    for _ in range(40):
        s = (lo + hi) / 2
        x = 3 * (1 - s) ** 2 * s * x1 + 3 * (1 - s) * s * s * x2 + s ** 3
        lo, hi = (s, hi) if x < u else (lo, s)
    s = (lo + hi) / 2
    return 3 * (1 - s) ** 2 * s * y1 + 3 * (1 - s) * s * s * y2 + s ** 3


def kv(keys, t):
    if t <= keys[0][0]:
        return np.array(keys[0][1], float)
    if t >= keys[-1][0]:
        return np.array(keys[-1][1], float)
    for a, b in zip(keys, keys[1:]):
        if a[0] <= t <= b[0]:
            u = (t - a[0]) / (b[0] - a[0])
            ea = a[2] if len(a) > 2 else [66, 66]
            eb = b[2] if len(b) > 2 else [66, 66]
            p = _bez(u, ea[1] / 100, 0, 1 - eb[0] / 100, 1)
            return np.array(a[1], float) + (np.array(b[1], float) - np.array(a[1], float)) * p


def in_out(t_in, d_in, v_from, v_full, t_out, d_out, v_to):
    ks = [[t_in, v_from, EASE["start"]], [t_in + d_in, v_full, EASE["end"]]]
    if CFG["outro"]:
        ks += [[t_out, v_full, EASE["start"]], [t_out + d_out, v_to, EASE["end"]]]
    return ks


def bar_keys(x0, y0, x1, y1, d, t_in, d_in, t_out, d_out):
    w, h, cx, cy = x1 - x0, y1 - y0, (x0 + x1) / 2, (y0 + y1) / 2
    zero, frm, to = {"right": ([0, h], [x0, cy], [x1, cy]), "left": ([0, h], [x1, cy], [x0, cy]),
                     "down": ([w, 0], [cx, y0], [cx, y1]), "up": ([w, 0], [cx, y1], [cx, y0])}[d]
    return in_out(t_in, d_in, zero, [w, h], t_out, d_out, zero), in_out(t_in, d_in, frm, [cx, cy], t_out, d_out, to)


# ----------------------------------------------------------------------------- scene (mirrors the jsx)
def stroke_dur(n):
    return T["stroke3"] if n >= 3 else (T["stroke2"] if n == 2 else T["stroke1"])


BARS = []  # (glyph index, size keys, pos keys)
for gi, G in enumerate(GLYPHS):
    gx = OX + G["col"] * (GEO["glyph"] + GEO["gap"])
    gy = OY + G["row"] * (GEO["glyph"] + GEO["gap"])
    t = T["build"] + gi * T["glyphStagger"]
    for c, r, cw, rh, d in G["strokes"]:
        n = cw if d in ("left", "right") else rh
        dur = stroke_dur(n)
        sk, pk = bar_keys(gx + c * M, gy + r * M, gx + (c + cw) * M, gy + (r + rh) * M, d, t, dur, t + T["outro"] - T["build"], dur)
        BARS.append((gi, sk, pk))
        t += dur * T["handoff"]
PX0 = OX + GEO["panelX"]
PANEL = bar_keys(PX0, OY, PX0 + GEO["panelW"], OY + GEO["logoH"], "right", T["panelIn"], T["panelDur"], T["panelOut"], T["panelDur"])
# disc spin (null DISC_ROTATION in the jsx) + small disc scale
_turns = 360 * T["discTurns"]
_in_end, _out_end = T["discIn"] + T["discInDur"], T["discOut"] + T["discOutDur"]
DISC_ROT = [[T["discIn"], -_turns, [33, 8]], [_in_end, 0, [90, 33]]]
DISC_SCALE = [[T["discIn"], 0, [33, 10]], [T["discIn"] + 0.6, 100, [85, 33]]]
SMALL_SCALE = [[T["smallIn"], 0, [33, 10]], [T["smallIn"] + T["smallDur"], 100, [85, 33]]]
if CFG["outro"]:
    DISC_ROT += [[T["discOut"], 0, [33, 75]], [_out_end, _turns, [8, 33]]]
    DISC_SCALE += [[_out_end - 0.55, 100, [33, 80]], [_out_end, 0, [10, 33]]]
    SMALL_SCALE += [[T["discOut"], 100, [33, 70]], [T["discOut"] + 0.4, 0, [10, 33]]]
GRID_X = [0, M, 2 * M, GEO["glyph"], GEO["glyph"] + GEO["gap"], GEO["glyph"] + GEO["gap"] + M, GEO["glyph"] + GEO["gap"] + 2 * M,
          2 * GEO["glyph"] + GEO["gap"], GEO["panelX"], GEO["logoW"]]
GRID_Y = [0, M, 2 * M, GEO["glyph"], GEO["logoH"] / 2, GEO["glyph"] + GEO["gap"], GEO["glyph"] + GEO["gap"] + M,
          GEO["glyph"] + GEO["gap"] + 2 * M, GEO["logoH"]]
GRID = [((OX + x, -H * 0.6), (OX + x, H * 0.6)) for x in GRID_X] + [((-W * 0.6, OY + y), (W * 0.6, OY + y)) for y in GRID_Y]
PUSH = [[T["pushStart"], 97, [30, 20]], [T["pushEnd"] if CFG["outro"] else DUR, 100, [60, 30]]]


def col(c):
    return np.array(c, np.float32) / 255.0


def cov1d(a, b, n):
    """exact coverage of [a, b) over pixels 0..n-1"""
    j = np.arange(n, dtype=np.float32)
    return np.clip(np.minimum(b, j + 1) - np.maximum(a, j), 0, 1)


class Frame:
    def __init__(self, t):
        self.s = float(kv(PUSH, t)) / 100
        self.t = t

    def to_px(self, x, y):
        return W / 2 + x * self.s, H / 2 + y * self.s

    def rect_cov(self, x0, y0, x1, y1):
        ax, ay = self.to_px(x0, y0)
        bx, by = self.to_px(x1, y1)
        return np.outer(cov1d(ay, by, H), cov1d(ax, bx, W))

    def half_disc(self, r, rot_deg, scale):
        """right half-disc rotated around the panel's left-edge centre, clipped to the panel (mask)"""
        m = np.zeros((H, W), np.float32)
        if r * scale < 0.05:
            return m
        cx, cy = PX0, OY + GEO["logoH"] / 2
        phi = np.radians(np.linspace(-90, 90, 181) + rot_deg)
        poly = [(cx + math.cos(a) * r * scale, cy + math.sin(a) * r * scale) for a in phi]
        clipped = []  # Sutherland-Hodgman against x >= cx
        for (x0, y0), (x1, y1) in zip(poly, poly[1:] + poly[:1]):
            in0, in1 = x0 >= cx, x1 >= cx
            if in0:
                clipped.append((x0, y0))
            if in0 != in1:
                k = (cx - x0) / (x1 - x0)
                clipped.append((cx, y0 + (y1 - y0) * k))
        if len(clipped) < 3:
            return m
        pts = np.array([self.to_px(x, y) for x, y in clipped])
        cv2.fillPoly(m, [np.round(pts * 16).astype(np.int32)], 1.0, lineType=cv2.LINE_AA, shift=4)
        return m


def render(t):
    f = Frame(t)
    img = np.empty((H, W, 3), np.float32)
    img[:] = col(COLORS["background"])

    def over(mask, c):
        img[:] = img * (1 - mask[..., None]) + col(c) * mask[..., None]

    if CFG["grid"]:
        op = float(kv([[T["gridFadeStart"], 100, [33, 33]], [T["gridFadeEnd"], 0, [70, 33]]], t)) / 100
        if op > 0.001:
            g = np.zeros((H, W), np.float32)
            for i, (p0, p1) in enumerate(GRID):
                t0 = T["gridIn"] + i * T["gridStagger"]
                e = float(kv([[t0, 0, EASE["start"]], [t0 + T["gridDur"], 100, EASE["end"]]], t)) / 100
                if e <= 0:
                    continue
                x1, y1 = p0[0] + (p1[0] - p0[0]) * e, p0[1] + (p1[1] - p0[1]) * e
                hw = 0.6 / f.s
                if p0[0] == p1[0]:
                    g = np.maximum(g, f.rect_cov(p0[0] - hw, p0[1], p0[0] + hw, y1))
                else:
                    g = np.maximum(g, f.rect_cov(p0[0], p0[1] - hw, x1, p0[1] + hw))
            over(g * op, COLORS["grid"])

    glyph = np.zeros((H, W), np.float32)
    for _, sk, pk in BARS:
        (w, h), (cx, cy) = kv(sk, t), kv(pk, t)
        if w > 1e-3 and h > 1e-3:
            glyph += f.rect_cov(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2)
    over(np.clip(glyph, 0, 1), COLORS["black"])

    (w, h), (cx, cy) = kv(PANEL[0], t), kv(PANEL[1], t)
    if w > 1e-3:
        over(f.rect_cov(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2), COLORS["pink"])
    rot, sc = float(kv(DISC_ROT, t)), float(kv(DISC_SCALE, t)) / 100
    over(f.half_disc(GEO["discR"] + 1, rot, sc), COLORS["background"])
    over(f.half_disc(GEO["smallR"], rot, sc * float(kv(SMALL_SCALE, t)) / 100), COLORS["pink"])
    return img


def write_svg(path):
    """Static vector of the rebuilt logo (1000 x 620)."""
    hexc = lambda c: "#%02X%02X%02X" % tuple(c)
    d = []
    for G in GLYPHS:
        gx, gy = G["col"] * (GEO["glyph"] + GEO["gap"]), G["row"] * (GEO["glyph"] + GEO["gap"])
        for c, r, cw, rh, _ in G["strokes"]:
            x0, y0, x1, y1 = gx + c * M, gy + r * M, gx + (c + cw) * M, gy + (r + rh) * M
            d.append("M%.2f %.2fH%.2fV%.2fH%.2fZ" % (x0, y0, x1, y1, x0))
    px, R, r, cy = GEO["panelX"], GEO["discR"], GEO["smallR"], GEO["logoH"] / 2
    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {GEO['logoW']} {GEO['logoH']}" width="{GEO['logoW']}" height="{GEO['logoH']}">
  <path fill="{hexc(COLORS['black'])}" d="{''.join(d)}"/>
  <rect fill="{hexc(COLORS['pink'])}" x="{px}" y="0" width="{GEO['panelW']}" height="{GEO['logoH']}"/>
  <path fill="{hexc(COLORS['background'])}" d="M{px} {cy - R}A{R} {R} 0 0 1 {px} {cy + R}Z"/>
  <path fill="{hexc(COLORS['pink'])}" d="M{px} {cy - r}A{r} {r} 0 0 1 {px} {cy + r}Z"/>
</svg>
"""
    open(path, "w").write(svg)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="preview.mp4")
    ap.add_argument("--sheet", default=None)
    ap.add_argument("--svg", default=None)
    ap.add_argument("--mb", type=int, default=4, help="motion-blur subsamples (180 deg shutter)")
    ap.add_argument("--frames", default=None, help="comma list: render only these frames (no video)")
    args = ap.parse_args()
    if args.svg:
        write_svg(args.svg)
    total = int(round(DUR * FPS))
    frames = [int(v) for v in args.frames.split(",")] if args.frames else list(range(total))
    offs = np.linspace(-0.25, 0.25, args.mb) / FPS if args.mb > 1 else [0.0]
    writer = None
    if not args.frames:
        writer = subprocess.Popen([imageio_ffmpeg.get_ffmpeg_exe(), "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24",
                                   "-s", "%dx%d" % (W, H), "-r", str(FPS), "-i", "-", "-c:v", "libx264", "-pix_fmt", "yuv420p",
                                   "-crf", "16", "-preset", "slow", "-movflags", "+faststart", args.out], stdin=subprocess.PIPE)
    stills = {}
    for fr in frames:
        t = fr / FPS
        acc = sum(render(min(max(t + d, 0), DUR - 1e-4)) for d in offs) / len(offs)
        img = (np.clip(acc, 0, 1) * 255 + 0.5).astype(np.uint8)
        if writer:
            writer.stdin.write(img.tobytes())
        stills[fr] = img
    if writer:
        writer.stdin.close()
        writer.wait()
    if args.sheet:
        pick = sorted(stills) if args.frames else sorted(stills)[::max(1, len(stills) // 12)][:12]
        tw, th = W // 4, H // 4
        cols = 4
        sheet = Image.new("RGB", (tw * cols, th * math.ceil(len(pick) / cols)), (255, 255, 255))
        for n, fr in enumerate(pick):
            im = Image.fromarray(stills[fr]).resize((tw, th), Image.LANCZOS)
            ImageDraw.Draw(im).text((6, 4), "%.2fs" % (fr / FPS), fill=(150, 150, 150))
            sheet.paste(im, ((n % cols) * tw, (n // cols) * th))
        sheet.save(args.sheet, quality=90)


if __name__ == "__main__":
    main()
