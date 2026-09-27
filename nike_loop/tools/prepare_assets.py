"""Prepare sneaker cutouts for the NIKE loop: one canvas, one floor line, one grade.

Pipeline (see README):
  python3 upscale_realesrgan.py RealESRGAN_x4plus.pth 5.jpg 5_x4.png   # low-res Air Max -> 4x
  python3 cutout.py 2.webp 3.jpg 4.jpg 5_x4.png                        # BiRefNet mattes *_mask.png
  python3 prepare_assets.py <images_dir> <work_dir> ../assets

Usage: python3 prepare_assets.py <images_dir> <work_dir> <out_dir>
  (sources are looked up in images_dir, then work_dir; masks in work_dir)
"""
import os
import sys

import numpy as np
from PIL import Image
from pymatting import estimate_foreground_ml

CANVAS = (1600, 1000)      # every sneaker PNG has this size -> identical transforms in AE
BOX = (1480, 780)          # max shoe footprint inside the canvas
FLOOR_Y = 900              # shoe sole sits on this line (shadow in AE is placed relative to it)

# name, source image, mask, mirror (all toes point right), extra scale for visual balance
SNEAKERS = [
    ("sneaker_01_dunk", "2.webp", "2_mask.png", False, 1.00),
    ("sneaker_02_airmax", "5_x4.png", "5_x4_mask.png", True, 1.00),
    ("sneaker_03_v2k", "3.jpg", "3_mask.png", False, 1.00),
    ("sneaker_04_cortez", "4.jpg", "4_mask.png", True, 0.92),
]


def grade(rgb, alpha):
    """Shared look: gentle levels stretch, S-curve contrast, +saturation."""
    solid = alpha > 0.6
    lum = rgb @ np.array([0.2126, 0.7152, 0.0722])
    lo, hi = np.percentile(lum[solid], [0.5, 99.5])
    lo, hi = lo * 0.6, hi + (1.0 - hi) * 0.5
    rgb = np.clip((rgb - lo) / (hi - lo), 0, 1)
    rgb = rgb + 0.10 * (rgb - 0.5) * (1 - np.abs(2 * rgb - 1))  # soft S-curve
    lum = (rgb @ np.array([0.2126, 0.7152, 0.0722]))[..., None]
    rgb = lum + (rgb - lum) * 1.14
    return np.clip(rgb, 0, 1)


def main(img_dir, mask_dir, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    for name, src, msk, mirror, extra in SNEAKERS:
        path = os.path.join(img_dir, src)
        if not os.path.exists(path):
            path = os.path.join(mask_dir, src)
        rgb = np.asarray(Image.open(path).convert("RGB"), dtype=np.float64) / 255.0
        mask_im = Image.open(os.path.join(mask_dir, msk))
        # masks are either RGBA cutouts (use their alpha) or plain greyscale mattes
        mask_im = mask_im.getchannel("A") if mask_im.mode == "RGBA" else mask_im.convert("L")
        alpha = np.asarray(mask_im, dtype=np.float64) / 255.0
        alpha[alpha < 0.02] = 0.0

        ys, xs = np.nonzero(alpha > 0.02)
        pad = 12
        y0, y1 = max(ys.min() - pad, 0), min(ys.max() + pad + 1, alpha.shape[0])
        x0, x1 = max(xs.min() - pad, 0), min(xs.max() + pad + 1, alpha.shape[1])
        rgb, alpha = rgb[y0:y1, x0:x1], alpha[y0:y1, x0:x1]

        # remove old-background colour from soft edges
        fg = estimate_foreground_ml(rgb, alpha)
        fg = grade(fg, alpha)

        rgba = np.dstack([fg, alpha])
        im = Image.fromarray((rgba * 255 + 0.5).astype(np.uint8), "RGBA")
        if mirror:
            im = im.transpose(Image.FLIP_LEFT_RIGHT)
        bb = im.getbbox()
        im = im.crop(bb)
        s = min(BOX[0] / im.width, BOX[1] / im.height) * extra
        im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)

        canvas = Image.new("RGBA", CANVAS, (0, 0, 0, 0))
        canvas.alpha_composite(im, ((CANVAS[0] - im.width) // 2, FLOOR_Y - im.height))
        canvas.save(os.path.join(out_dir, name + ".png"), optimize=True)
        print(f"{name}: scale {s:.2f}, size {im.width}x{im.height}")


if __name__ == "__main__":
    main(*sys.argv[1:4])
