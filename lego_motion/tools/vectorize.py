"""Vectorize the LEGO character into clean bezier shapes for After Effects.

For every body part (head, torso, arms, hands, legs) this traces:
  * colour regions (skin / green hat / white legs) up to the CENTRE of their black outline ->
    drawn in AE as fill + uniform 9 px stroke, so every part is a closed, crisp shape;
  * interior line art (face, beard dots, abs, rose tattoo, seams) -> filled black paths.
Output: lego_vectors.jsxinc, an object literal the AE builder loads with $.evalFile().

Usage: python3 vectorize.py <character.png|webp> <out.jsxinc>      (pip install potracer opencv-python-headless)
"""
import json
import sys

import cv2
import numpy as np
import potrace
from PIL import Image

LINE_MAX = 45          # pixel is outline/line art if its brightest channel is below this
HALF_LINE = 5          # half of the outline width: regions are grown to the outline centre
TORSO_TOP, TORSO_BOTTOM, ARM_TOP, CUFF, HAND_BOTTOM, HIPS_TOP = 519, 926, 545, 852, 1060, 912
NECK = (468, 662)
ALLOWED = {"HEAD": ("green", "skin"), "LEGS": ("white",)}
UNION_PARTS = ("TORSO", "ARM_L", "ARM_R")   # one clean silhouette each; torso abs / tattoo stay line art
ALLOWED.update({k: ("skin",) for k in ("TORSO", "ARM_L", "ARM_R", "HAND_L", "HAND_R")})
EDGE_GUESS_L = lambda y: 394 - 0.16 * (y - 550)
EDGE_GUESS_R = lambda y: 735 + 0.16 * (y - 550)


def track_line(black, guess, y0, y1, search=14):
    """per-row column of the torso-facing side of a torso side outline"""
    edge = []
    for y in range(y0, y1):
        g = int(round(guess(y)))
        xs = np.nonzero(black[y, g - search:g + search + 1])[0] + g - search
        if len(xs) == 0:
            edge.append(np.nan)
            continue
        c = xs[np.argmin(np.abs(xs - g))]
        l = r = c
        while l - 1 >= g - search and black[y, l - 1]:
            l -= 1
        while r + 1 <= g + search and black[y, r + 1]:
            r += 1
        edge.append((l, r))
    return edge


def part_masks(im):
    h, w = im.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w]
    black = (im[..., 3] > 128) & (im[..., :3].max(-1) < LINE_MAX)
    y0, y1 = 500, 940
    L = track_line(black, EDGE_GUESS_L, y0, y1)
    R = track_line(black, EDGE_GUESS_R, y0, y1)
    # centre of each side line (the cut goes exactly through the middle of the shared outline)
    def centre(runs, guess):
        c = np.array([(run[0] + run[1]) / 2 if isinstance(run, tuple) else np.nan for run in runs], float)
        idx = np.arange(len(c))
        ok = ~np.isnan(c)
        c = np.interp(idx, idx[ok], c[ok])
        k = 7
        c = np.array([np.median(c[max(0, i - k):i + k + 1]) for i in range(len(c))])
        full = np.array([guess(y) for y in range(h)], float)
        full[y0:y1] = c
        return full[:, None]
    cl, cr = centre(L, EDGE_GUESS_L), centre(R, EDGE_GUESS_R)
    return {
        "HEAD": ((yy < TORSO_TOP + 6) & (xx > 390) & (xx < 740)) | ((yy < 532) & (yy > 480) & (xx >= NECK[0]) & (xx <= NECK[1])),
        "TORSO": (yy >= TORSO_TOP + 3) & (yy < TORSO_BOTTOM) & (xx >= cl) & (xx <= cr),
        "ARM_L": (yy >= ARM_TOP) & (yy <= CUFF + 22) & (xx <= cl) & (xx > 150),
        "ARM_R": (yy >= ARM_TOP) & (yy <= CUFF + 22) & (xx >= cr) & (xx < 980),
        "HAND_L": (yy >= CUFF - 4) & (yy < HAND_BOTTOM) & (xx > 150) & (((yy < 925) & (xx < cl - 8)) | ((yy >= 925) & (xx < 345))),
        "HAND_R": (yy >= CUFF - 4) & (yy < HAND_BOTTOM) & (xx < 980) & (((yy < 925) & (xx > cr + 8)) | ((yy >= 925) & (xx > 785))),
        "LEGS": (yy >= HIPS_TOP) & (xx >= 342) & (xx <= 790),
    }


def fill_holes(m, max_area):
    m8 = m.astype(np.uint8)
    n, lab, st, _ = cv2.connectedComponentsWithStats(1 - m8, connectivity=4)
    out = m.copy()
    border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]])))
    for i in range(1, n):
        if i not in border and st[i, 4] <= max_area:
            out[lab == i] = True
    return out


def disk(r):
    return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))


def trace(mask, turdsize, alphamax):
    """potrace -> list of AE-style paths {v, i, o} (closed)"""
    paths = []
    bm = potrace.Bitmap(~mask)            # potracer traces the False pixels
    for curve in bm.trace(turdsize=turdsize, alphamax=alphamax, opticurve=True, opttolerance=0.25):
        v, ti, to = [], [], []
        start = curve.start_point
        prev = (start.x, start.y)
        v.append(prev); ti.append((0, 0)); to.append((0, 0))
        for s in curve.segments:
            if s.is_corner:
                for p in (s.c, s.end_point):
                    v.append((p.x, p.y)); ti.append((0, 0)); to.append((0, 0))
            else:
                to[-1] = (s.c1.x - v[-1][0], s.c1.y - v[-1][1])
                e = (s.end_point.x, s.end_point.y)
                v.append(e); ti.append((s.c2.x - e[0], s.c2.y - e[1])); to.append((0, 0))
        # last vertex == start: fold it into the first one
        if len(v) > 1 and abs(v[-1][0] - v[0][0]) < 1e-6 and abs(v[-1][1] - v[0][1]) < 1e-6:
            ti[0] = ti[-1]
            v.pop(); ti.pop(); to.pop()
        r1 = lambda a: [[round(x, 1), round(y, 1)] for x, y in a]
        paths.append({"v": r1(v), "i": r1(ti), "o": r1(to)})
    return paths


def main(src, out):
    im = np.asarray(Image.open(src).convert("RGBA")).astype(np.int32)
    rgb, a = im[..., :3], im[..., 3]
    opaque = a > 128
    line = opaque & (rgb.max(-1) < LINE_MAX)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    classes = {
        "green": (g > r + 40) & (g > b + 30),
        "white": rgb.min(-1) > 190,
    }
    classes["skin"] = ~classes["green"] & ~classes["white"]
    data = {"lineWidth": 2 * HALF_LINE - 1, "parts": {}}
    for name, pm in part_masks(im).items():
        part_px = pm & opaque
        grown_part = cv2.dilate(part_px.astype(np.uint8), disk(1)).astype(bool)
        regions, union, band = [], np.zeros_like(part_px), np.zeros_like(part_px)
        for cname, cond in classes.items():
            if cname not in ALLOWED[name]:
                continue
            px = part_px & ~line & cond
            px = cv2.morphologyEx(px.astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8)).astype(bool)
            if px.sum() < 300:
                continue
            lum = rgb[px].mean(-1)
            colour = rgb[px][np.argsort(lum)[int(len(lum) * 0.65)]].tolist()   # mid-light tone, not the shadow
            if name in UNION_PARTS:
                pieces = [px]
            else:  # every closed piece (wrist, cuff, C-hand, neck, hat, stud, leg blocks) gets its own outline
                n, lab, st, _ = cv2.connectedComponentsWithStats(px.astype(np.uint8), connectivity=4)
                pieces = [lab == i for i in range(1, n) if st[i, 4] >= 30]
                if name.startswith("HAND"):           # only the wrist stem and the C-hand; the cuff rim belongs to the arm
                    pieces = [p for p in pieces if np.nonzero(p)[0].min() >= CUFF + 4]
                    # ...and no leftover crumbs of the cuff rim beside the wrist (short pieces near the top)
                    pieces = [p for p in pieces if not (np.nonzero(p)[0].min() < 880 and np.ptp(np.nonzero(p)[0]) < 40)]
                if name == "HEAD" and cname == "skin":   # the shadow under the chin splits the neck: keep it one piece
                    neck = [p for p in pieces if np.nonzero(p)[0].mean() > 494]
                    pieces = [p for p in pieces if np.nonzero(p)[0].mean() <= 494] + ([np.logical_or.reduce(neck)] if neck else [])
            for piece in pieces:
                m = cv2.dilate(piece.astype(np.uint8), disk(HALF_LINE)).astype(bool) & grown_part
                m = cv2.morphologyEx(m.astype(np.uint8), cv2.MORPH_CLOSE, disk(4)).astype(bool)
                m = fill_holes(m, 3000)
                if name == "HEAD" and np.nonzero(piece)[0].mean() > 494:
                    m[490:575, NECK[0]:NECK[1] + 1] = True   # neck: from the chin line down under the torso (no gap when the head tilts)
                paths = trace(m, 20, 0.9)
                if paths:
                    regions.append({"name": cname, "color": colour, "paths": paths})
                    union |= m
                    band |= m & ~cv2.erode(m.astype(np.uint8), disk(HALF_LINE + 2)).astype(bool)
        inner = cv2.erode(fill_holes(union, 10 ** 6).astype(np.uint8), disk(HALF_LINE + 3)).astype(bool)
        details = line & inner & ~band       # outlines between pieces are drawn by the pieces' strokes
        if name == "HEAD":
            details[494:, :] = False          # neck: only the chin shadow there, no line art
        if name.startswith("ARM"):
            details[:] = False                # LEGO arm = one smooth piece (no cuff sliver)
        data["parts"][name] = {"regions": regions, "details": trace(details, 3, 1.0)}
        nd = sum(len(p["v"]) for p in data["parts"][name]["details"])
        print(name, [(rg["name"], len(rg["paths"]), sum(len(p["v"]) for p in rg["paths"])) for rg in regions],
              "details paths", len(data["parts"][name]["details"]), "verts", nd)
    txt = json.dumps(data, separators=(",", ":"))
    with open(out, "w") as f:
        f.write("// generated by tools/vectorize.py - vector shapes of the LEGO character (canvas 1122x1500 px)\n(" + txt + ")\n")
    print("written", out, len(txt) // 1024, "KB")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
