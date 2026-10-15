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


def cover_layers(sc, grips, side, grip_at=0.72, glare=(0.95, 1.5), sparks=((0.66, 1.0), (1.55, 1.9))):
    """the cover rides on the torso, centred between the two grips; frame, glare sweep and sparkles on top.
    side = cover size in source px of the character, grip_at = height of the grips on the cover (0 top .. 1 bottom)"""
    gl, gr = grips
    n = COVER["size"][0]
    k = side / n

    def pose(t):
        Ti = np.linalg.inv(sc.world("TORSO", t))
        a = (Ti @ np.append(sc.to_comp("HAND_L", gl, t), 1))[:2]
        b = (Ti @ np.append(sc.to_comp("HAND_R", gr, t), 1))[:2]
        ang = math.atan2(b[1] - a[1], b[0] - a[0])
        mid = (a + b) / 2
        down = np.array([-math.sin(ang), math.cos(ang)])
        c = mid - down * (grip_at - 0.5) * side
        return [round(float(c[0]), 2), round(float(c[1]), 2)], round(math.degrees(ang), 3)

    poses = [(t, pose(t)) for t in [f / FPS for f in range(int(DUR * FPS) + 1)]]
    cover = layer("COVER", [], parent="TORSO", anchor=[n / 2, n / 2], scale=[k * 100, k * 100], image=dict(COVER),
                  pos=keys(*[K(t, p[0], "L") for t, p in poses]), rot=keys(*[K(t, p[1], "L") for t, p in poses]))
    frame = layer("COVER_FRAME", [group("Outline", [rrect_path(0, 0, n, n, 6)], stroke=OUTLINE, width=9 / k)], parent="COVER")
    # glare: a soft diagonal band sweeping across the cover, clipped to it
    t0, t1 = glare
    band_w, slope = 0.13 * n, math.tan(math.radians(24))
    pk = []
    for t in np.arange(t0 - 1 / FPS, t1 + 1.5 / FPS, 1 / FPS):
        u = min(1.0, max(0.0, (t - t0) / (t1 - t0)))
        x = -0.45 * n + 1.9 * n * u
        poly = [(x, -10), (x + band_w, -10), (x + band_w - slope * (n + 20), n + 10), (x - slope * (n + 20), n + 10)]
        c = clip_rect(poly, 0, 0, n, n)
        pts = resample_closed(c, 8) if len(c) >= 3 else [np.array([0.0, 0.0])] * 8
        pk.append([round(float(t), 4), [poly_path([[float(p[0]), float(p[1])] for p in pts])]])
    glare_l = layer("COVER_GLARE", [group("Glare", [], fill=[255, 255, 255], fillOpacity=34, pathKeys=pk)], parent="COVER",
                    opacity=keys(K(0, 0, "H"), K(t0, 100, "H"), K(t1, 0, "H"), K(DUR, 0, "H")))
    out = [cover, frame, glare_l]
    spots = [(-0.1, -0.04, 1.0), (1.09, 0.02, 0.8), (1.13, 0.58, 1.1), (-0.13, 0.66, 0.8), (1.06, 1.05, 0.9), (-0.07, 1.06, 0.7)]
    for j, (sx, sy, sz) in enumerate(spots):
        a, b = sparks[j % 2]
        a += 0.05 * (j // 2)
        b = max(b + 0.05 * (j // 2), a + 0.45)
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


def tube_arms(vec, chars):
    """both arms as sleeve tubes (raised towards the camera only the spine shortens), hands turn with the sleeve"""
    by = {L["name"]: L for L in chars}
    frames = [round(f / FPS, 4) for f in range(int(DUR * FPS) + 1)]
    for arm, hand in (("ARM_L", "HAND_L"), ("ARM_R", "HAND_R")):
        tube = SQ.TubeArm(vec, arm)
        sq = by[arm]["squash"]["s"] if by[arm].get("squash") else 100
        s_of = (lambda v: (lambda t: value(v, t) / 100))(sq)
        by[arm]["groups"] = tube.groups(s_of, frames)
        by[arm]["squash"] = None
        base_rot = by[hand]["rot"]
        by[hand]["rot"] = keys(*sampled((lambda tb, so, br: lambda t: round(tb.tangent(so(t)) - tb.rest_end + value(br, t), 3))(tube, s_of, base_rot),
                                        0, DUR))


# =============================================================================================
# SMILE_VARSITY · показывает обложку: держит её двумя руками у пояса, подпрыгивает и поднимает к груди
# («та-да!»), по обложке пробегает блик, вокруг вспыхивают звёздочки, опускает — по кругу
# =============================================================================================

def build_smile():
    vec = SQ.load_vec("SMILE_VARSITY")
    feet, scale = [500, 940], 62
    lift = [K(0, 100), K(0.28, 100), K(0.56, 80, [60, 30]), K(0.74, 84, HIT), K(1.15, 82), K(1.6, 85), K(1.98, 83),
            K(2.42, 100, [60, 40])]
    A = {
        "ARM_L": {"squash": lift}, "ARM_R": {"squash": lift},
        "LEGS": {"pos": [K(0, [0, 0]), K(0.3, [0, 0]), K(0.4, [0, 6], [60, 40]), K(0.58, [0, -34], [55, 30]), K(0.78, [0, 0], [30, 85]),
                         K(0.88, [0, 5], HIT), K(1.02, [0, 0]), K(2.42, [0, 0]), K(2.52, [0, 4], HIT), K(2.66, [0, 0])]},
        "HEAD": {"rot": [K(0, 0), K(0.3, 0), K(0.6, -6, HIT), K(0.95, 4), K(1.3, -3), K(1.65, 4), K(2.0, -2), K(2.45, 0)],
                 "pos": [K(0, [0, 0]), K(0.3, [0, 0]), K(0.42, [0, 8]), K(0.62, [0, -10], [60, 30]), K(0.85, [0, 0], HIT),
                         K(1.3, [0, 4]), K(1.75, [0, 0]), K(2.45, [0, 0])]},
        "TORSO": {"rot": [K(0, 0), K(0.6, 0), K(0.95, 1.5), K(1.45, -1.5), K(1.95, 1), K(2.45, 0)]},
    }
    chars = SQ.character(vec, feet, scale, A, period=1.5)
    tube_arms(vec, chars)
    sc = Scene(SQ.scene("tmp", [0, 0, 0], chars))
    grips = (hand_grip(vec, "HAND_L"), hand_grip(vec, "HAND_R"))
    bg = [236, 231, 246]
    layers = [SQ.background(bg),
              layer("SPOTLIGHT", [group("Light", [SQ.ellipse_path(feet[0], 520, 380, 430)], fill=[248, 245, 255])], blur=90)]
    layers.append(SQ.floor_shadow(sc, feet))
    layers += chars
    layers = SQ.insert_after(layers, "TORSO", cover_layers(sc, grips, side=700, grip_at=0.5))
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
