# Dark backgrounds D1-D7 and the paper-grain texture overlay for style guide v1.2.
# Run: python3 make_dark_backgrounds.py   (needs numpy, pillow, scipy)
# Writes to ../backgrounds-dark/: bg-d*-1080x1920.png, bg-d*-1920x1080.png, texture-*.png, previews.
import math, os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from scipy.ndimage import gaussian_filter, zoom

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'backgrounds-dark')
FONT = os.path.join(HERE, '..', '..', 'fonts', 'RussoOne-Regular.ttf')
os.makedirs(OUT, exist_ok=True)

def noise(shape, sigma, rng):
    """Unit-variance noise blurred by sigma (large sigma is blurred at low resolution)."""
    if sigma < 0.5: a = rng.standard_normal(shape)
    elif sigma < 4: a = gaussian_filter(rng.standard_normal(shape), sigma)
    else:
        k = max(1, int(sigma // 4))
        small = gaussian_filter(rng.standard_normal((shape[0] // k + 2, shape[1] // k + 2)), sigma / k)
        a = zoom(small, k, order=3)[:shape[0], :shape[1]]
    a = a.astype(np.float32)
    return (a - a.mean()) / (a.std() + 1e-6)

def grid(W, H):
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    return xx, yy

def vignette(W, H, cx=.5, cy=.45, sx=.75, sy=.75):
    xx, yy = grid(W, H)
    return np.clip(((xx - W * cx) / (W * sx)) ** 2 + ((yy - H * cy) / (H * sy)) ** 2, 0, 1.6)

def rgb(v, tint=(1.0, 1.0, 1.0)):
    return np.stack([v * tint[0], v * tint[1], v * tint[2]], -1)

def to_img(a):
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))

def mask_blur(W, H, draw_fn, blur):
    m = Image.new('L', (W, H), 0); draw_fn(ImageDraw.Draw(m))
    return np.asarray(m.filter(ImageFilter.GaussianBlur(blur)) if blur else m, np.float32) / 255

# ------------------------------------------------------------------ D1 graphite concrete (dark twin of ref 1)
def d1(W, H, rng):
    v = 58 - 30 * vignette(W, H, cy=.35, sx=.8, sy=1.0)
    v += 3.0 * noise((H, W), 120, rng) + 2.0 * noise((H, W), 24, rng)
    v += 3.0 * noise((H, W), 1.2, rng) + 2.0 * noise((H, W), 0, rng)
    pores = (rng.random((H, W)) < 0.0008).astype(np.float32)
    v -= gaussian_filter(pores, 1.0) * 60
    return rgb(v, (1.0, 1.0, 1.03))

# ------------------------------------------------------------------ D2 dark studio floor with perspective grid (ref 2 inverted)
def d2(W, H, rng):
    xx, yy = grid(W, H)
    band = np.exp(-((yy - H * .55) / (H * .28)) ** 2) * np.exp(-((xx - W * .5) / (W * .55)) ** 2)
    v = 20 + 38 * band + 1.5 * noise((H, W), 60, rng)
    lines = np.zeros((H, W), np.float32)
    step = W / 6.2
    # verticals converge slightly to a vanishing point far below the frame, horizontals get denser to the edges
    for i in range(-8, 9):
        x0 = W / 2 + i * step
        m = mask_blur(W, H, lambda d, x0=x0: d.line([(x0 + (x0 - W / 2) * .08, 0), (x0 - (x0 - W / 2) * .08, H)], fill=255, width=3), 1.2)
        lines = np.maximum(lines, m)
    y, k = H * .55, 0
    while y < H * 1.1 and k < 30:
        for s in (1, -1):
            yl = H * .55 + s * (y - H * .55)
            m = mask_blur(W, H, lambda d, yl=yl: d.line([(0, yl), (W, yl)], fill=255, width=3), 1.2)
            lines = np.maximum(lines, m)
        y += step * (0.92 ** k); k += 1
    v += lines * (10 + 34 * band)
    return rgb(v, (1.0, 1.0, 1.04))

# ------------------------------------------------------------------ D3 near-black stage with one accent shape (refs 3, 5)
def d3(W, H, rng, shape='circle', col=(232, 117, 26)):
    v = 30 - 12 * vignette(W, H, sx=.9, sy=.9) + 1.5 * noise((H, W), 80, rng)
    base = rgb(v)
    cx, cy, r = W * .5, H * .5, min(W, H) * .42
    if shape == 'circle':
        m = mask_blur(W, H, lambda d: d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=255), 1.5)
    else:   # four-point star with concave sides
        pts = []   # astroid: four sharp points joined by concave curves
        for i in range(256):
            a = i / 256 * 2 * math.pi
            pts.append((cx + r * 1.3 * math.cos(a) ** 3, cy + r * 1.3 * math.sin(a) ** 3))
        m = mask_blur(W, H, lambda d: d.polygon(pts, fill=255), 1.5)
    shade = 1 - .22 * vignette(W, H, cx=.42, cy=.40, sx=.5, sy=.5)   # soft light on the shape
    colr = np.stack([np.full((H, W), c, np.float32) for c in col], -1) * shade[..., None]
    return base * (1 - m[..., None]) + colr * m[..., None]

# ------------------------------------------------------------------ D4 graphite ribbons (ref 4, darkened)
def d4(W, H, rng):
    xx, yy = grid(W, H)
    v = 46 - 22 * vignette(W, H, cx=.3, cy=.2, sx=1.1, sy=1.1) + 2 * noise((H, W), 60, rng)
    for (cx, cy, r, w, amp) in [(W * 1.25, H * .75, max(W, H) * .95, max(W, H) * .07, 26),
                                (W * 1.05, H * .55, max(W, H) * .62, max(W, H) * .04, -18),
                                (W * -.2, H * .1, max(W, H) * .55, max(W, H) * .05, 16)]:
        d = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2) - r
        ring = np.exp(-(d / w) ** 2)
        edge = np.exp(-((d - w * .8) / (w * .12)) ** 2) * 1.3   # thin highlight on one edge, like a folded ribbon
        v += amp * ring + abs(amp) * edge
    streak = np.exp(-(((xx - yy * .55) - W * .15) / (W * .05)) ** 2) * 8   # faint light streak
    return rgb(v + streak, (1.0, 1.0, 1.02))

# ------------------------------------------------------------------ D5 dark glow (refs 8-10), green or burgundy
def d5(W, H, rng, col=(18, 110, 52)):
    xx, yy = grid(W, H)
    base = np.full((H, W, 3), 6, np.float32)
    glow = np.zeros((H, W), np.float32)
    for (gx, gy, s, a) in [(1.0, 0.1, .45, 1.0), (0.05, 0.95, .40, .9), (0.95, 0.9, .30, .5)]:
        glow += a * np.exp(-(((xx - W * gx) / (max(W, H) * s)) ** 2 + ((yy - H * gy) / (max(W, H) * s)) ** 2))
    glow = np.clip(glow * (1 + .08 * noise((H, W), 160, rng)), 0, 1.0) ** 1.6
    return base + glow[..., None] * np.array(col, np.float32)[None, None] * .75

# ------------------------------------------------------------------ D6 black stipple (ref 7)
def d6(W, H, rng):
    v = 9 + 6 * (1 - vignette(W, H, sx=.9, sy=.9))
    dots = (rng.random((H, W)) < 0.012 * (1 - .7 * vignette(W, H, cy=.5, sx=.6, sy=.6))).astype(np.float32)
    v += gaussian_filter(dots, .6) * 90
    return rgb(v)

# ------------------------------------------------------------------ D7 soft depth: graph paper + blurred shapes (ref 6, dark)
def d7(W, H, rng):
    xx, yy = grid(W, H)
    v = 50 - 22 * vignette(W, H, sx=.8, sy=.8) + 2 * noise((H, W), 50, rng)
    cell = W / 14
    gl = (np.minimum(xx % cell, cell - xx % cell) < 1.2) | (np.minimum(yy % cell, cell - yy % cell) < 1.2)
    v += gl * 6 * (1 - vignette(W, H, sx=.55, sy=.45).clip(0, 1))
    # diagonal soft shadows (window light) and two out-of-focus spheres in the corners
    v -= 7 * np.clip(np.sin((xx + yy) / (W * .12)) * 2 - .6, 0, 1)
    for (cx, cy, r) in [(W * .25, -H * .02, W * .28), (W * .78, H * 1.0, W * .30)]:
        s = mask_blur(W, H, lambda d, cx=cx, cy=cy, r=r: d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=255), W * .04)
        v = v * (1 - s) + (v + 24) * s
    return rgb(v, (1.0, 1.0, 1.02))

# ------------------------------------------------------------------ texture overlay (paper tooth from ref 1), mid-grey for Overlay/Soft Light
def texture(W, H, rng):
    t = 128 + 10 * noise((H, W), 0, rng) + 13 * noise((H, W), 1.0, rng) + 8 * noise((H, W), 3, rng) + 6 * noise((H, W), 40, rng)
    fibers = gaussian_filter(rng.standard_normal((H, W)).astype(np.float32), (0.6, 5)) * 18   # faint paper fibres
    t += fibers
    specks = (rng.random((H, W)) < 0.0006).astype(np.float32)
    t -= gaussian_filter(specks, 0.9) * 140
    return Image.fromarray(np.clip(t, 0, 255).astype(np.uint8), 'L')

def halftone_tile(cell=12, rmax=3.6):
    """Tileable 45-degree dot screen, black dots on transparent, for shadow falloff."""
    n = cell * 8
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float32)
    u = (xx + yy) / math.sqrt(2); v = (xx - yy) / math.sqrt(2)
    c = cell / math.sqrt(2) * 2
    d = np.sqrt(((u % c) - c / 2) ** 2 + ((v % c) - c / 2) ** 2)
    a = np.clip(rmax - d + .5, 0, 1)
    img = Image.new('RGBA', (n, n), (0, 0, 0, 0)); img.putalpha(Image.fromarray((a * 255).astype(np.uint8)))
    return img

def overlay(base, tex, opacity):
    """Photoshop/AE Overlay blend of a grey texture over an RGB image."""
    b = np.asarray(base, np.float32) / 255; t = (np.asarray(tex, np.float32) / 255)[..., None]
    o = np.where(b < .5, 2 * b * t, 1 - 2 * (1 - b) * (1 - t))
    return to_img((b + (o - b) * opacity) * 255)

BGS = [
    ('d1-graphite-concrete', d1), ('d2-dark-grid-floor', d2),
    ('d3-accent-circle-orange', lambda W, H, r: d3(W, H, r, 'circle', (232, 117, 26))),
    ('d3-accent-star-mint', lambda W, H, r: d3(W, H, r, 'star', (79, 211, 154))),
    ('d4-graphite-ribbons', d4),
    ('d5-glow-green', lambda W, H, r: d5(W, H, r, (18, 110, 52))),
    ('d5-glow-burgundy', lambda W, H, r: d5(W, H, r, (120, 22, 30))),
    ('d6-black-stipple', d6), ('d7-soft-depth', d7),
]

def red_text(txt, size):
    """Rough S1 subtitle for previews: coral gradient fill, dark bevel edge, drop shadow."""
    f = ImageFont.truetype(FONT, size)
    w, h = int(f.getlength(txt)) + 40, size + 40
    m = Image.new('L', (w, h), 0); ImageDraw.Draw(m).text((20, 12), txt, font=f, fill=255)
    grad = np.linspace(0, 1, h)[:, None, None] * (np.array([238, 94, 82]) - np.array([255, 138, 126])) + np.array([255, 138, 126])
    fill = Image.fromarray(np.broadcast_to(grad, (h, w, 3)).astype(np.uint8)).convert('RGBA'); fill.putalpha(m)
    edge = Image.new('RGBA', (w, h), (195, 77, 78, 255)); edge.putalpha(m.filter(ImageFilter.MaxFilter(3)))
    sh = Image.new('RGBA', (w + 20, h + 20), (0, 0, 0, 0))
    s = Image.new('RGBA', (w, h), (0, 0, 0, 255)); s.putalpha(m.filter(ImageFilter.GaussianBlur(6)).point(lambda q: int(q * .6)))
    sh.alpha_composite(s, (8, 10)); sh.alpha_composite(edge, (0, 2)); sh.alpha_composite(fill, (0, 0))
    return sh

def main():
    for (W, H) in [(1080, 1920), (1920, 1080)]:
        rng = np.random.default_rng(12)
        tex = texture(W, H, rng)
        tex.save(os.path.join(OUT, f'texture-paper-grain-{W}x{H}.png'))
        thumbs = []
        for name, fn in BGS:
            img = to_img(fn(W, H, np.random.default_rng(sum(map(ord, name)))))
            img.save(os.path.join(OUT, f'bg-{name}-{W}x{H}.png'), optimize=True)
            if W == 1080:
                p = overlay(img, tex, .45).convert('RGBA')
                t = red_text('ТЁМНЫЙ ФОН', 96); p.alpha_composite(t, ((W - t.width) // 2, 1210))
                thumbs.append((name, p.convert('RGB')))
        if thumbs:
            tw, th, pad = 270, 480, 14
            sheet = Image.new('RGB', (pad + len(thumbs) * (tw + pad), th + 2 * pad + 34), (12, 12, 12))
            f = ImageFont.truetype(FONT, 20); d = ImageDraw.Draw(sheet)
            for i, (name, p) in enumerate(thumbs):
                x = pad + i * (tw + pad)
                sheet.paste(p.resize((tw, th), Image.LANCZOS), (x, pad))
                d.text((x, th + pad + 6), name.split('-')[0].upper(), font=f, fill=(230, 230, 230))
            sheet.save(os.path.join(OUT, 'backgrounds-dark-preview.jpg'), quality=86)
    halftone_tile().save(os.path.join(OUT, 'halftone-dots-tile.png'))

    # before/after of the texture on a flat mid-grey + dark patch, so its strength is visible
    W, H = 1080, 1920
    tex = Image.open(os.path.join(OUT, 'texture-paper-grain-1080x1920.png'))
    img = to_img(d3(W, H, np.random.default_rng(3), 'circle', (232, 117, 26)))
    after = overlay(img, tex, .45)
    crop = (60, 1000, 660, 1600)
    ba = Image.new('RGB', (1220, 600), (0, 0, 0))
    ba.paste(img.crop(crop), (0, 0)); ba.paste(after.crop(crop), (620, 0))
    ba.save(os.path.join(OUT, 'texture-before-after.jpg'), quality=90)

if __name__ == '__main__':
    main()
