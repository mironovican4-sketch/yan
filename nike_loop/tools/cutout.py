"""Background removal with BiRefNet (via rembg). Writes a greyscale matte next to each input.

Usage: python3 cutout.py image1.jpg [image2.webp ...]      (pip install "rembg[cpu]")
Run one image per process on small machines: BiRefNet needs ~10 GB RAM on large inputs.
"""
import os
import sys

from PIL import Image
from rembg import new_session, remove

session = new_session("birefnet-general")
for path in sys.argv[1:]:
    im = Image.open(path).convert("RGB")
    matte = remove(im, session=session, only_mask=True)
    out = os.path.splitext(path)[0] + "_mask.png"
    matte.save(out)
    print(out, matte.getbbox())
