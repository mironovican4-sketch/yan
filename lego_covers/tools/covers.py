"""LEGO covers: the squad characters show an album cover (Brick Covers mosaic) to the camera.
1000 x 1000, 30 fps, 3 s seamless loops.

Built on the lego_scenes kit (same data model, AE builder and preview renderer): writes scenes/<SCENE>.jsxinc and
build_lego_covers.jsx (generated from ../lego_scenes/build_lego_scenes.jsx).

Usage: python3 covers.py [SCENE ...]        then: python3 ../../lego_scenes/tools/render.py all --root ..
"""
import math
import os
import sys

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SCENE_TOOLS = os.path.join(ROOT, "..", "lego_scenes", "tools")
sys.path.insert(0, SCENE_TOOLS)
import scenes as SQ  # noqa: E402
from scenekit import K, Scene, flatten, group, keys, layer, poly_path, rrect_path, sampled, save, value  # noqa: E402

# the scene helpers read these module settings: square 1000 px comps, 3 s loops, vectors of this project
SQ.W, SQ.H, SQ.DUR = 1000, 1000, 3.0
SQ.VEC_DIR = os.path.join(ROOT, "vectors")
W, H, DUR, FPS = SQ.W, SQ.H, SQ.DUR, SQ.FPS
OUTLINE, S, SNAP, HIT = SQ.OUTLINE, SQ.S, SQ.SNAP, SQ.HIT
COVER = {"file": "assets/cover_for_all_the_dogs.png", "size": [1200, 1200]}


def hand_grip(vec, hand):
    """centre of the C of a LEGO hand (source px): centroid of the opening inside the hand's convex hull"""
    P = np.concatenate([flatten(p) for p in vec["parts"][hand]["base"]["paths"]])
    x0, y0 = np.floor(P.min(0)).astype(int) - 5
    w, h = np.ceil(P.max(0) - [x0, y0]).astype(int) + 6
    m = np.zeros((h, w), np.uint8)
    q = np.round(P - [x0, y0]).astype(np.int32)
    cv2.fillPoly(m, [q], 1)
    hull = np.zeros_like(m)
    cv2.fillPoly(hull, [cv2.convexHull(q)], 1)
    n, lab, st, cen = cv2.connectedComponentsWithStats((hull & (1 - m)).astype(np.uint8))
    i = 1 + int(np.argmax(st[1:, 4]))
    return [float(cen[i][0] + x0), float(cen[i][1] + y0 - 8)]


def clip_rect(poly, x0, y0, x1, y1):
    """Sutherland-Hodgman: convex polygon against an axis-aligned rectangle"""
    def cut(pts, inside, inter):
        out = []
        for i in range(len(pts)):
            a, b = pts[i - 1], pts[i]
            if inside(b):
                if not inside(a):
                    out.append(inter(a, b))
                out.append(b)
            elif inside(a):
                out.append(inter(a, b))
        return out

    def ix(x):
        return lambda a, b: (x, a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]))

    def iy(y):
        return lambda a, b: (a[0] + (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]), y)

    pts = [tuple(p) for p in poly]
    for inside, inter in ((lambda p: p[0] >= x0, ix(x0)), (lambda p: p[0] <= x1, ix(x1)),
                          (lambda p: p[1] >= y0, iy(y0)), (lambda p: p[1] <= y1, iy(y1))):
        pts = cut(pts, inside, inter) if pts else []
    return pts


def resample_closed(pts, n):
    """n points evenly along a closed polygon (path keys need a constant vertex count)"""
    P = np.array(pts + [pts[0]], float)
    seg = np.linalg.norm(np.diff(P, axis=0), axis=1)
    cum = np.concatenate([[0], np.cumsum(seg)])
    out = []
    for d in np.linspace(0, cum[-1], n, endpoint=False):
        j = int(np.clip(np.searchsorted(cum, d, side="right") - 1, 0, len(seg) - 1))
        u = 0 if seg[j] == 0 else (d - cum[j]) / seg[j]
        out.append(P[j] + (P[j + 1] - P[j]) * u)
    return out


def glare_layer(n, t0, t1, opacity_from=34):
    """a soft diagonal band sweeping across a square n x n cover between t0 and t1, clipped to it (child of COVER)"""
    band_w, slope = 0.13 * n, math.tan(math.radians(24))
    pk = []
    for t in np.arange(t0 - 1 / FPS, t1 + 1.5 / FPS, 1 / FPS):
        u = min(1.0, max(0.0, (t - t0) / (t1 - t0)))
        x = -0.45 * n + 1.9 * n * u
        poly = [(x, -10), (x + band_w, -10), (x + band_w - slope * (n + 20), n + 10), (x - slope * (n + 20), n + 10)]
        c = clip_rect(poly, 0, 0, n, n)
        pts = resample_closed(c, 8) if len(c) >= 3 else [np.array([0.0, 0.0])] * 8
        pk.append([round(float(t), 4), [poly_path([[float(p[0]), float(p[1])] for p in pts])]])
    return layer("COVER_GLARE", [group("Glare", [], fill=[255, 255, 255], fillOpacity=opacity_from, pathKeys=pk)], parent="COVER",
                 opacity=keys(K(0, 0, "H"), K(t0, 100, "H"), K(t1, 0, "H"), K(DUR, 0, "H")))


def spark_layers(n, k, spots, windows):
    """four-point stars popping around the cover (children of COVER); spots in parts of the cover side"""
    out = []
    for j, (sx, sy, sz) in enumerate(spots):
        a, b = windows[j % len(windows)]
        a += 0.05 * (j // len(windows))
        b = max(b + 0.05 * (j // len(windows)), a + 0.45)
        c = [sx * n, sy * n]
        star = SQ.star_path(c[0], c[1], 0.07 * n * sz, 0.32)
        col = [255, 255, 255] if j % 2 == 0 else [255, 210, 70]
        out.append(layer("SPARK_%d" % (j + 1), [group("Outline", [star], stroke=OUTLINE, width=0.6 * 9 / k),
                                                  group("Star", [star], fill=col)],
                         parent="COVER", anchor=c, pos=c,
                         scale=keys(K(0, [0, 0]), K(a, [0, 0], SNAP), K(a + 0.14, [115, 115], [60, 30]), K(a + 0.24, [100, 100], HIT),
                                    K(b - 0.12, [100, 100]), K(b, [0, 0], [70, 40]), K(DUR, [0, 0])),
                         rot=keys(K(0, -30), K(a, -30), K(b, 40), K(DUR, 40))))
    return out


def crossing(V, level, t0, t1, rising):
    """first frame time in [t0, t1] where the keyed value crosses level (rising: goes above it)"""
    for f in range(int(round(t0 * FPS)), int(round(t1 * FPS)) + 1):
        v = value(V, f / FPS)
        if (v > level) if rising else (v < level):
            return round(f / FPS, 4)
    return t1


# =============================================================================================
# SMILE_VARSITY · достаёт обложку из-за спины одной рукой, поднимает сбоку («та-да» второй рукой),
# по обложке пробегает блик, звёздочки; прячет обратно за спину — по кругу. Наряд всё время виден
# =============================================================================================

def build_smile():
    vec = SQ.load_vec("SMILE_VARSITY")
    feet, scale = [385, 940], 60
    side = 330                                  # cover side, source px of the character (about 200 px on screen)
    t_back, t_grab, t_rel, t_home = 0.2, 0.46, 2.6, 2.86
    up = -106
    arm_r = [K(0, 0), K(t_back, 0), K(0.42, 34, [55, 45]), K(0.5, 34), K(0.9, up - 6, [45, 25]), K(1.04, up + 3, HIT), K(1.2, up),
             K(1.55, up - 4), K(1.9, up + 2), K(2.08, up), K(2.52, 34, [55, 40]), K(t_rel + 0.02, 34), K(t_home, 0, [50, 50])]
    A = {
        "ARM_R": {"rot": arm_r},
        "ARM_L": {"rot": [K(0, 0), K(0.95, 0), K(1.12, 26, [55, 30]), K(1.25, 22, HIT), K(1.9, 23), K(2.15, 0, [50, 50])]},
        "HEAD": {"rot": [K(0, 0), K(0.3, -4), K(0.55, -2), K(0.95, 4), K(1.15, 7, HIT), K(1.6, 5), K(2.0, 7), K(2.4, 0)],
                 "pos": [K(0, [0, 0]), K(0.95, [0, 0]), K(1.08, [0, -8], [60, 30]), K(1.22, [0, 0], HIT), K(1.6, [0, 5]), K(2.0, [0, 0])]},
        "TORSO": {"rot": [K(0, 0), K(0.3, 2), K(0.5, 3), K(0.95, -2), K(1.2, -1.5), K(2.1, -1), K(2.5, 2.5), K(2.86, 0)]},
        "LEGS": {"pos": [K(0, [0, 0]), K(0.92, [0, 0]), K(1.04, [0, -16], [55, 30]), K(1.18, [0, 0], [30, 80]), K(1.26, [0, 3], HIT),
                         K(1.36, [0, 0])]},
    }
    chars = SQ.character(vec, feet, scale, A, period=1.5)
    by = {L["name"]: L for L in chars}
    arm_rot = by["ARM_R"]["rot"]
    # кисть за спиной — копия под туловищем; меняются местами, когда кисть сбоку от тела и ни на что не заходит
    t_out = crossing(arm_rot, -8, 0.5, 1.0, rising=False)
    t_in = crossing(arm_rot, -8, 2.08, 2.6, rising=True)
    back = dict(by["HAND_R"], name="HAND_R_BACK", opacity=keys(K(0, 0, "H"), K(t_back, 100, "H"), K(t_out, 0, "H"), K(t_in, 100, "H"),
                                                               K(t_home, 0, "H"), K(DUR, 0, "H")))
    by["HAND_R"]["opacity"] = keys(K(0, 100, "H"), K(t_back, 0, "H"), K(t_out, 100, "H"), K(t_in, 0, "H"), K(t_home, 100, "H"),
                                   K(DUR, 100, "H"))
    sc = Scene(SQ.scene("tmp", [0, 0, 0], chars))
    grip = hand_grip(vec, "HAND_R")
    n = COVER["size"][0]
    k = side / n

    # the cover stays upright in the world (leans back while it is swung up, settles), held by the middle of its bottom edge
    def world_angle(t):
        if t < 0.5 or t > 2.56:
            return 0.0
        if t < 1.3:
            u = (t - 0.5) / 0.8
            return -16 * math.sin(math.pi * min(u, 1) * 1.25) * (1 - u) if u < 1 else 0.0
        if t < 2.08:
            return 2.5 * math.sin(2 * math.pi * (t - 1.3) / 0.78)
        u = (t - 2.08) / 0.48
        return 12 * math.sin(math.pi * u)

    rot = sampled(lambda t: round(world_angle(t) - sc.world_rot("HAND_R", t), 3), 0, DUR)
    vis = keys(K(0, 0, "H"), K(t_grab, 100, "H"), K(t_rel, 0, "H"), K(DUR, 0, "H"))
    cover = layer("COVER", [], parent="HAND_R", anchor=[n / 2, n], pos=grip, rot=keys(*rot), scale=[k * 100, k * 100],
                  image=dict(COVER), opacity=vis)
    frame = layer("COVER_FRAME", [group("Outline", [rrect_path(0, 0, n, n, 6)], stroke=OUTLINE, width=9 / k)], parent="COVER", opacity=vis)
    sparks = spark_layers(n, k, [(-0.12, -0.06, 1.0), (1.12, 0.05, 0.85), (1.14, 0.7, 1.1), (0.5, -0.16, 0.8), (-0.14, 0.62, 0.75)],
                          [(1.02, 1.5), (1.55, 2.0)])
    bg = [236, 231, 246]
    layers = [SQ.background(bg),
              layer("SPOTLIGHT", [group("Light", [SQ.ellipse_path(500, 470, 430, 430)], fill=[248, 245, 255])], blur=90),
              SQ.floor_shadow(sc, feet),
              cover, frame, glare_layer(n, 1.2, 1.7),
              by["ARM_R"], back]
    layers += [by[nm] for nm in ("LEGS", "ARM_L", "HEAD", "TORSO", "HAND_R", "HAND_L")]
    layers += sparks
    return SQ.scene("SMILE_VARSITY_COVER", bg, layers)


SCENES = {"SMILE_VARSITY_COVER": build_smile}


def write_builder():
    """build_lego_covers.jsx = the generic lego_scenes builder with this project's scene list"""
    src = open(os.path.join(ROOT, "..", "lego_scenes", "build_lego_scenes.jsx"), encoding="utf-8").read()
    head_end = src.index("*/") + 2
    header = ("#target aftereffects\n/*\n"
              " * LEGO COVERS · персонажи показывают обложку · 1000 x 1000 · 30 fps · 3 s (бесшовный луп)\n"
              " * --------------------------------------------------------------------------------\n"
              " * Сборщик для After Effects (ExtendScript, AE 2020+). Рядом со скриптом: scenes/ (данные сцен) и assets/ (обложка).\n"
              " * Сгенерирован tools/covers.py из lego_scenes/build_lego_scenes.jsx.\n"
              " *\n"
              " * Запуск:  File > Scripts > Run Script File...  ->  build_lego_covers.jsx\n"
              " * Чтобы собрать одну сцену, впишите её имя в ONLY.\n"
              " */")
    body = src[head_end:]
    a = body.index("var SCENES = [")
    b = body.index("];", a) + 2
    body = body[:a] + "var SCENES = " + str(list(SCENES)).replace("'", '"') + ";" + body[b:]
    body = body.replace('var PROJECT = "LEGO_SCENES";', 'var PROJECT = "LEGO_COVERS";')
    body = body.replace('var ONLY = "";   // например "RED_SUIT_MIC"', 'var ONLY = "";   // например "SMILE_VARSITY_COVER"')
    open(os.path.join(ROOT, "build_lego_covers.jsx"), "w", encoding="utf-8").write(header + body)


if __name__ == "__main__":
    names = sys.argv[1:] or list(SCENES)
    os.makedirs(os.path.join(ROOT, "scenes"), exist_ok=True)
    for name in names:
        data = SCENES[name]()
        out = os.path.join(ROOT, "scenes", name + ".jsxinc")
        save(data, out)
        print(name, "layers", len(data["layers"]), "->", os.path.getsize(out) // 1024, "KB")
    write_builder()
