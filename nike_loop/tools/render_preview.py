"""Preview animatic of the NIKE loop (approximation of what build_nike_loop.jsx builds in AE).

Timings, palette, stripe settings and the swoosh vector are parsed straight from the .jsx,
and the stripes use the same Park-Miller generator, so the layout matches the AE project.

Usage:
  python3 render_preview.py --font Anton-Regular.ttf --out preview.mp4 [--scale 0.5] [--sheet sheet.jpg]
Needs: numpy, opencv-python-headless, pillow, imageio-ffmpeg
"""
import argparse
import colorsys
import json
import math
import os
import re
import subprocess

import cv2
import imageio_ffmpeg
import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)


# ----------------------------------------------------------------------------- jsx constants
def js_block(src, name, opener):
    i = src.index("var %s = %s" % (name, opener)) + len("var %s = " % name)
    depth, j = 0, i
    close = {"{": "}", "[": "]"}[opener]
    while True:
        c = src[j]
        if c == opener:
            depth += 1
        elif c == close:
            depth -= 1
            if depth == 0:
                break
        j += 1
    body = src[i:j + 1]
    body = re.sub(r"//[^\n]*", "", body)
    body = re.sub(r"([{,]\s*)([A-Za-z_]\w*)\s*:", r'\1"\2":', body)
    return json.loads(body)


SRC = open(os.path.join(ROOT, "build_nike_loop.jsx"), encoding="utf-8-sig").read()
CFG = js_block(SRC, "CFG", "{")
T = js_block(SRC, "T", "{")
PALETTE = js_block(SRC, "PALETTE", "[")
STRIPES = js_block(SRC, "STRIPES", "{")
SWOOSH = js_block(SRC, "SWOOSH", "{")
SWOOSH_COLOR = js_block(SRC, "SWOOSH_COLOR", "[")
CTRL = {"Stripe Speed": 1, "Stripe Opacity": 100, "Rainbow Speed": 90, "Rainbow Saturation": 92, "Shake Amount": 9,
        "Flash Intensity": 100, "Sneaker Scale": 72, "Sneaker Float": 12, "Shadow Opacity": 45, "Grain Amount": 5,
        "Vignette": 55}
W, H, FPS, DUR = CFG["width"], CFG["height"], CFG["fps"], CFG["duration"]
CX, CY = W / 2, H / 2


# ----------------------------------------------------------------------------- keyframes
def _bez(u, x1, y1, x2, y2):
    lo, hi = 0.0, 1.0
    for _ in range(30):
        s = (lo + hi) / 2
        x = 3 * (1 - s) ** 2 * s * x1 + 3 * (1 - s) * s * s * x2 + s ** 3
        if x < u:
            lo = s
        else:
            hi = s
    s = (lo + hi) / 2
    return 3 * (1 - s) ** 2 * s * y1 + 3 * (1 - s) * s * s * y2 + s ** 3


def kv(keys, t):
    """AE-like evaluation of [[time, value, ease], ...] (ease: 'L' | [in, out(, linIn|linOut)])."""
    if t <= keys[0][0]:
        return np.array(keys[0][1], float)
    if t >= keys[-1][0]:
        return np.array(keys[-1][1], float)
    for a, b in zip(keys, keys[1:]):
        if a[0] <= t <= b[0]:
            u = (t - a[0]) / (b[0] - a[0])
            ea = a[2] if len(a) > 2 else [66, 66]
            eb = b[2] if len(b) > 2 else [66, 66]
            lin_out = ea == "L" or (isinstance(ea, list) and len(ea) > 2 and ea[2] == "linOut")
            lin_in = eb == "L" or (isinstance(eb, list) and len(eb) > 2 and eb[2] == "linIn")
            x1, y1 = (1 / 3, 1 / 3) if lin_out else (ea[1] / 100, 0)
            x2, y2 = (2 / 3, 2 / 3) if lin_in else (1 - eb[0] / 100, 1)
            p = u if (lin_in and lin_out) else _bez(u, x1, y1, x2, y2)
            return np.array(a[1], float) + (np.array(b[1], float) - np.array(a[1], float)) * p


# ----------------------------------------------------------------------------- stripes (same RNG as jsx)
class Rng:
    def __init__(self, seed):
        self.s = seed % 2147483647
        if self.s <= 0:
            self.s += 2147483646

    def next(self):
        self.s = (self.s * 16807) % 2147483647
        return (self.s - 1) / 2147483646


def gen_stripes(rng, P):
    out, R = [], math.sqrt(W * W + H * H) / 2
    dirs = STRIPES["dirs"]
    for _ in range(P["count"]):
        a = dirs[int(math.floor(rng.next() * len(dirs)))] + (rng.next() - 0.5) * 10
        ln = P["lenMin"] + rng.next() * (P["lenMax"] - P["lenMin"])
        th = P["thickMin"] + rng.next() * (P["thickMax"] - P["thickMin"])
        col = PALETTE[int(math.floor(rng.next() * len(PALETTE)))]
        speed = P["speedMin"] + rng.next() * (P["speedMax"] - P["speedMin"])
        gap = P["gapMin"] + rng.next() * (P["gapMax"] - P["gapMin"])
        lat = rng.next() - 0.5
        phase = rng.next()
        blur = rng.next() * P["blurMax"]
        rad = math.radians(a)
        dx, dy = math.cos(rad), math.sin(rad)
        nx, ny = -dy, dx
        extent = abs(nx) * W / 2 + abs(ny) * H / 2
        cx, cy = CX + nx * lat * 1.8 * extent, CY + ny * lat * 1.8 * extent
        reach = R + ln / 2 + 40
        dur = 2 * reach / speed
        period = dur + gap
        out.append(dict(angle=a, len=ln, thick=th, color=col, blur=blur, frm=(cx - dx * reach, cy - dy * reach),
                        to=(cx + dx * reach, cy + dy * reach), t0=phase * period, dur=dur, period=period))
    return out


BACK = gen_stripes(Rng(CFG["seed"]), STRIPES["back"])
FRONT = gen_stripes(Rng(CFG["seed"] + 1), STRIPES["front"])


def stripe_pos(s, pt):
    if pt > s["t0"] + s["period"]:
        pt = s["t0"] + (pt - s["t0"]) % s["period"]
    u = min(max((pt - s["t0"]) / s["dur"], 0), 1)
    return (s["frm"][0] + (s["to"][0] - s["frm"][0]) * u, s["frm"][1] + (s["to"][1] - s["frm"][1]) * u)


# ----------------------------------------------------------------------------- geometry helpers
def affine(pos, rot=0.0, scale=(1.0, 1.0), anchor=(0.0, 0.0)):
    r = math.radians(rot)
    c, s = math.cos(r), math.sin(r)
    M = np.array([[c * scale[0], -s * scale[1], 0], [s * scale[0], c * scale[1], 0], [0, 0, 1]], float)
    M[0, 2] = pos[0] - (M[0, 0] * anchor[0] + M[0, 1] * anchor[1])
    M[1, 2] = pos[1] - (M[1, 0] * anchor[0] + M[1, 1] * anchor[1])
    return M


def apply(M, pts):
    pts = np.asarray(pts, float)
    return pts @ M[:2, :2].T + M[:2, 2]


def pill(length, thick, seg=10):
    r = thick / 2
    hl = max(length / 2 - r, 0)
    pts = []
    for k in range(seg + 1):
        a = -math.pi / 2 + math.pi * k / seg
        pts.append((hl + r * math.cos(a), r * math.sin(a)))
    for k in range(seg + 1):
        a = math.pi / 2 + math.pi * k / seg
        pts.append((-hl + r * math.cos(a), r * math.sin(a)))
    return np.array(pts)


def bezier_path(v, i, o, n=24):
    pts = []
    m = len(v)
    for k in range(m):
        p0 = np.array(v[k], float)
        p3 = np.array(v[(k + 1) % m], float)
        c1 = p0 + np.array(o[k], float)
        c2 = p3 + np.array(i[(k + 1) % m], float)
        for s in np.linspace(0, 1, n, endpoint=False):
            pts.append((1 - s) ** 3 * p0 + 3 * (1 - s) ** 2 * s * c1 + 3 * (1 - s) * s * s * c2 + s ** 3 * p3)
    return np.array(pts)


SWOOSH_PTS = bezier_path(SWOOSH["v"], SWOOSH["i"], SWOOSH["o"])


def hsl(h, s, l):
    return np.array(colorsys.hls_to_rgb(h % 1.0, l, s), np.float32)


def c01(c):
    return np.array(c[:3], np.float32) / 255.0


# ----------------------------------------------------------------------------- renderer
class Renderer:
    def __init__(self, scale, font_path):
        self.k = scale
        self.w, self.h = int(round(W * scale)), int(round(H * scale))
        self.font_path = font_path
        yy, xx = np.mgrid[0:self.h, 0:self.w].astype(np.float32)
        self.xx, self.yy = xx / scale, yy / scale
        self.rng = np.random.default_rng(7)
        # vignette: black solid with inverted feathered ellipse mask
        m = np.zeros((self.h, self.w), np.float32)
        cv2.ellipse(m, (self.w // 2, self.h // 2), (int(W * 0.62 * scale), int(H * 0.66 * scale)), 0, 0, 360, 1.0, -1)
        m = cv2.GaussianBlur(m, (0, 0), 520 * scale / 2.2)
        self.vignette = 1.0 - m
        self.shoes = [self.load_shoe(os.path.join(ROOT, "assets", s["file"])) for s in CFG["sneakers"]]
        self.text_cache = {}
        self.shake_ph = np.random.default_rng(3).uniform(0, 2 * math.pi, (2, 4))

    # --- primitives -------------------------------------------------------
    def poly_mask(self, pts):
        m = np.zeros((self.h, self.w), np.uint8)
        p = np.round(np.asarray(pts) * self.k * 16).astype(np.int32)
        cv2.fillPoly(m, [p], 255, lineType=cv2.LINE_AA, shift=4)
        return m.astype(np.float32) / 255.0

    def blur(self, a, amount):
        if amount <= 0.3:
            return a
        return cv2.GaussianBlur(a, (0, 0), max(amount * 0.45 * self.k, 0.3))

    @staticmethod
    def over(dst, rgb, alpha):
        a = alpha[..., None]
        dst *= (1 - a)
        dst += rgb * a

    @staticmethod
    def add(dst, rgb, alpha):
        dst += rgb * alpha[..., None]

    def warp_rgba(self, rgba, M):
        S = np.array([[self.k, 0, 0], [0, self.k, 0], [0, 0, 1]])
        A = (S @ M)[:2]
        return cv2.warpAffine(rgba, A, (self.w, self.h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0)

    def load_shoe(self, path):
        im = np.asarray(Image.open(path).convert("RGBA"), np.float32) / 255.0
        im[..., :3] *= im[..., 3:4]   # premultiply
        return im

    def text_sprite(self, text, size, tracking=0, outline=0):
        key = (text, size, tracking, outline)
        if key in self.text_cache:
            return self.text_cache[key]
        ss = 2
        font = ImageFont.truetype(self.font_path, size * ss)
        adv = [font.getlength(ch) + tracking / 1000 * size * ss for ch in text]
        wd = int(sum(adv) + size * ss * 0.4)
        asc, desc = font.getmetrics()
        im = Image.new("L", (wd, asc + desc + 20), 0)
        d = ImageDraw.Draw(im)
        x = size * ss * 0.2
        for ch, a in zip(text, adv):
            if outline:
                d.text((x, 10), ch, font=font, fill=0, stroke_width=outline * ss, stroke_fill=255)
            else:
                d.text((x, 10), ch, font=font, fill=255)
            x += a
        if outline:
            inner = Image.new("L", im.size, 0)
            di = ImageDraw.Draw(inner)
            x = size * ss * 0.2
            for ch, a in zip(text, adv):
                di.text((x, 10), ch, font=font, fill=255)
                x += a
            arr = np.clip(np.asarray(im, np.float32) - np.asarray(inner, np.float32), 0, 255)
            im = Image.fromarray(arr.astype(np.uint8))
        bb = im.getbbox()
        im = im.crop(bb).resize(((bb[2] - bb[0]) // ss, (bb[3] - bb[1]) // ss), Image.LANCZOS)
        a = np.asarray(im, np.float32) / 255.0
        rgba = np.dstack([a, a, a, a])
        # anchor: glyph-box centre; baseline offset for word layout
        base = (asc + 10 - bb[1]) / ss
        spr = (rgba, (rgba.shape[1] / 2, rgba.shape[0] / 2), base)
        self.text_cache[key] = spr
        return spr

    # --- controls / camera -------------------------------------------------
    def cam_shake(self, t):
        amp = CTRL["Shake Amount"]
        on = np.interp(t, [T["worldIn"], T["worldIn"] + 0.15], [0, 1]) * np.interp(t, [T["wipe"], T["wipe"] + 0.3], [1, 0])
        wx = sum(math.sin(t * 6 * f * 2 * math.pi / 3 + self.shake_ph[0, j]) / (j + 1) for j, f in enumerate([1, 1.7, 2.9, 4.3]))
        wy = sum(math.sin(t * 6 * f * 2 * math.pi / 3 + self.shake_ph[1, j]) / (j + 1) for j, f in enumerate([1, 1.7, 2.9, 4.3]))
        hits = [T["burst"]] + [T["shoeFirst"] + i * T["shoeStep"] for i in range(1, len(CFG["sneakers"]))]
        punch = 0.0
        for hh in hits:
            d = t - hh
            if 0 < d < 0.35:
                punch += math.sin(d * 60) * amp * 2.2 * (1 - d / 0.35)
        return np.array([wx * amp * 0.55 * on + punch, wy * amp * 0.55 * on - punch * 0.5])

    # --- scene ---------------------------------------------------------------
    def frame(self, t):
        img = np.zeros((self.h, self.w, 3), np.float32)
        shake = self.cam_shake(t)
        world = T["worldIn"] <= t < T["worldOut"]
        if world:
            self.bg_rainbow(img, t)
            self.sunburst(img, t)
            self.stripes(img, t, BACK, STRIPES["back"], shake * 0.7)
        self.sneakers(img, t, shake)
        if world:
            self.stripes(img, t, FRONT, STRIPES["front"], shake * 1.4)
        if t < T["burst"] + 0.75:
            self.intro(img, t)
        if t >= T["wipe"]:
            self.endcard(img, t)
        self.fx(img, t)
        return img

    def bg_rainbow(self, img, t):
        sat = CTRL["Rainbow Saturation"] / 100
        acc = np.zeros_like(img)
        wsum = np.zeros(img.shape[:2], np.float32)
        for k in range(4):
            a = t * 0.9 + k * math.pi / 2
            px, py = CX + math.cos(a) * W * 0.38, CY + math.sin(a) * H * 0.36
            col = hsl(t * CTRL["Rainbow Speed"] / 360 + k * 0.25, sat, 0.55)
            d2 = ((self.xx - px) / W) ** 2 + ((self.yy - py) / W) ** 2
            wk = 1.0 / (d2 + 0.004) ** 1.3
            acc += wk[..., None] * col
            wsum += wk
        img[:] = acc / wsum[..., None]

    def sunburst(self, img, t):
        M = affine((CX, CY), t * 25)
        m = np.zeros(img.shape[:2], np.float32)
        for k in range(16):
            R = affine((0, 0), k * 22.5)
            m = np.maximum(m, self.poly_mask(apply(M @ R, [(0, 0), (1800, -160), (1800, 160)])))
        self.over(img, np.ones(3, np.float32), m * 0.10)

    def stripes(self, img, t, lst, P, shake):
        pt = STRIPES["timeOffset"] + (t - T["worldIn"]) * CTRL["Stripe Speed"]
        op = CTRL["Stripe Opacity"] / 100 * P["opacity"] / 100
        for s in lst:
            x, y = stripe_pos(s, pt)
            pts = apply(affine((x + shake[0], y + shake[1]), s["angle"]), pill(s["len"], s["thick"]))
            if pts[:, 0].max() < -200 or pts[:, 0].min() > W + 200 or pts[:, 1].max() < -200 or pts[:, 1].min() > H + 200:
                continue
            m = self.blur(self.poly_mask(pts), s["blur"]) if s["blur"] > 0.5 else self.poly_mask(pts)
            self.over(img, c01(s["color"]), m * op)

    def shoe_times(self, i):
        tin = T["shoeFirst"] + i * T["shoeStep"]
        tout = tin + T["shoeStep"]
        return tin, tin + T["shoeArrive"], tin + T["shoeSettle"], tout, tout + T["shoeLeave"]

    def sneakers(self, img, t, shake):
        n = len(CFG["sneakers"])
        size = round(H * 0.36)
        for i in range(n):  # outline words (bottom of the precomp)
            tin, ta, ts, tout, tl = self.shoe_times(i)
            if not (tin - 0.02 <= t <= tl + 0.02):
                continue
            spr, anc, _ = self.text_sprite(CFG["sneakers"][i]["word"], size, 20, outline=5)
            pos = kv([[tin, [CX + W * 0.30, CY + H * 0.02], "L"], [tl, [CX - W * 0.30, CY + H * 0.02], "L"]], t) + shake
            op = float(kv([[tin, 0], [tin + 0.25, 70], [tout, 70], [tl, 0]], t)) / 100
            lay = self.warp_rgba(spr, affine(pos, 0, (1, 1), anc))
            self.over(img, lay[..., :3] / np.maximum(lay[..., 3:4], 1e-6), lay[..., 3] * op)
        S = CTRL["Sneaker Scale"] / 100
        for i in range(n):
            tin, ta, ts, tout, tl = self.shoe_times(i)
            if not (tin - 0.02 <= t <= tl + 0.05):
                continue
            E = [[10, 8], [75, 40], [60, 30], [40, 60], [5, 5]]
            TT = [tin, ta, ts, tout, tl]
            pos = kv([[TT[j], v, E[j]] for j, v in enumerate([[W * 1.47, CY + 30], [CX - W * 0.03, CY], [CX + W * 0.008, CY], [CX - W * 0.012, CY], [-W * 0.47, CY - 20]])], t)
            rot = float(kv([[TT[j], v, e] for j, (v, e) in enumerate(zip([-14, 3, 0, 0, -12], [[10, 8], [70, 40], [60, 60], [40, 60], [5, 5]]))], t))
            sc = float(kv([[TT[j], v, e] for j, (v, e) in enumerate(zip([88, 104, 100, 103, 94], [[10, 8], [70, 40], [60, 60], [40, 60], [5, 5]]))], t)) / 100
            Mn = affine(pos + shake, rot, (sc, sc))
            ph = i * 1.7
            lt = t - (tin - 0.02)
            # halo
            halo = self.poly_mask(apply(Mn, [(math.cos(a) * 750, -10 + math.sin(a) * 410) for a in np.linspace(0, 2 * math.pi, 64)]))
            self.over(img, np.ones(3, np.float32), self.blur(halo, 120 * sc) * 0.30)
            # contact shadow
            f = 1 - 0.08 * math.sin(lt * 2.8 + ph)
            shp = [(math.cos(a) * 625 * S * f, 300 * S + math.sin(a) * 55 * S * f) for a in np.linspace(0, 2 * math.pi, 48)]
            sh = self.blur(self.poly_mask(apply(Mn, shp)), 28 * sc)
            self.over(img, np.zeros(3, np.float32), sh * CTRL["Shadow Opacity"] / 100 * (0.85 + 0.15 * math.sin(lt * 2.8 + ph)))
            # shoe (+ drop shadow)
            fl = -CTRL["Sneaker Float"] * math.sin(lt * 2.8 + ph)
            Ms = Mn @ affine((0, fl), 1.2 * math.sin(lt * 1.9 + ph), (S, S), (800, 600))
            lay = self.warp_rgba(self.shoes[i], Ms)
            a = lay[..., 3]
            ds = self.blur(np.roll(a, int(round(18 * S * sc * self.k)), axis=0), 40 * S * sc)
            self.over(img, np.zeros(3, np.float32), ds * 0.5)
            img *= (1 - a[..., None])
            img += lay[..., :3]

    def intro(self, img, t):
        A = SWOOSH["heel"]
        S0, S1 = 0.76, SWOOSH["restScale"] / 100
        p0, p1 = (CX + A[0] * S0, CY + A[1] * S0), (CX + A[0] * S1, CY + A[1] * S1)
        orange = c01(SWOOSH_COLOR)
        if t < T["zoomEnd"]:
            op = float(kv([[T["swooshIn"] + 0.1, 0], [T["swooshSharp"] + 0.1, 28], [T["zoomStart"], 18], [T["zoomEnd"] - 0.15, 0]], t)) / 100
            glow = self.poly_mask([(CX + math.cos(a) * 750, CY + 20 + math.sin(a) * 325) for a in np.linspace(0, 2 * math.pi, 64)])
            self.over(img, orange, self.blur(glow, 180) * op)
        if t < T["zoomEnd"] + 1 / FPS:
            pos = kv([[T["swooshIn"], p0, [30, 30]], [T["swooshRest"], p1, [80, 85]], [T["zoomEnd"], [CX, CY], [0.1, 1, "linIn"]]], t)
            sc = float(kv([[T["swooshIn"], 76, [30, 30]], [T["swooshRest"], 88, [80, 85]], [T["zoomEnd"], 4200, [0.1, 1, "linIn"]]], t)) / 100
            rot = float(kv([[T["zoomStart"], 0, [30, 85]], [T["zoomEnd"], -12, [0.1, 1, "linIn"]]], t))
            op = float(kv([[T["swooshIn"], 0, [30, 30]], [T["swooshIn"] + 0.8, 100, [70, 30]]], t)) / 100
            bl = float(kv([[T["swooshIn"], 45, [30, 20]], [T["swooshSharp"], 0, [80, 30]]], t))
            gi = float(kv([[T["swooshIn"], 0], [T["swooshSharp"], 1.4], [T["zoomStart"], 0.5], [T["zoomEnd"], 0]], t))
            M = affine(pos, rot, (sc, sc), A)
            m = self.blur(self.poly_mask(apply(M, SWOOSH_PTS)), bl)
            if gi > 0.01 and sc < 3:
                self.add(img, orange, self.blur(m, 60 * 2.2) * gi * 0.55 * op)
            self.over(img, orange, m * op)
            if T["sweepStart"] - 0.05 <= t <= T["sweepEnd"] + 0.05:
                sp = kv([[T["sweepStart"], [CX - 760, CY], [50, 50]], [T["sweepEnd"], [CX + 760, CY], [50, 50]]], t)
                bar = self.blur(self.poly_mask(apply(affine(sp, 20), [(-80, -700), (80, -700), (80, 700), (-80, 700)])), 40)
                self.add(img, np.ones(3, np.float32), bar * m * 0.85)
        # burst rays + ring
        for k in range(8):
            tb = T["burst"] + k * 0.015
            if not (T["burst"] - 0.02 <= t <= T["burst"] + 0.7):
                break
            e = float(kv([[tb, 0, [10, 5]], [tb + 0.30, 100, [85, 10]]], t)) / 100
            s = float(kv([[tb + 0.10, 0, [10, 20]], [tb + 0.45, 100, [80, 10]]], t)) / 100
            if e - s <= 0.001:
                continue
            m = np.zeros((self.h, self.w), np.float32)
            for c in range(5):
                a = math.radians(k * 9 + 4 + c * 72)
                r0, r1 = 70 + 1430 * s, 70 + 1430 * e
                x0, y0 = CX + math.cos(a) * r0, CY + math.sin(a) * r0
                x1, y1 = CX + math.cos(a) * r1, CY + math.sin(a) * r1
                cv2.line(m, (int(x0 * self.k * 16), int(y0 * self.k * 16)), (int(x1 * self.k * 16), int(y1 * self.k * 16)), 1.0,
                         max(1, int((10 + (k % 3) * 6) * self.k)), cv2.LINE_AA, 4)
            self.over(img, c01(PALETTE[k % len(PALETTE)]), m)
        if T["burst"] - 0.02 <= t <= T["burst"] + 0.55:
            sc = float(kv([[T["burst"], 60, [10, 8]], [T["burst"] + 0.5, 1100, [85, 10]]], t)) / 100
            sw = float(kv([[T["burst"], 40, [10, 10]], [T["burst"] + 0.5, 0, [80, 10]]], t))
            op = float(kv([[T["burst"] + 0.2, 100], [T["burst"] + 0.5, 0]], t)) / 100
            m = np.zeros((self.h, self.w), np.float32)
            th = int(sw * sc * self.k)
            if th >= 1:
                cv2.circle(m, (int(CX * self.k), int(CY * self.k)), int(120 * sc * self.k), 1.0, th, cv2.LINE_AA)
                self.over(img, np.ones(3, np.float32), m * op)

    def endcard(self, img, t):
        sc = float(kv([[T["brandIn"], 100, [40, 30]], [T["fadeEnd"], 106, [30, 40]]], t)) / 100
        amp = CTRL["Shake Amount"] * 2.2
        d = t - T["brandHit"]
        o = math.sin(d * 95) * amp * (1 - d / 0.3) if 0 < d < 0.3 else 0
        Me = affine((CX + o, CY - o * 0.4), 0, (sc, sc), (CX, CY))
        bands = PALETTE[:7] + [[10, 10, 10]]
        for i, col in enumerate(bands):
            t0 = T["wipe"] + i * T["wipeStagger"]
            if t < t0 - 0.01 or (i < 7 and t > T["wipe"] + 1.2):
                continue
            x = float(kv([[t0, 3400, [10, 6]], [t0 + T["wipeDur"], CX, [90, 10]]], t))
            m = self.poly_mask(apply(Me @ affine((x, CY), 15), [(-1200, -900), (1200, -900), (1200, 900), (-1200, 900)]))
            self.over(img, c01(col), m)
        # NIKE.
        if t >= T["brandIn"] - 0.02:
            trk = float(kv([[T["brandSettle"], 0, [30, 40]], [T["fadeEnd"], 60, [40, 30]]], t))
            spr, anc, _ = self.text_sprite(CFG["brand"], round(H * 0.30), round(-10 + trk / 4) * 4)
            bsc = float(kv([[T["brandIn"], 185, [10, 20]], [T["brandHit"], 96, [60, 40]], [T["brandSettle"], 100, [70, 30]]], t)) / 100
            op = float(kv([[T["brandIn"], 0, [10, 10]], [T["brandIn"] + 0.06, 100]], t)) / 100
            bl = float(kv([[T["brandIn"], 35, [10, 20]], [T["brandHit"], 0, [60, 30]]], t))
            lay = self.warp_rgba(spr, Me @ affine((CX, H * 0.40), 0, (bsc, bsc), anc))
            a = self.blur(lay[..., 3], bl) * op
            self.over(img, np.ones(3, np.float32), a)
        # tagline
        if t >= T["tagIn"] - 0.02:
            size, base = round(H * 0.085), round(H * 0.645)
            sprites = [self.text_sprite(wd, size, 10) for wd in CFG["tagline"]]
            gap = size * 0.24
            total = sum(s[0].shape[1] for s in sprites) + gap * (len(sprites) - 1)
            x = CX - total / 2
            top, bottom = base - size * 0.95, base + size * 0.32
            Mi = np.linalg.inv(Me)   # mask lives in the TAGLINE layer space -> follows the end-card push/shake
            xpre = Mi[0, 0] * self.xx + Mi[0, 1] * self.yy + Mi[0, 2]
            ypre = Mi[1, 0] * self.xx + Mi[1, 1] * self.yy + Mi[1, 2]
            clip = np.clip((ypre - top) / 6, 0, 1) * np.clip((bottom - ypre) / 6, 0, 1)
            for i, (spr, anc, bline) in enumerate(sprites):
                t0 = T["tagIn"] + i * T["tagStagger"]
                y = float(kv([[t0, base + size * 1.4, [10, 8]], [t0 + T["tagDur"], base, [88, 10]]], t))
                lay = self.warp_rgba(spr, Me @ affine((x, y - bline), 0, (1, 1), (0, 0)))
                a = lay[..., 3] * clip
                if i == len(sprites) - 1:
                    x0, x1 = x, x + spr.shape[1]
                    hue = (t * CTRL["Rainbow Speed"] / 360 + (xpre - x0) / max(x1 - x0, 1) * 0.75) % 1.0
                    rgb = self.hue_img(hue)
                    self.over(img, rgb, a)
                else:
                    self.over(img, np.ones(3, np.float32), a)
                x += spr.shape[1] + gap
            # underline
            if t >= T["underline"] - 0.02:
                for j in range(6):
                    e = float(kv([[T["underline"] + j * 0.04, 0, [10, 8]], [T["underline"] + j * 0.04 + 0.35, 100, [85, 10]]], t)) / 100
                    if e <= 0.001:
                        continue
                    yv = base + size * 0.40 + j * 9
                    p = apply(Me, [(CX - total / 2, yv), (CX - total / 2 + total * e, yv)])
                    m = np.zeros((self.h, self.w), np.float32)
                    cv2.line(m, tuple(int(v * self.k * 16) for v in p[0]), tuple(int(v * self.k * 16) for v in p[1]), 1.0,
                             max(1, int(5 * sc * self.k)), cv2.LINE_AA, 4)
                    self.over(img, c01(PALETTE[j]), m)

    def hue_img(self, hue):
        h6 = hue * 6.0
        s, l = CTRL["Rainbow Saturation"] / 100, 0.6
        c = (1 - abs(2 * l - 1)) * s
        x = c * (1 - np.abs(h6 % 2 - 1))
        z = np.zeros_like(hue)
        idx = np.floor(h6).astype(int) % 6
        r = np.choose(idx, [c, x, z, z, x, c])
        g = np.choose(idx, [x, c, c, x, z, z])
        b = np.choose(idx, [z, z, x, c, c, x])
        m = l - c / 2
        return np.dstack([r + m, g + m, b + m]).astype(np.float32)

    def fx(self, img, t):
        fk = [[T["zoomEnd"] - 0.05, 0], [T["zoomEnd"], 70, [40, 8]], [T["zoomEnd"] + 0.17, 0, [85, 30]]]
        for i in range(1, len(CFG["sneakers"])):
            tc = T["shoeFirst"] + i * T["shoeStep"]
            fk += [[tc - 0.034, 0], [tc + 0.02, 30, [40, 8]], [tc + 0.18, 0, [85, 30]]]
        fk += [[T["brandHit"] - 0.02, 0], [T["brandHit"], 12, [40, 8]], [T["brandHit"] + 0.18, 0, [85, 30]]]
        fl = float(kv(fk, t)) / 100 * CTRL["Flash Intensity"] / 100
        img += fl
        np.clip(img, 0, 1, out=img)
        fade = float(kv([[T["fadeStart"], 0, [40, 40]], [T["fadeEnd"], 100, [70, 40]]], t)) / 100
        img *= 1 - fade
        g = CTRL["Grain Amount"] / 100
        img += (self.rng.random(img.shape[:2], np.float32)[..., None] - 0.5) * 2 * g * 0.5
        img *= 1 - self.vignette[..., None] * CTRL["Vignette"] / 100
        np.clip(img, 0, 1, out=img)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--font", required=True)
    ap.add_argument("--out", default="preview.mp4")
    ap.add_argument("--scale", type=float, default=0.5)
    ap.add_argument("--mb", type=int, default=4, help="motion-blur subsamples (180 deg shutter)")
    ap.add_argument("--sheet", default=None)
    ap.add_argument("--frames", default=None, help="comma list of frame numbers to render only (for stills)")
    args = ap.parse_args()
    r = Renderer(args.scale, args.font)
    total = int(DUR * FPS)
    frames = [int(f) for f in args.frames.split(",")] if args.frames else list(range(total))
    offs = np.linspace(-0.25, 0.25, args.mb) / FPS if args.mb > 1 else [0.0]
    stills = {}
    writer = None
    if not args.frames:
        writer = subprocess.Popen([imageio_ffmpeg.get_ffmpeg_exe(), "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24",
                                   "-s", "%dx%d" % (r.w, r.h), "-r", str(FPS), "-i", "-", "-c:v", "libx264", "-pix_fmt", "yuv420p",
                                   "-crf", "20", "-preset", "slow", "-movflags", "+faststart", args.out], stdin=subprocess.PIPE)
    for f in frames:
        t = f / FPS
        acc = None
        for d in offs:
            fr = r.frame(min(max(t + d, 0), DUR - 1e-4))
            acc = fr if acc is None else acc + fr
        img = (np.clip(acc / len(offs), 0, 1) * 255 + 0.5).astype(np.uint8)
        if writer:
            writer.stdin.write(img.tobytes())
        stills[f] = img
        if f % 30 == 0:
            print("frame", f, flush=True)
    if writer:
        writer.stdin.close()
        writer.wait()
    if args.sheet:
        pick = sorted(stills)[:: max(1, len(stills) // 16)][:16] if not args.frames else sorted(stills)
        tw, th = r.w // 2, r.h // 2
        cols = 4
        sheet = Image.new("RGB", (tw * cols, th * math.ceil(len(pick) / cols)))
        for n, f in enumerate(pick):
            im = Image.fromarray(stills[f]).resize((tw, th), Image.LANCZOS)
            ImageDraw.Draw(im).text((6, 4), "%d  %.2fs" % (f, f / FPS), fill=(255, 255, 255))
            sheet.paste(im, ((n % cols) * tw, (n // cols) * th))
        sheet.save(args.sheet, quality=90)


if __name__ == "__main__":
    main()
