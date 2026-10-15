"""LEGO covers: the squad characters show an album cover (Brick Covers mosaic) to the camera.
1000 x 1000, 30 fps, 3 s seamless loops.

Built on the lego_scenes kit (same data model, AE builder and preview renderer): writes scenes/<SCENE>.jsxinc and
build_lego_covers.jsx (generated from ../lego_scenes/build_lego_scenes.jsx).

Usage: python3 covers.py [SCENE ...]        then: python3 ../../lego_scenes/tools/render.py all --root ..
"""
import os
import sys

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SCENE_TOOLS = os.path.join(ROOT, "..", "lego_scenes", "tools")
sys.path.insert(0, SCENE_TOOLS)
import scenes as SQ  # noqa: E402
from scenekit import K, Scene, flatten, group, keys, layer, rrect_path, sampled, save, value  # noqa: E402

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


def sleeve_arm(vec, chars, arm, hand):
    """the arm as a sleeve tube: turned towards the camera only its length shortens (width and outline stay clean);
    the hand turns with the sleeve so the wrist stays in the cuff"""
    by = {L["name"]: L for L in chars}
    tube = SQ.TubeArm(vec, arm)
    sq = by[arm]["squash"]["s"]
    s_of = lambda t: value(sq, t) / 100
    frames = [round(f / FPS, 4) for f in range(int(DUR * FPS) + 1)]
    by[arm]["groups"] = tube.groups(s_of, frames)
    by[arm]["squash"] = None
    hand_rot = by[hand]["rot"]
    by[hand]["rot"] = keys(*sampled(lambda t: round(tube.tangent(s_of(t)) - tube.rest_end + value(hand_rot, t), 3), 0, DUR))


# =============================================================================================
# SMILE_VARSITY · держит обложку перед собой: обе руки опущены и одинаковой длины, правая чуть повёрнута внутрь
# и держит обложку сбоку за середину правого края (кисть за обложкой); пару раз слегка её потряхивает
# =============================================================================================

def build_smile(arm_rot=18.0, attach=(0.97, 0.6), side=380, feet_x=500, arm_on_top=True):
    """arm_rot = inward turn of the right arm (deg), attach = where the hand's grip sits on the cover (parts of its
    side), arm_on_top = the right arm is drawn over the torso (it crosses in front of the body)"""
    vec = SQ.load_vec("SMILE_VARSITY")
    feet, scale = [feet_x, 940], 60
    base = arm_rot

    def shake(t0, amp, n_=3, period=0.16):      # a few small quick wiggles that die out
        ks = [K(t0, base, [40, 40])]
        for i in range(n_):
            ks.append(K(t0 + period * (i + 0.5), base + amp * (1 if i % 2 == 0 else -1) * (1 - 0.25 * i), [45, 45]))
        ks.append(K(t0 + period * (n_ + 0.5), base, [40, 60]))
        return ks

    A = {
        "ARM_R": {"rot": [K(0, base)] + shake(0.45, 2.5) + shake(1.95, 2.2) + [K(DUR, base)]},
        "ARM_L": {"rot": [K(0, 0), K(0.75, 2), K(1.5, 0), K(2.25, 2), K(DUR, 0)]},
        "HEAD": {"rot": [K(0, 2), K(0.55, 4), K(1.2, 1), K(1.9, 4), K(2.5, 2), K(DUR, 2)],
                 "pos": [K(0, [0, 0]), K(0.6, [0, 4]), K(1.25, [0, 0]), K(2.0, [0, 4]), K(2.6, [0, 0])]},
        "TORSO": {"rot": [K(0, 0), K(0.75, -0.8), K(1.5, 0), K(2.25, -0.8), K(DUR, 0)]},
    }
    chars = SQ.character(vec, feet, scale, A, period=1.5)
    by = {L["name"]: L for L in chars}
    sc = Scene(SQ.scene("tmp", [0, 0, 0], chars))
    grip = hand_grip(vec, "HAND_R")
    n = COVER["size"][0]
    k = side / n
    # the cover hangs upright in front of him and tilts a little with every wiggle
    tilt = lambda t: 1.6 * (value(by["ARM_R"]["rot"], t) - base)
    rot = sampled(lambda t: round(tilt(t) - sc.world_rot("HAND_R", t), 3), 0, DUR)
    cover = layer("COVER", [], parent="HAND_R", anchor=[n * attach[0], n * attach[1]], pos=grip, rot=keys(*rot),
                  scale=[k * 100, k * 100], image=dict(COVER))
    frame = layer("COVER_FRAME", [group("Outline", [rrect_path(0, 0, n, n, 6)], stroke=OUTLINE, width=9 / k)], parent="COVER")
    bg = [236, 231, 246]
    layers = [SQ.background(bg),
              layer("SPOTLIGHT", [group("Light", [SQ.ellipse_path(500, 470, 430, 430)], fill=[248, 245, 255])], blur=90),
              SQ.floor_shadow(sc, feet)]
    if arm_on_top:   # the right arm crosses in front of the body; arm and hand behind the cover
        layers += [by[nm] for nm in ("LEGS", "ARM_L", "HEAD", "TORSO", "HAND_L", "ARM_R", "HAND_R")] + [cover, frame]
    else:
        layers += [by[nm] for nm in ("LEGS", "ARM_R", "ARM_L", "HEAD", "TORSO", "HAND_L", "HAND_R")] + [cover, frame]
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
