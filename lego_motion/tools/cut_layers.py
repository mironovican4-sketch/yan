"""Cut the LEGO character illustration into animation layers (same 1122x1500 canvas for every PNG).

Cuts follow the black outlines between parts: the torso side lines (tracked row by row) separate
arms from the torso, the cuff lines separate hands from arms. A shared outline is kept in BOTH
layers, so no seam opens when a part moves. The neck is extended downwards (hidden under the
torso) so tilting the head never shows a gap.

Usage: python3 cut_layers.py <character.png|webp> <out_dir>
"""
import os
import sys

import numpy as np
from PIL import Image

EDGE_GUESS_L = lambda y: 394 - 0.16 * (y - 550)   # rough torso side lines, refined per row below
EDGE_GUESS_R = lambda y: 735 + 0.16 * (y - 550)
TORSO_TOP, TORSO_BOTTOM = 519, 926
ARM_TOP = 550          # arm cap starts here (above it is the torso corner)
CUFF = 852             # arm / hand split
HAND_BOTTOM = 1060
NECK = (468, 662)
HIPS_TOP = 912
LINE_W = 10            # outline thickness, px


def track_line(black, guess, y0, y1, search=14):
    """per-row [left, right] of the outline run nearest to the guessed x, median-smoothed"""
    lo, hi = [], []
    for y in range(y0, y1):
        g = int(round(guess(y)))
        xs = np.nonzero(black[y, g - search:g + search + 1])[0] + g - search
        if len(xs) == 0:
            lo.append(g - 4); hi.append(g + 4); continue
        # run containing the pixel closest to the guess
        c = xs[np.argmin(np.abs(xs - g))]
        l = r = c
        while l - 1 >= g - search and black[y, l - 1]: l -= 1
        while r + 1 <= g + search and black[y, r + 1]: r += 1
        lo.append(l); hi.append(r)
    k = 7
    med = lambda a: np.array([np.median(a[max(0, i - k):i + k + 1]) for i in range(len(a))])
    return med(np.array(lo, float)), med(np.array(hi, float))


def main(src, out):
    os.makedirs(out, exist_ok=True)
    im = np.asarray(Image.open(src).convert("RGBA"))
    h, w = im.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w]
    visible = im[..., 3] > 0
    black = (im[..., 3] > 128) & (im[..., :3].astype(int).mean(-1) < 45)

    y0, y1 = 500, 940
    lL, rL = track_line(black, EDGE_GUESS_L, y0, y1)
    lR, rR = track_line(black, EDGE_GUESS_R, y0, y1)

    def per_row(arr, default):
        full = np.full(h, default, float)
        full[y0:y1] = arr
        return full[:, None]

    # Only the torso-facing side of each line is reliable (dark arm shading merges with the line on
    # the other side), so the outer side is that edge minus the line width. +-2 px: anti-aliasing.
    L_right = per_row(rL + 2, 0)
    L_left = per_row(rL - LINE_W, 0)
    R_left = per_row(lR - 2, w)
    R_right = per_row(lR + LINE_W, w)

    parts = {
        "head": ((yy < TORSO_TOP + 2) & (xx > 390) & (xx < 740)) |
                ((yy < 526) & (yy > 480) & (xx >= NECK[0]) & (xx <= NECK[1])),
        "torso": (yy >= TORSO_TOP) & (yy < TORSO_BOTTOM) & (xx >= L_left) & (xx <= R_right),
        "arm_left": (yy >= ARM_TOP) & (yy <= CUFF + 6) & (xx <= L_right) & (xx > 150),
        "arm_right": (yy >= ARM_TOP) & (yy <= CUFF + 6) & (xx >= R_left) & (xx < 980),
        "hand_left": (yy >= CUFF) & (yy < HAND_BOTTOM) & (xx > 150) &
                     (((yy < 925) & (xx < L_left)) | ((yy >= 925) & (xx < 345))),
        "hand_right": (yy >= CUFF) & (yy < HAND_BOTTOM) & (xx < 980) &
                      (((yy < 925) & (xx > R_right)) | ((yy >= 925) & (xx > 785))),
        "legs": (yy >= HIPS_TOP) & (xx >= 342) & (xx <= 790),
    }
    covered = np.zeros((h, w), bool)
    for name, m in parts.items():
        layer = im.copy()
        layer[..., 3] = np.where(m & visible, im[..., 3], 0)
        if name == "head":
            band = im[506:514, NECK[0] + 8:NECK[1] - 8]
            for y in range(514, 548, band.shape[0]):
                n = min(band.shape[0], 548 - y)
                layer[y:y + n, NECK[0] + 8:NECK[1] - 8] = band[:n]
        Image.fromarray(layer).save(os.path.join(out, name + ".png"), optimize=True)
        covered |= m & visible
        print(name, "px", int((m & visible).sum()))
    miss = visible & ~covered & (im[..., 3] > 128)
    print("opaque pixels not assigned to any layer:", int(miss.sum()))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
