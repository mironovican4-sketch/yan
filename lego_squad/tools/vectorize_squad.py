"""Vectorize LEGO-minifig illustrations into clean bezier parts for After Effects.

For each character (see CHARS) the figure is split into HEAD / TORSO / ARM_L / ARM_R / HAND_L /
HAND_R / LEGS along its construction lines (torso side seams are refined automatically from a rough
guess). Every part becomes:
  * base  - the part silhouette shrunk to the CENTRE of its outer outline, filled with the part's main
            colour; the AE builder strokes it with a uniform 9 px outline -> crisp edges;
  * prints - colour-quantized artwork inside the part (faces, hair, chains, letters, seams), each colour
            traced with potrace and stacked on top of the base.
Works for black clothing too (where outline and fabric are both black).

Usage: python3 vectorize_squad.py <images_dir> <out_dir> [--debug <dir>]
Needs: numpy, opencv-python-headless, pillow, potracer
"""
import json
import os
import sys

import cv2
import numpy as np
import potrace
from PIL import Image
from scipy import ndimage

HALF_LINE = 5

# Rough construction lines per character (image px). seams: [[x_top, y_top], [x_bottom, y_bottom]]
CHARS = {
    "RED_DREADS": {"file": "10.webp", "ttop": 737, "tbot": 1203, "cuff": [1150, 1150],
                   "seamL": [[551, 760], [475, 1175]], "seamR": [[1003, 760], [1079, 1175]]},
    "ANGRY_CHAIN": {"file": "11.webp", "degrain": True, "ttop": 752, "tbot": 1212, "cuff": [1150, 1150],
                    "seamL": [[540, 770], [482, 1184]], "seamR": [[958, 770], [1016, 1184]]},
    "SMILE_VARSITY": {"file": "12.webp", "ttop": 736, "tbot": 1150, "cuff": [1090, 1090],
                      "seamL": [[556, 755], [497, 1130]], "seamR": [[938, 755], [997, 1130]]},
    "ASTRO_BRICK": {"file": "13.webp", "ttop": 730, "tbot": 1225, "cuff": [1165, 1165],
                    "seamL": [[538, 750], [468, 1205]], "seamR": [[962, 750], [1032, 1205]]},
    "RED_SUIT": {"file": "14.webp", "ttop": 724, "tbot": 1168, "cuff": [1110, 1110],
                 "seamL": [[563, 745], [501, 1150]], "seamR": [[937, 745], [997, 1150]]},
}


def disk(r):
    return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))


def refine_seam(maxc, guess, y0, y1, win=22):
    """find the dark outline run near a rough straight line on every row, fit a straight line"""
    (xa, ya), (xb, yb) = guess
    gx = lambda y: xa + (xb - xa) * (y - ya) / (yb - ya)
    ys, xs = [], []
    for y in range(int(y0), int(y1), 2):
        g = int(round(gx(y)))
        row = maxc[y, g - win:g + win + 1].astype(float)
        row = np.convolve(row, np.ones(5) / 5, "same")
        i = int(np.argmin(row))
        local = np.median(maxc[y, g - win:g + win + 1])
        if row[i] < 45 and (row[i] < local - 8 or row[i] < 10):
            ys.append(y); xs.append(g - win + i)
    ys, xs = np.array(ys, float), np.array(xs, float)
    for _ in range(3):  # robust straight-line fit
        k, b = np.polyfit(ys, xs, 1)
        res = np.abs(xs - (k * ys + b))
        keep = res < max(2.5, np.percentile(res, 75))
        ys, xs = ys[keep], xs[keep]
    k, b = np.polyfit(ys, xs, 1)
    return lambda y: k * y + b, (k, b, len(ys))


def fill_holes(m, max_area):
    n, lab, st, _ = cv2.connectedComponentsWithStats((~m).astype(np.uint8), connectivity=4)
    out = m.copy()
    border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]])))
    for i in range(1, n):
        if i not in border and st[i, 4] <= max_area:
            out[lab == i] = True
    return out


def trace(mask, turdsize, alphamax=1.0):
    paths = []
    for curve in potrace.Bitmap(~mask).trace(turdsize=turdsize, alphamax=alphamax, opticurve=True, opttolerance=0.25):
        v, ti, to = [(curve.start_point.x, curve.start_point.y)], [(0, 0)], [(0, 0)]
        for s in curve.segments:
            if s.is_corner:
                for p in (s.c, s.end_point):
                    v.append((p.x, p.y)); ti.append((0, 0)); to.append((0, 0))
            else:
                to[-1] = (s.c1.x - v[-1][0], s.c1.y - v[-1][1])
                e = (s.end_point.x, s.end_point.y)
                v.append(e); ti.append((s.c2.x - e[0], s.c2.y - e[1])); to.append((0, 0))
        if len(v) > 1 and abs(v[-1][0] - v[0][0]) < 1e-6 and abs(v[-1][1] - v[0][1]) < 1e-6:
            ti[0] = ti[-1]; v.pop(); ti.pop(); to.pop()
        r1 = lambda a: [[round(x, 1), round(y, 1)] for x, y in a]
        paths.append({"v": r1(v), "i": r1(ti), "o": r1(to)})
    return paths


def kmeans_colors(px, k):
    px = px.astype(np.float32)
    if len(px) > 60000:
        px = px[np.random.default_rng(0).choice(len(px), 60000, replace=False)]
    k = min(k, len(np.unique(px.astype(int), axis=0)))
    _, labels, centers = cv2.kmeans(px, k, None, (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 40, 0.5), 4,
                                    cv2.KMEANS_PP_CENTERS)
    # merge near-identical colours
    merged = []
    for c in centers:
        if all(np.linalg.norm(c - m) > 22 for m in merged):
            merged.append(c)
    return np.array(merged)


def base_guess(lab, inside):
    vals, cnt = np.unique(lab[inside & (lab >= 0)], return_counts=True)
    return vals[cnt.argmax()]


def mode_filter(lab, k, size=5):
    """majority filter on a label map (cleans anti-aliasing slivers between colours)"""
    votes = np.stack([cv2.blur((lab == i).astype(np.float32), (size, size)) for i in range(k)])
    return votes.argmax(0)


def vectorize(name, cfg, img_dir, debug_dir=None):
    im = np.asarray(Image.open(os.path.join(img_dir, cfg["file"])).convert("RGBA")).astype(np.int32)
    rgb, alpha = im[..., :3], im[..., 3]
    h, w = alpha.shape
    # flat colours for the prints: remove the printed grain/speckle texture, keep edges sharp
    flat = np.where((alpha > 128)[..., None], rgb, 255).astype(np.uint8)
    flat = cv2.pyrMeanShiftFiltering(flat, 10, 26)
    flat = cv2.medianBlur(flat, 5).astype(np.int32)
    # true ink lines (much darker than black fabric) are kept as their own colour
    ink = cv2.medianBlur(np.where(alpha > 128, rgb.max(-1), 255).astype(np.uint8), 3) < 14
    ink = cv2.morphologyEx(ink.astype(np.uint8), cv2.MORPH_OPEN, disk(3)).astype(bool)   # lines stay, grain dots go
    fig = alpha > 128
    maxc = np.where(fig, rgb.max(-1), 255)
    ttop, tbot = cfg["ttop"], cfg["tbot"]
    sL, infoL = refine_seam(maxc, cfg["seamL"], ttop + 25, tbot - 15)
    sR, infoR = refine_seam(maxc, cfg["seamR"], ttop + 25, tbot - 15)
    yy, xx = np.mgrid[0:h, 0:w]
    xL, xR = sL(yy), sR(yy)
    cx = (sL(ttop) + sR(ttop)) / 2
    cuffL, cuffR = cfg["cuff"]
    legL, legR = sL(tbot) - 4, sR(tbot) + 4

    poly = {
        "HEAD": (yy < ttop) | ((yy < ttop + 40) & (np.abs(xx - cx) < (sR(ttop) - sL(ttop)) * 0.28)),
        "TORSO": (yy >= ttop) & (yy < tbot) & (xx >= xL) & (xx <= xR),
        "ARM_L": (yy >= ttop) & (yy <= cuffL) & (xx < xL),
        "ARM_R": (yy >= ttop) & (yy <= cuffR) & (xx > xR),
        "HAND_L": (yy > cuffL) & (((yy < tbot) & (xx < xL)) | ((yy >= tbot) & (xx < legL))),
        "HAND_R": (yy > cuffR) & (((yy < tbot) & (xx > xR)) | ((yy >= tbot) & (xx > legR))),
        "LEGS": (yy >= tbot) & (xx >= legL) & (xx <= legR),
    }
    core = cv2.erode(fig.astype(np.uint8), disk(HALF_LINE)).astype(bool)   # silhouette at the outline centre
    below = core & (yy >= tbot)
    n_b, lab_b, _, _ = cv2.connectedComponentsWithStats(below.astype(np.uint8), connectivity=4)
    # hips: every component crossing a row just under the torso, between the seams
    # (the centre column can fall into the gap between the legs)
    x0, x1 = int(sL(tbot)) + 40, int(sR(tbot)) - 40
    ids = set(int(v) for v in lab_b[tbot + 15, x0:x1]) - {0}
    legs_core = np.isin(lab_b, list(ids))
    legs_zone = cv2.dilate(legs_core.astype(np.uint8), disk(HALF_LINE + 3)).astype(bool) & (yy >= tbot)
    poly["LEGS"] = legs_zone
    poly["HAND_L"] = (yy > cuffL) & (xx < cx) & ~legs_zone & ~poly["TORSO"]
    poly["HAND_R"] = (yy > cuffR) & (xx >= cx) & ~legs_zone & ~poly["TORSO"]
    out = {"name": name, "size": [w, h], "lineWidth": 2 * HALF_LINE - 1, "parts": {},
           "landmarks": {"ttop": ttop, "tbot": tbot, "cuffL": cuffL, "cuffR": cuffR, "cx": round(cx, 1),
                         "seamL": [round(sL(ttop), 1), round(sL(tbot), 1)], "seamR": [round(sR(ttop), 1), round(sR(tbot), 1)]}}
    # shoulders: arms turn about a ball joint just outside the seam, upper torso
    tw = sR(ttop) - sL(ttop)
    ys_sh = ttop + 0.17 * (tbot - ttop)
    shoulder = {"ARM_L": (float(sL(ys_sh) - 0.06 * tw), ys_sh, xx < xL - (HALF_LINE + 5)),
                "ARM_R": (float(sR(ys_sh) + 0.06 * tw), ys_sh, xx > xR + (HALF_LINE + 5))}
    dt_core = cv2.distanceTransform(core.astype(np.uint8), cv2.DIST_L2, 5)
    for part, pm in poly.items():
        region = core & pm
        region = cv2.morphologyEx(region.astype(np.uint8), cv2.MORPH_OPEN, disk(2)).astype(bool)
        n, lab, st, _ = cv2.connectedComponentsWithStats(region.astype(np.uint8), connectivity=8)
        big = st[1:, 4].max() if n > 1 else 0
        keep = [i for i in range(1, n) if st[i, 4] > max(400, 0.08 * big)]
        region = np.isin(lab, keep)
        if part == "HEAD":  # neck runs on under the torso: no gap when the head tilts
            cols_neck = region[ttop - 12] & (np.abs(np.arange(w) - cx) < (sR(ttop) - sL(ttop)) * 0.3)
            region |= cols_neck[None, :] & (yy >= ttop - 12) & (yy < ttop + 45)
        cap = None
        if part in shoulder:   # round shoulder cap: the arm rotates without a sharp seam corner
            px, py, away = shoulder[part]
            r = float(dt_core[int(round(py)), int(round(px))]) - 1
            cap = ((xx - px) ** 2 + (yy - py) ** 2 <= r * r) & core
            region |= cap
        if not region.any():
            continue
        fillreg = fill_holes(region, 200000)
        inside = fig & pm & fillreg
        k = 12 if part in ("TORSO", "HEAD") else 6
        cols = kmeans_colors(flat[inside], k)
        d = ((flat[..., None, :].astype(np.float32) - cols[None, None]) ** 2).sum(-1)
        lab = np.where(inside, d.argmin(-1), -1)
        lab = np.where(inside, mode_filter(np.maximum(lab, 0), len(cols), 5), -1)
        cols = np.vstack([cols, [[6, 6, 6]]])
        ink_p = ink & inside
        if cfg.get("degrain"):   # printed grain: drop small roundish ink blobs (keep lines and facial features)
            n_i, lab_i, st_i, _ = cv2.connectedComponentsWithStats(ink_p.astype(np.uint8), connectivity=8)
            lim = 120 if part == "HEAD" else 450
            small = [j for j in range(1, n_i) if st_i[j, 4] < lim and max(st_i[j, 2], st_i[j, 3]) < 32]
            ink_p &= ~np.isin(lab_i, small)
            if part != "HEAD":
                lab = np.where(inside & ink & ~ink_p, base_guess(lab, inside), lab)
        lab = np.where(ink_p, len(cols) - 1, lab)
        # gold chains: thin links are lost by the smoothing, rebuild them from the raw pixels
        r_, g_, b_ = rgb[..., 0], rgb[..., 1], rgb[..., 2]
        gold = inside & (r_ > 150) & (g_ > 110) & (b_ < 120) & (r_ - b_ > 70) & (np.abs(r_ - g_) < 90)
        gold = cv2.morphologyEx(gold.astype(np.uint8), cv2.MORPH_CLOSE, disk(3)).astype(bool)
        if gold.sum() > 300 and part in ("TORSO", "HEAD"):
            cols = np.vstack([cols, [np.median(rgb[gold & (rgb.max(-1) > 150)], axis=0)]])
            lab = np.where(gold, len(cols) - 1, lab)
        if cap is not None:   # cap over the seam/torso: continue the arm's own colours (nearest arm pixel)
            src = (lab >= 0) & away
            _, (iy, ix) = ndimage.distance_transform_edt(~src, return_indices=True)
            over = cap & ~away
            lab = np.where(over, lab[iy, ix], lab)
        areas = np.array([(lab == i).sum() for i in range(len(cols))])
        base = int(areas.argmax())
        base_col = cols[base]
        prints = []
        edge_band = fillreg & ~cv2.erode(fillreg.astype(np.uint8), disk(HALF_LINE + 2)).astype(bool)
        for i in np.argsort(-areas):
            if i == base or areas[i] < 30:
                continue
            m = (lab == i) & fillreg
            if cols[i].max() < 60:          # black: the outer outline band is drawn by the stroke
                m &= ~edge_band
            m = cv2.morphologyEx(m.astype(np.uint8), cv2.MORPH_OPEN, np.ones((2, 2), np.uint8)).astype(bool)
            if m.sum() < 30:
                continue
            paths = trace(m, turdsize=60 if cols[i].max() < 60 else 14, alphamax=1.0)
            if paths:
                prints.append({"color": [int(round(c)) for c in cols[i]], "paths": paths})
        out["parts"][part] = {"base": {"color": [int(round(c)) for c in base_col], "paths": trace(region, 40, 0.9)},
                              "prints": prints[::-1]}   # small/late colours last -> drawn on top in AE order reversed
        print(name, part, "base", out["parts"][part]["base"]["color"], "prints", len(prints),
              "verts", sum(len(p["v"]) for pr in prints for p in pr["paths"]))
    # joint pivots (image px): neck, hips, feet, shoulders (just outside the seam, upper torso), wrists
    def wrist(part, cuff):
        reg = poly[part] & core
        cols = np.nonzero(reg[cuff + 6:cuff + 26].any(0))[0]
        return [round(float((cols.min() + cols.max()) / 2), 1), cuff + 12]
    feet = int(np.nonzero((poly["LEGS"] & fig).any(1))[0].max())
    out["pivots"] = {
        "LEGS": [round(float(cx), 1), feet], "TORSO": [round(float(cx), 1), tbot], "HEAD": [round(float(cx), 1), ttop],
        "ARM_L": [round(shoulder["ARM_L"][0], 1), round(ys_sh, 1)],
        "ARM_R": [round(shoulder["ARM_R"][0], 1), round(ys_sh, 1)],
        "HAND_L": wrist("HAND_L", cuffL), "HAND_R": wrist("HAND_R", cuffR),
    }
    print(name, "pivots", out["pivots"])
    if debug_dir:
        dbg = np.where(fig[..., None], rgb, 255).astype(np.uint8).copy()
        for f, c in ((sL, (0, 255, 0)), (sR, (0, 255, 0))):
            for y in range(ttop, tbot):
                x = int(round(f(y)))
                dbg[y, x - 1:x + 2] = c
        dbg[ttop, :] = (255, 0, 255); dbg[tbot, :] = (255, 0, 255)
        dbg[cuffL, :int(cx)] = (0, 128, 255); dbg[cuffR, int(cx):] = (0, 128, 255)
        Image.fromarray(dbg).save(os.path.join(debug_dir, name + "_lines.png"))
        print(name, "seam fits", infoL, infoR)
    return out


def main(img_dir, out_dir, debug_dir=None):
    os.makedirs(out_dir, exist_ok=True)
    only = os.environ.get("ONLY")
    for name, cfg in CHARS.items():
        if only and name != only:
            continue
        data = vectorize(name, cfg, img_dir, debug_dir)
        txt = json.dumps(data, separators=(",", ":"))
        with open(os.path.join(out_dir, name + ".jsxinc"), "w") as f:
            f.write("// generated by tools/vectorize_squad.py - vector parts of " + name + "\n(" + txt + ")\n")
        print(name, "->", len(txt) // 1024, "KB")


if __name__ == "__main__":
    a = sys.argv[1:]
    dbg = a[a.index("--debug") + 1] if "--debug" in a else None
    main(a[0], a[1], dbg)
