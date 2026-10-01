"""LEGO scenes: characters from ../lego_squad/vectors plus props, keyframed here.

Writes scenes/<SCENE>.jsxinc (data for build_lego_scenes.jsx and render.py).
Usage: python3 scenes.py [SCENE ...]      (no argument = all scenes)
"""
import json
import math
import os
import sys

import numpy as np

from scenekit import (K, Scene, ellipse_path, group, keys, layer, point_on, poly_path, rrect_path, sampled, save,
                      smooth_path, value, xform_path)

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
VEC_DIR = os.path.join(ROOT, "vectors")
W, H, FPS, DUR = 1080, 1350, 30, 5.0
OUTLINE = [18, 18, 18]
S = [55, 55]        # smooth
SNAP = [80, 25]     # slow in, quick out
HIT = [25, 80]      # quick in, long settle
ORDER = ["LEGS", "ARM_R", "ARM_L", "HEAD", "TORSO", "HAND_R", "HAND_L"]   # bottom -> top, arms tuck under the torso
PARENT = {"LEGS": None, "TORSO": "LEGS", "HEAD": "TORSO", "ARM_L": "TORSO", "ARM_R": "TORSO", "HAND_L": "ARM_L", "HAND_R": "ARM_R"}


def load_vec(name):
    t = open(os.path.join(VEC_DIR, name + ".jsxinc")).read().split("\n", 1)[1].strip()
    vec = json.loads(t[1:-1])
    for part in vec["parts"].values():   # traced outlines are closed
        for g in [part["base"]] + part["prints"]:
            g["paths"] = [dict(p, c=True) for p in g["paths"]]
    return vec


def loop(ks):
    """make a key list loop: add a key at 0 / D equal to the first value when missing"""
    ks = sorted(ks, key=lambda x: x[0])
    if ks[0][0] > 0:
        ks.insert(0, K(0, ks[0][1], ks[0][2]))
    if ks[-1][0] < DUR:
        ks.append(K(DUR, ks[0][1], ks[0][2]))
    return ks


def wiggle(t0, t1, freq, amp, base=0.0, start_sign=1, decay=False, ease=(50, 50)):
    out, n = [], int(round((t1 - t0) * freq * 2))
    for i in range(1, n):
        a = amp * (1 - i / n) if decay else amp
        out.append(K(t0 + i / (2 * freq), round(base + a * start_sign * (1 if i % 2 else -1), 3), ease))
    return out


def addv(v, o):
    return [v[0] + o[0], v[1] + o[1]]


def part_groups(part, lw):
    g = [group("Outline", part["base"]["paths"], stroke=OUTLINE, width=lw)]
    g += [group("Print %d" % (i + 1), pr["paths"], fill=pr["color"]) for i, pr in enumerate(part["prints"])]
    g += [group("Base", part["base"]["paths"], fill=part["base"]["color"])]
    return g


def character(vec, feet, scale, anim, breath=1.0, period=2.5, parts=None, front=()):
    """rig layers (bottom -> top). anim[part] = {rot: keys, pos: offset keys, scale: keys (LEGS: relative %),
    squash: keys (arms, % of length; the hand follows the shortened wrist)}. front: arms drawn over the torso"""
    piv, lw = vec["pivots"], vec["lineWidth"]
    order = [n for n in ORDER if n not in front]
    for n in front:
        order.insert(order.index("TORSO") + 1, n)
    out = []
    for name in order:
        part = (parts or {}).get(name) or vec["parts"][name]
        A = anim.get(name, {})
        origin = piv[name] if PARENT[name] else feet
        pos = keys(*[K(k[0], addv(origin, k[1]), k[2]) for k in loop(A["pos"])]) if A.get("pos") else list(origin)
        rot = keys(*loop(A["rot"])) if A.get("rot") else 0
        if name == "LEGS":
            sc = keys(*[K(k[0], [k[1][0] * scale / 100, k[1][1] * scale / 100], k[2]) for k in loop(A["scale"])]) \
                if A.get("scale") else [scale, scale]
        elif name == "TORSO" and breath:
            sc = keys(*sampled(lambda t: [round(100 - 0.3 * breath * math.sin(2 * math.pi * t / period), 3),
                                          round(100 + breath * math.sin(2 * math.pi * t / period), 3)], 0, DUR, 1 / 6))
        else:
            sc = keys(*loop(A["scale"])) if A.get("scale") else [100, 100]
        sq = None
        if A.get("squash"):
            sq = {"py": piv[name][1], "s": keys(*loop(A["squash"]))}
        arm = PARENT[name] if name.startswith("HAND") else None
        if arm and anim.get(arm, {}).get("squash"):   # wrist of the shortened arm: linear in Squash -> same keys/eases
            wx, wy = piv[name]
            py = piv[arm][1]
            pos = keys(*[K(k[0], [wx, py + (wy - py) * k[1] / 100], k[2]) for k in loop(anim[arm]["squash"])])
        out.append(layer(name, part_groups(part, lw), parent=PARENT[name], anchor=piv[name], pos=pos, rot=rot, scale=sc, squash=sq))
    return out


def background(color):
    return layer("BG", [group("BG", [rrect_path(-20, -20, W + 20, H + 20, 0)], fill=color)])


def floor_shadow(sc, feet, scale=100, opacity=18):
    """soft ellipse under the feet; shrinks and fades while LEGS are lifted"""
    def lift(t):
        return max(0.0, feet[1] - value(sc.by["LEGS"]["pos"], t)[1])
    keyed = isinstance(sc.by["LEGS"]["pos"], dict)
    sh = layer("FLOOR_SHADOW", [group("Shadow", [ellipse_path(0, 0, 260, 22)], fill=[0, 0, 0])], pos=[feet[0], feet[1] + 6], blur=22)
    if keyed:
        sh["scale"] = keys(*sampled(lambda t: [round(scale * (1 - min(lift(t) / 500, 0.55)), 2)] * 2, 0, DUR, 1 / 15))
        sh["opacity"] = keys(*sampled(lambda t: round(opacity * (1 - min(lift(t) / 400, 0.7)), 2), 0, DUR, 1 / 15))
    else:
        sh["scale"], sh["opacity"] = [scale, scale], opacity
    return sh


def insert_after(layers, name, new):
    i = [L["name"] for L in layers].index(name)
    return layers[:i + 1] + list(new) + layers[i + 1:]


def scene(name, bg, layers):
    return {"name": name, "width": W, "height": H, "fps": FPS, "duration": DUR, "bg": bg, "layers": layers}


# =============================================================================================
# BRICK_BRAIDS · недовольный: вздох, мотает головой «нет», раздражённо вскидывает руки (жилка гнева,
# пар из ушей), отворачивается, руки «в боки», успокаивается
# =============================================================================================

def anger_vein(cx, cy, r=46, color=(222, 30, 40)):
    """anime anger mark: four bulging brackets around a centre"""
    paths = []
    for k in range(4):
        a = math.radians(45 + 90 * k)
        d = np.array([math.cos(a), math.sin(a)])
        n = np.array([-d[1], d[0]])
        c = np.array([cx, cy]) + d * r * 0.62
        pts = [c - n * r * 0.42 + d * r * 0.05, c - d * r * 0.16, c + n * r * 0.42 + d * r * 0.05]
        paths.append(smooth_path(pts, closed=False))
    return paths


def puff_path(cx, cy, r):
    pts = []
    for k in range(10):
        a = 2 * math.pi * k / 10
        rr = r * (1.0 + 0.16 * math.cos(5 * a))
        pts.append([cx + rr * math.cos(a), cy + rr * 0.8 * math.sin(a)])
    return smooth_path(pts, closed=True)


def build_brick():
    vec = load_vec("BRICK_BRAIDS")
    feet, scale = [540, 1250], 62
    A = {
        "HEAD": {"rot": [K(0, 0), K(0.35, -3), K(0.6, 0), K(0.95, 4, S), K(1.3, 0)] +
                        [K(1.45 + 0.17 * i, 7 * (1 if i % 2 == 0 else -1), [45, 45]) for i in range(5)] +
                        [K(2.3, 0), K(2.45, -5, HIT), K(3.1, -4), K(3.4, 10, [60, 30]), K(3.6, 8, HIT), K(4.3, 8), K(4.75, 0, [60, 40])],
                 "pos": [K(0, [0, 0]), K(0.6, [0, 0]), K(0.95, [0, 14]), K(1.3, [0, 0]), K(2.25, [0, 0]), K(2.4, [0, -8], [60, 30]),
                         K(2.6, [0, 0], HIT), K(4.3, [0, 0])]},
        "TORSO": {"rot": [K(0, 0), K(0.6, 0), K(0.95, 1.5), K(1.3, 0), K(2.25, 0), K(2.4, -1.5, SNAP), K(2.7, 0),
                          K(3.35, 0), K(3.6, 2, HIT), K(4.3, 2), K(4.75, 0)],
                  "pos": [K(0, [0, 0]), K(0.6, [0, 0]), K(0.95, [0, 8]), K(1.3, [0, 0]), K(2.25, [0, 0]), K(2.4, [0, 5], HIT),
                          K(2.65, [0, 0])]},
        "ARM_L": {"rot": [K(0, 0), K(0.6, 0), K(0.95, -3), K(1.3, 0), K(2.15, 0), K(2.27, -5, SNAP), K(2.42, 34, [60, 30]),
                          K(2.58, 28, HIT), K(2.95, 27), K(3.15, -4, [25, 70]), K(3.3, 0), K(3.45, 0), K(3.7, 14, HIT), K(4.3, 13),
                          K(4.7, 0, [60, 40])]},
        "ARM_R": {"rot": [K(0, 0), K(0.6, 0), K(0.95, 3), K(1.3, 0), K(2.18, 0), K(2.3, 5, SNAP), K(2.45, -34, [60, 30]),
                          K(2.61, -28, HIT), K(2.98, -27), K(3.18, 4, [25, 70]), K(3.33, 0), K(3.48, 0), K(3.73, -14, HIT),
                          K(4.3, -13), K(4.72, 0, [60, 40])]},
        "LEGS": {"pos": [K(0, [0, 0]), K(3.1, [0, 0]), K(3.2, [0, -6], [60, 40]), K(3.3, [0, 0], HIT)]},
    }
    chars = character(vec, feet, scale, A)
    layers = [background([236, 235, 238])]
    sc0 = Scene(scene("tmp", [0, 0, 0], layers + chars))
    layers.append(floor_shadow(sc0, feet))
    layers += chars
    # жилка гнева у макушки (дочерний слой головы): выскакивает на взмахе руками, пульсирует, исчезает
    vc = [945, 300]
    pulse = []
    for i in range(6):
        t = 2.75 + i * 0.25
        pulse += [K(t, [100, 100]), K(t + 0.125, [114, 114])]
    vein = layer("ANGER_VEIN", [group("Vein", anger_vein(vc[0], vc[1], 78), stroke=[222, 30, 40], width=22)], parent="HEAD", anchor=vc, pos=vc,
                 scale=keys(K(0, [0, 0]), K(2.3, [0, 0], SNAP), K(2.48, [135, 135], [60, 30]), K(2.62, [100, 100], HIT), *pulse,
                            K(4.25, [100, 100]), K(4.45, [0, 0], [70, 40]), K(DUR, [0, 0])),
                 rot=keys(K(0, -20), K(2.3, -20), K(2.6, 0, HIT), K(DUR, 0)))
    layers.append(vein)
    # пар из ушей: два облачка с каждой стороны головы, поднимаются и тают
    sc = Scene(scene("tmp", [0, 0, 0], layers))
    for side, ex in (("L", 470), ("R", 1030)):
        for j, (t0, r) in enumerate(((2.32, 40), (2.5, 30))):
            p0 = sc.to_comp("HEAD", [ex, 610], t0)
            dx = -1 if side == "L" else 1
            name = "STEAM_%s%d" % (side, j + 1)
            layers.append(layer(name, [group("Puff", [puff_path(0, 0, r)], fill=[250, 250, 250], stroke=OUTLINE, width=7)],
                                pos=keys(K(0, list(p0)), K(t0, list(p0)), K(t0 + 0.9, [p0[0] + dx * 70, p0[1] - 150], [10, 70]),
                                         K(DUR, [p0[0] + dx * 70, p0[1] - 150])),
                                scale=keys(K(0, [0, 0]), K(t0, [0, 0], SNAP), K(t0 + 0.25, [110, 110], [60, 40]), K(t0 + 0.9, [140, 140]),
                                           K(DUR, [140, 140])),
                                opacity=keys(K(0, 0, "H"), K(t0, 100, [50, 50]), K(t0 + 0.55, 100), K(t0 + 0.9, 0), K(DUR, 0))))
    # «туча» каракулей над головой: рисуется, висит, стирается
    u = np.linspace(0, 1, 90)
    rng = np.random.default_rng(7)
    sx = 600 + 300 * u + 44 * np.cos(2 * np.pi * 5.5 * u) + rng.normal(0, 2, 90)
    sy = 95 + 40 * np.sin(2 * np.pi * 5.5 * u) + 10 * np.sin(2 * np.pi * 1.3 * u) + rng.normal(0, 2, 90)
    scrib = smooth_path(np.stack([sx, sy], 1)[::2], closed=False)
    layers.append(layer("GRUMBLE", [group("Scribble", [scrib], stroke=[40, 40, 46], width=11,
                                          trim={"start": keys(K(0, 0), K(4.15, 0), K(4.5, 100, [60, 40]), K(DUR, 100)),
                                                "end": keys(K(0, 0), K(3.3, 0), K(3.85, 100, [40, 60]), K(DUR, 100))})],
                        parent="HEAD", opacity=keys(K(0, 0, "H"), K(3.3, 100, "H"), K(4.5, 0, "H"), K(DUR, 0, "H"))))
    return scene("BRICK_BRAIDS_ANNOYED", [236, 235, 238], layers)


# =============================================================================================
# VARSITY_BEAR · летит: поза супергероя (рука вперёд-вверх), покачивается в потоке, облака и линии
# скорости проносятся мимо (параллакс), всё зациклено
# =============================================================================================

def cloud_path(w, h, bumps):
    """flat-bottomed cartoon cloud, centre-bottom at (0, 0); bumps = [(x as part of w, radius as part of h)]"""
    top = []
    for x in np.linspace(-w / 2, w / 2, 40)[::3]:
        y = 0.0
        for cx, r in bumps:
            if abs(x - cx * w) < r * h:
                y = min(y, -math.sqrt((r * h) ** 2 - (x - cx * w) ** 2))
        top.append([x, y - h * 0.18])
    bottom = [[w / 2 + h * 0.02, -h * 0.1], [w / 2 - h * 0.25, 0], [-w / 2 + h * 0.25, 0], [-w / 2 - h * 0.02, -h * 0.1]]
    return smooth_path(top + bottom, closed=True, tension=0.9)


def scroll_x(x_from, x_to, laps, phase):
    """linear right-to-left travel, `laps` times per loop, jumping back off-screen (hold key)"""
    period = DUR / laps
    span = x_from - x_to
    ks, t = [], 0.0
    x0 = x_from - span * phase
    t_wrap = period * (1 - phase)
    ks.append(K(0, x0, "L"))
    while t_wrap < DUR - 1e-6:
        ks.append(K(t_wrap - 1 / 60, x_to, "H"))
        ks.append(K(t_wrap, x_from, "L"))
        t_wrap += period
    ks.append(K(DUR, x0, "L"))
    return ks


def build_bear(tilt=64, arm_l=22, arm_r=-146, feet=(285, 935)):
    vec = load_vec("VARSITY_BEAR")
    feet, scale = list(feet), 50
    A = {   # почти горизонтально, как супергерой; покачивается в потоке (две волны за луп)
        "LEGS": {"pos": [K(0, [0, -16], [50, 50]), K(1.25, [8, 16], [50, 50]), K(2.5, [0, -16], [50, 50]), K(3.75, [-8, 16], [50, 50])],
                 "rot": [K(0, tilt, [50, 50]), K(1.25, tilt + 4, [50, 50]), K(2.5, tilt, [50, 50]), K(3.75, tilt - 4, [50, 50])]},
        "ARM_L": {"rot": [K(0, arm_l, [50, 50]), K(0.625, arm_l + 4, [50, 50]), K(1.875, arm_l - 4, [50, 50]), K(3.125, arm_l + 4, [50, 50]),
                          K(4.375, arm_l - 4, [50, 50])]},
        "ARM_R": {"rot": [K(0, arm_r, [50, 50]), K(1.25, arm_r - 6, [50, 50]), K(2.5, arm_r, [50, 50]), K(3.75, arm_r + 5, [50, 50])]},
        "HEAD": {"rot": [K(0, -22, [50, 50]), K(1.25, -26, [50, 50]), K(2.5, -22, [50, 50]), K(3.75, -18, [50, 50])]},
        "TORSO": {"rot": [K(0, -2, [50, 50]), K(1.25, 0, [50, 50]), K(2.5, -2, [50, 50]), K(3.75, -4, [50, 50])]},
    }
    chars = character(vec, feet, scale, A)
    sky = [128, 186, 236]
    layers = [background(sky),
              layer("SKY_GLOW", [group("Glow", [ellipse_path(540, 1350, 950, 560)], fill=[200, 228, 250])], blur=120)]
    rng = np.random.default_rng(3)
    # дальние облака: светлые, медленные, за персонажем
    far = [(330, 340, 1, 0.1), (560, 250, 1, 0.55), (1030, 300, 1, 0.8), (150, 220, 1, 0.35)]
    for j, (y, w, laps, ph) in enumerate(far):
        cp = cloud_path(w, w * 0.42, [(-0.25, 0.55), (0.02, 0.8), (0.27, 0.6)])
        layers.append(layer("CLOUD_FAR_%d" % (j + 1), [group("Cloud", [cp], fill=[226, 241, 252])], opacity=85,
                            pos=keys(*[K(x[0], [x[1], y], x[2]) for x in scroll_x(1080 + w * 0.6, -w * 0.6, laps, ph)])))
    for j in range(8):   # линии скорости
        y = 120 + j * 150 + rng.uniform(-35, 35)
        ln = rng.uniform(140, 300)
        layers.append(layer("SPEED_%d" % (j + 1), [group("Line", [poly_path([[0, 0], [ln, 0]], closed=False)], stroke=[255, 255, 255], width=8,
                                                          strokeOpacity=90)],
                            pos=keys(*[K(x[0], [x[1], y], x[2]) for x in scroll_x(1080 + 40, -ln - 40, 4 + j % 3, rng.uniform(0, 1))])))
    # шлейф ветра за ногами
    sc = Scene(scene("tmp", [0, 0, 0], layers + chars))
    for j, (px, py) in enumerate(((620, 1740), (880, 1740), (750, 1650))):
        p0 = sc.to_comp("LEGS", [px, py], 0)
        ln = 150 + 40 * j
        t0 = j * 0.42
        layers.append(layer("WIND_%d" % (j + 1), [group("Wind", [poly_path([[0, 0], [ln, 0]], closed=False)], stroke=[255, 255, 255], width=7,
                                                         trim={"start": keys(*loop([K(t0, 0, "L"), K(t0 + 0.5, 0, "L"), K(t0 + 1.0, 100, "L"),
                                                                                    K(t0 + 1.25, 100, "L")])),
                                                               "end": keys(*loop([K(t0, 0, "L"), K(t0 + 0.5, 100, "L"), K(t0 + 1.25, 100, "L")]))})],
                            pos=[p0[0] - ln - 20, p0[1] + 8 * j]))
    layers += chars
    near = [(1330, 520, 2, 0.15), (175, 380, 2, 0.62)]   # ближние облака — с контуром, быстрые, по краям кадра
    for j, (y, w, laps, ph) in enumerate(near):
        cp = cloud_path(w, w * 0.4, [(-0.27, 0.6), (0.0, 0.85), (0.26, 0.62)])
        layers.append(layer("CLOUD_NEAR_%d" % (j + 1), [group("Outline", [cp], stroke=OUTLINE, width=9), group("Cloud", [cp], fill=[255, 255, 255])],
                            pos=keys(*[K(x[0], [x[1], y], x[2]) for x in scroll_x(1080 + w * 0.6, -w * 0.6, laps, ph)])))
    return scene("VARSITY_BEAR_FLY", sky, layers)


# =============================================================================================
# RED_SUIT · микрофон: берёт микрофон со стойки, подносит ко рту, говорит (рот, звуковые дуги),
# возвращает на стойку
# =============================================================================================

class TubeArm:
    """a LEGO arm rebuilt as a sleeve along a spine with the original width profile. Raised towards the camera,
    only the spine shortens (squash about the shoulder) -> the arm stays round and clean, the outline uniform"""

    def __init__(self, vec, name, n=14):
        from scenekit import flatten
        part, piv = vec["parts"][name], vec["pivots"]
        self.S = np.array(piv[name], float)
        self.Wr = np.array(piv["HAND" + name[3:]], float)
        P = np.concatenate([flatten(p) for p in part["base"]["paths"]])
        x0, y0 = np.floor(P.min(0)).astype(int) - 2
        m = np.zeros((int(P[:, 1].max()) - y0 + 4, int(P[:, 0].max()) - x0 + 4), np.uint8)
        import cv2
        cv2.fillPoly(m, [np.round(P - [x0, y0]).astype(np.int32)], 1)
        ys = np.linspace(self.S[1], self.Wr[1] - 14, 24)
        cx, wd = [], []
        for y in ys:
            row = np.nonzero(m[int(round(y)) - y0])[0]
            cx.append((row.min() + row.max()) / 2 + x0)
            wd.append(row.max() - row.min())
        u = (ys - ys[0]) / (ys[-1] - ys[0])
        self.cx = np.poly1d(np.polyfit(u, cx, 2))
        self.wd = np.poly1d(np.polyfit(u, wd, 2))
        self.n = n
        base = part["base"]["color"]
        same_hue = [pr["color"] for pr in part["prints"] if max(pr["color"]) > 90 and np.argmax(pr["color"]) == np.argmax(base)
                    and sum(pr["color"]) < sum(base)]
        shade = max(same_hue, key=sum) if same_hue else [int(c * 0.78) for c in base]
        self.colors = {"base": base, "shade": shade}
        self.inner = -1 if self.S[0] > piv["TORSO"][0] else 1   # side towards the body
        self.rest_end = self.tangent(1.0)

    def spine(self, s):
        u = np.linspace(0, 1, self.n)
        x = self.cx(u) + (self.Wr[0] - self.cx(1)) * u ** 2        # end exactly at the wrist
        y = self.S[1] + (self.Wr[1] - self.S[1]) * u
        return np.stack([x, self.S[1] + (y - self.S[1]) * s], 1), self.wd(u)

    def tangent(self, s):
        Q, _ = self.spine(s)
        d = Q[-1] - Q[-3]
        return math.degrees(math.atan2(d[1], d[0]))

    def paths(self, s):
        s = s if abs(s) > 0.06 else math.copysign(0.06, s or 1)
        Q, w = self.spine(s)
        T = np.gradient(Q, axis=0)
        T /= np.linalg.norm(T, axis=1, keepdims=True) + 1e-9
        N = np.stack([-T[:, 1], T[:, 0]], 1)
        L = Q + N * (w / 2)[:, None]
        R = Q - N * (w / 2)[:, None]
        r0 = w[0] / 2   # round shoulder ball behind the spine start
        a0 = math.atan2(N[0, 1], N[0, 0])
        cap = [Q[0] + r0 * np.array([math.cos(a0 + math.pi * k / 6), math.sin(a0 + math.pi * k / 6)]) for k in range(1, 6)]
        outline = smooth_path(list(L[::-1]) + cap + list(R), closed=True)
        side = -self.inner * (1 if s > 0 else -1)
        k0 = int(self.n * 0.32)
        a = Q[k0:-1] + N[k0:-1] * (side * w[k0:-1] / 2)[:, None]
        b = Q[k0:-1] + N[k0:-1] * (side * w[k0:-1] * 0.2)[:, None]
        shade = smooth_path(list(a) + list(b[::-1]), closed=True, tension=0.6)
        j = int(self.n * 0.62)
        crease = poly_path([Q[j] - N[j] * side * w[j] * 0.05, Q[j] - N[j] * side * w[j] * 0.3], closed=False)
        h = self.n - 2
        hem = smooth_path([L[h], Q[h] + (Q[-1] - Q[h]) * 0.5, R[h]], closed=False)
        return outline, shade, crease, hem

    def groups(self, s_of_t, times):
        sv = [round(s_of_t(t), 4) for t in times]
        keep = [j for j in range(len(times)) if j in (0, len(times) - 1) or not (sv[j - 1] == sv[j] == sv[j + 1])]

        def pk(i):   # path keys only where the arm length changes
            return [[round(times[j], 4), [self.paths(sv[j])[i]]] for j in keep]
        base, shade = self.colors["base"], self.colors["shade"]
        return [group("Outline", [], stroke=OUTLINE, width=9, pathKeys=pk(0)),
                group("Hem", [], stroke=OUTLINE, width=6, pathKeys=pk(3)),
                group("Crease", [], stroke=OUTLINE, width=6, pathKeys=pk(2)),
                group("Shade", [], fill=shade, pathKeys=pk(1)),
                group("Sleeve", [], fill=base, pathKeys=pk(0))]


def mic_groups(gx, gy):
    """microphone around the grip point (gx, gy), head up: handle through the hand, ball grille on top"""
    hw, top, bot, R, cy = 26, gy - 70, gy + 175, 50, gy - 114
    handle = poly_path([[gx - hw, top], [gx - hw * 0.72, bot - 8], [gx - hw * 0.4, bot], [gx + hw * 0.4, bot], [gx + hw * 0.72, bot - 8],
                        [gx + hw, top]])
    ring = rrect_path(gx - hw - 8, top - 16, gx + hw + 8, top + 6, 6)
    ball = ellipse_path(gx, cy, R, R)
    grille = []
    for k in (-0.55, 0.0, 0.55):   # mesh lines inside the ball
        h = math.sqrt(1 - k * k) * R * 0.92
        grille.append(poly_path([[gx - h, cy + k * R], [gx + h, cy + k * R]], closed=False))
        grille.append(poly_path([[gx + k * R, cy - h], [gx + k * R, cy + h]], closed=False))
    shine = ellipse_path(gx - R * 0.38, cy - R * 0.42, R * 0.2, R * 0.13)
    return [group("Ball Outline", [ball], stroke=OUTLINE, width=8), group("Shine", [shine], fill=[255, 255, 255]),
            group("Grille", grille, stroke=[96, 100, 110], width=5), group("Ball", [ball], fill=[188, 193, 201]),
            group("Ring Outline", [ring], stroke=OUTLINE, width=7), group("Ring", [ring], fill=[150, 156, 166]),
            group("Handle Outline", [handle], stroke=OUTLINE, width=8), group("Handle", [handle], fill=[44, 44, 50])]


def build_suit(talk=(-155, 16, 30)):
    """talk = (ARM_R rotation, how much of the arm length is seen %, extra wrist turn) of the 'mic at the mouth' pose"""
    th, sq, ex = talk
    vec = load_vec("RED_SUIT")
    feet, scale = [420, 1250], 63
    piv = vec["pivots"]
    grip = [1080, 1250]                 # centre of the C of HAND_R (source px)
    mouth = [745, 594]
    t_grab, t_up, t_talk_end, t_down, t_rel = 1.0, 1.55, 3.5, 4.0, 4.1
    syll = [1.62, 1.78, 1.9, 2.08, 2.22, 2.4, 2.52, 2.75, 2.88, 3.02, 3.18, 3.3]
    A = {
        "ARM_R": {"rot": [K(0, 0), K(0.5, 0), K(0.62, 4, SNAP), K(0.95, -40, [60, 30]), K(t_grab, -38, HIT), K(1.08, -38),
                          K(1.5, th - 3, [60, 30]), K(t_up, th, HIT), K(2.2, th - 2), K(2.85, th + 2), K(t_talk_end, th - 1),
                          K(3.95, -40, [60, 40]), K(t_rel, -38, HIT), K(4.2, -38), K(4.55, 2, [60, 30]), K(4.7, 0, HIT)],
                  "squash": [K(0, 100), K(1.08, 100), K(1.5, sq, [60, 30]), K(t_talk_end, sq), K(3.95, 100, [60, 40])]},
        "ARM_L": {"rot": [K(0, 0), K(1.4, 0), K(1.7, 10, HIT), K(3.5, 8), K(3.9, 0)]},
        "HEAD": {"rot": [K(0, 0), K(0.25, -3), K(0.5, 0), K(1.2, 0), K(1.6, -5, HIT)] +
                        [K(t, (-7 if i % 2 else -3), [45, 45]) for i, t in enumerate(syll)] + [K(3.6, -4), K(4.2, 0)],
                 "pos": [K(0, [0, 0]), K(0.25, [0, 10]), K(0.5, [0, 0]), K(1.6, [0, 0])] +
                        [K(t, [0, 7 if i % 2 else 0], [45, 45]) for i, t in enumerate(syll)] + [K(3.6, [0, 0])]},
        "TORSO": {"rot": [K(0, 0), K(0.6, 0), K(1.0, -2, HIT), K(1.6, 1.5), K(2.6, -1), K(3.5, 1.5), K(4.2, 0)]},
        "LEGS": {"pos": [K(0, [0, 0])] + [x for i in range(4) for x in (K(1.65 + i * 0.47, [0, -7]), K(1.88 + i * 0.47, [0, 0]))]},
    }
    chars = character(vec, feet, scale, A, front=("ARM_R",))
    # правая рука — рукав-трубка: к камере укорачивается только ось, толщина и обводка остаются ровными
    tube = TubeArm(vec, "ARM_R")
    by = {L["name"]: L for L in chars}
    sq_v = by["ARM_R"]["squash"]["s"]
    s_of = lambda t: value(sq_v, t) / 100
    frames = [round(f / FPS, 4) for f in range(int(DUR * FPS) + 1)]
    by["ARM_R"]["groups"] = tube.groups(s_of, frames)
    by["ARM_R"]["squash"] = None
    twist = lambda t: ex * smoothstep((t - 1.08) / 0.42) * smoothstep((3.95 - t) / 0.45)
    by["HAND_R"]["rot"] = keys(*sampled(lambda t: round(tube.tangent(s_of(t)) - tube.rest_end + twist(t), 3), 0, DUR))
    bg = [246, 238, 226]
    layers = [background(bg),
              layer("SPOTLIGHT", [group("Light", [ellipse_path(feet[0] + 60, 760, 430, 620)], fill=[255, 250, 240])], blur=90, opacity=90)]
    sc = Scene(scene("tmp", [0, 0, 0], layers + chars))

    def hand_rot(t):
        return sc.world_rot("HAND_R", t)

    # микрофон в руке: вертикально в момент захвата и отпускания, между ними целится шаром в рот
    def aim(t):
        g = sc.to_comp("HAND_R", grip, t)
        m = sc.to_comp("HEAD", [mouth[0] + 62, mouth[1] + 6], t)   # ball just beside the lips
        d = m - g
        return math.degrees(math.atan2(d[0], -d[1]))

    def smooth(x):
        x = min(1.0, max(0.0, x))
        return x * x * (3 - 2 * x)

    def mic_world(t):
        if t <= t_grab or t >= t_rel:
            return 0.0
        up = smooth((t - t_grab - 0.1) / (t_up - t_grab - 0.1))
        down = smooth((t_rel - 0.08 - t) / (t_rel - 0.08 - t_talk_end))
        return aim(t) * min(up, down)

    mic_rot = sampled(lambda t: round(mic_world(t) - hand_rot(t), 3), t_grab, t_rel, 1 / 30)
    mic_rot = [K(0, mic_rot[0][1], "L")] + mic_rot + [K(DUR, mic_rot[-1][1], "L")]
    mic_hand = layer("MIC", mic_groups(*grip), parent="HAND_R", anchor=grip, pos=grip, rot=keys(*mic_rot),
                     opacity=keys(K(0, 0, "H"), K(t_grab, 100, "H"), K(t_rel, 0, "H"), K(DUR, 0, "H")))
    # стойка: микрофон на ней ровно там, где окажется микрофон в руке в момент захвата
    g0 = sc.to_comp("HAND_R", grip, t_grab)
    k = scale / 100
    floor = feet[1]
    clip_y = g0[1] + 60 * k
    stand_groups = [group("Clip Outline", [rrect_path(g0[0] - 34 * k, clip_y - 18 * k, g0[0] + 34 * k, clip_y + 22 * k, 8 * k)], stroke=OUTLINE, width=6),
                    group("Clip", [rrect_path(g0[0] - 34 * k, clip_y - 18 * k, g0[0] + 34 * k, clip_y + 22 * k, 8 * k)], fill=[70, 70, 78]),
                    group("Pole Outline", [rrect_path(g0[0] - 7, clip_y, g0[0] + 7, floor - 30, 4)], stroke=OUTLINE, width=6),
                    group("Pole", [rrect_path(g0[0] - 7, clip_y, g0[0] + 7, floor - 30, 4)], fill=[96, 96, 104]),
                    group("Legs", [poly_path([[g0[0], floor - 34], [g0[0] - 70, floor]], closed=False),
                                   poly_path([[g0[0], floor - 34], [g0[0] + 70, floor]], closed=False),
                                   poly_path([[g0[0], floor - 34], [g0[0], floor - 2]], closed=False)], stroke=[60, 60, 66], width=10)]
    layers.append(layer("STAND_SHADOW", [group("Shadow", [ellipse_path(g0[0], floor + 4, 90, 12)], fill=[0, 0, 0])], blur=14, opacity=16))
    layers.append(layer("MIC_STAND", stand_groups))
    layers.append(layer("MIC_ON_STAND", mic_groups(*grip), anchor=grip, pos=list(g0), rot=0, scale=[scale, scale],
                        opacity=keys(K(0, 100, "H"), K(t_grab, 0, "H"), K(t_rel, 100, "H"), K(DUR, 100, "H"))))
    layers.append(floor_shadow(sc, feet))
    layers += chars
    layers = insert_after(layers, "TORSO", [mic_hand])
    # рот: открывается по слогам
    mouth_sc = [K(0, [100, 10]), K(t_up, [100, 10])]
    for i, t in enumerate(syll):
        mouth_sc += [K(t, [100, [90, 55, 100, 70][i % 4]], [40, 60]), K(t + 0.07, [100, 18], [60, 40])]
    mouth_sc += [K(3.42, [100, 10]), K(DUR, [100, 10])]
    mp = ellipse_path(mouth[0], mouth[1], 30, 17)
    mouth_layers = [layer("MOUTH", [group("Outline", [mp], stroke=OUTLINE, width=6), group("Tongue", [ellipse_path(mouth[0], mouth[1] + 9, 16, 7)],
                                                                                          fill=[196, 70, 70]),
                                  group("Mouth", [mp], fill=[64, 16, 20])], parent="HEAD", anchor=mouth, pos=mouth,
                        scale=keys(*mouth_sc), opacity=keys(K(0, 0, "H"), K(1.58, 100, "H"), K(3.45, 0, "H"), K(DUR, 0, "H")))]
    # звуковые дуги у рта (по другую сторону от микрофона)
    for j in range(3):
        c = [mouth[0] - 215, mouth[1]]
        arc = smooth_path([[c[0] - 30 * (j + 1) * 0.4, c[1] - 55 - 18 * j], [c[0] - 30 - 22 * j, c[1]], [c[0] - 30 * (j + 1) * 0.4, c[1] + 55 + 18 * j]])
        sc_k, op_k = [K(0, [60, 60])], [K(0, 0)]
        for n in range(4):
            t = 1.7 + n * 0.45 + j * 0.12
            sc_k += [K(t, [60, 60], "L"), K(t + 0.42, [130, 130], "L")]
            op_k += [K(t, 0, "L"), K(t + 0.1, 100, "L"), K(t + 0.42, 0, "L")]
        mouth_layers.append(layer("SOUND_%d" % (j + 1), [group("Arc", [arc], stroke=[222, 40, 60], width=12)], parent="HEAD", anchor=[mouth[0] - 60, mouth[1]],
                            pos=[mouth[0] - 60, mouth[1]], scale=keys(*sc_k, K(DUR, [60, 60])), opacity=keys(*op_k, K(DUR, 0))))
    layers = insert_after(layers, "HEAD", mouth_layers)   # face details sit under the torso, mic and hands
    return scene("RED_SUIT_MIC", bg, layers)


# =============================================================================================
# RED_DREADS · спрей: красная аура, встряхивает баллончик и пишет на стене «Red» с подтёками
# (как на референсе), любуется, надпись тает; всё по кругу
# =============================================================================================

def can_groups(gx, gy):
    """spray can held at the grip (gx, gy), axis up, nozzle on the cap pointing right (+x)"""
    w, top, bot = 34, gy - 112, gy + 96
    body = rrect_path(gx - w, top, gx + w, bot, 12)
    label = rrect_path(gx - w, gy - 50, gx + w, gy + 34, 0)
    dome = smooth_path([[gx - w, top + 6], [gx - w * 0.6, top - 22], [gx + w * 0.6, top - 22], [gx + w, top + 6]], closed=True, tension=0.6)
    cap = rrect_path(gx - 14, top - 52, gx + 14, top - 18, 6)
    nozzle = rrect_path(gx + 10, top - 46, gx + 30, top - 34, 3)
    shine = rrect_path(gx - w + 9, top + 14, gx - w + 19, bot - 14, 5)
    return [group("Nozzle", [nozzle], fill=[40, 40, 44], stroke=OUTLINE, width=5),
            group("Cap Outline", [cap], stroke=OUTLINE, width=7), group("Cap", [cap], fill=[236, 236, 240]),
            group("Dome Outline", [dome], stroke=OUTLINE, width=7), group("Dome", [dome], fill=[150, 154, 162]),
            group("Outline", [body], stroke=OUTLINE, width=8), group("Shine", [shine], fill=[255, 255, 255], fillOpacity=55),
            group("Label", [label], fill=[214, 26, 46]), group("Body", [body], fill=[36, 36, 42])]


def star_path(cx, cy, r, inner=0.28, n=4):
    pts = []
    for k in range(2 * n):
        a = math.pi * k / n - math.pi / 2
        rr = r if k % 2 == 0 else r * inner
        pts.append([cx + rr * math.cos(a), cy + rr * math.sin(a)])
    return poly_path(pts)


def brick_wall(color, y0=0, y1=1250, h=64, w=150):
    lines = []
    for r, y in enumerate(range(y0, y1, h)):
        lines.append(poly_path([[-20, y], [W + 20, y]], closed=False))
        off = 0 if r % 2 == 0 else w / 2
        for x in np.arange(-off, W + w, w):
            lines.append(poly_path([[x, y], [x, min(y + h, y1)]], closed=False))
    return [group("Mortar", lines, stroke=color, width=4)]


def smoothstep(x):
    x = min(1.0, max(0.0, x))
    return x * x * (3 - 2 * x)


def build_spray():
    vec = load_vec("RED_DREADS")
    feet, scale = [345, 1250], 60
    grip = [1134, 1290]
    T0, T1, gap = 1.25, 2.95, 0.07
    strokes = [   # «Red», кисть-скрипт (comp px)
        [(672, 172), (669, 250), (662, 330), (656, 370)],
        [(664, 188), (702, 160), (752, 160), (778, 194), (762, 236), (716, 258), (678, 262), (704, 270), (738, 302), (762, 346), (786, 370), (802, 362)],
        [(814, 322), (852, 314), (870, 292), (856, 268), (828, 272), (812, 302), (815, 340), (842, 364), (878, 356)],
        [(962, 292), (936, 272), (906, 280), (891, 316), (899, 350), (926, 364), (953, 342), (964, 302)],
        [(988, 150), (978, 250), (970, 332), (972, 366), (996, 370), (1018, 356)],
    ]
    paths = [smooth_path(st) for st in strokes]
    from scenekit import flatten
    lens = [float(np.sum(np.linalg.norm(np.diff(flatten(p, 24), axis=0), axis=1))) for p in paths]
    rate = (T1 - T0 - gap * (len(paths) - 1)) / sum(lens)
    spans, t = [], T0
    for L in lens:
        spans.append((t, t + L * rate))
        t += L * rate + gap

    def pen(t):
        for i, (a, b) in enumerate(spans):
            if t <= b or i == len(spans) - 1:
                if t < a:   # pen lift: glide from the end of the previous stroke
                    p0, p1 = point_on(paths[i - 1], 1.0), point_on(paths[i], 0.0)
                    return p0 + (p1 - p0) * smoothstep((t - spans[i - 1][1]) / gap)
                return point_on(paths[i], min(1.0, max(0.0, (t - a) / (b - a))))

    # персонаж: рука с баллончиком считается покадрово (следит за точкой рисования)
    A = {
        "HEAD": {"rot": [K(0, 0), K(0.2, -3), K(0.4, 0), K(1.2, 4, S), K(2.0, 6), K(2.9, 5), K(3.15, -2, HIT), K(3.45, 3), K(3.9, 0)],
                 "pos": [K(0, [0, 0]), K(0.2, [0, 10]), K(0.4, [0, 0]), K(3.0, [0, 0]), K(3.15, [0, 12], HIT), K(3.45, [0, 0])]},
        "TORSO": {"rot": [K(0, 0), K(1.0, 0), K(1.3, -2.5, HIT), K(2.9, -2.5), K(3.3, 1), K(3.9, 0)]},
        "ARM_L": {"rot": [K(0, 0), K(1.2, 0), K(1.5, 8, HIT), K(2.9, 8), K(3.3, 14, HIT), K(3.8, 0)]},
    }
    chars = character(vec, feet, scale, A)
    by = {L["name"]: L for L in chars}
    sc = Scene(scene("tmp", [0, 0, 0], chars))
    piv = vec["pivots"]

    def aim(t):   # arm rotation that points the arm at the pen
        save = by["ARM_R"]["rot"]
        by["ARM_R"]["rot"] = 0
        sh = sc.to_comp("ARM_R", piv["ARM_R"], t)
        g0 = sc.to_comp("HAND_R", grip, t)
        by["ARM_R"]["rot"] = save
        p = pen(t)
        return math.degrees(math.atan2(p[1] - sh[1], p[0] - sh[0]) - math.atan2(g0[1] - sh[1], g0[0] - sh[0]))

    a_start, a_end = aim(T0), aim(T1)

    def arm(t):
        if t < 0.35:
            return 0.0
        if t < 0.95:   # встряхивает баллончик
            base = -26 * smoothstep((t - 0.35) / 0.15)
            return base + 9 * math.sin(2 * math.pi * 6.5 * (t - 0.5)) * smoothstep((t - 0.45) / 0.1) * smoothstep((0.95 - t) / 0.1)
        if t < T0:
            return -26 + (a_start + 26) * smoothstep((t - 0.95) / (T0 - 0.95))
        if t < T1:
            return aim(t)
        if t < 3.25:
            return a_end + (-62 - a_end) * smoothstep((t - T1) / 0.3)
        if t < 3.7:
            return -62 + 3 * math.sin(2 * math.pi * (t - 3.25) / 0.45)
        return -62 * (1 - smoothstep((t - 3.7) / 0.5))

    by["ARM_R"]["rot"] = keys(*sampled(lambda t: round(arm(t), 3), 0, DUR))
    sc = Scene(scene("tmp", [0, 0, 0], chars))
    nozzle_local = [grip[0] + 30, grip[1] - 112 - 40]

    def can_world(t):
        if T0 - 0.2 <= t <= T1 + 0.2:   # сопло смотрит на точку рисования
            k = smoothstep((t - (T0 - 0.2)) / 0.2) * smoothstep((T1 + 0.2 - t) / 0.2)
            nz = sc.to_comp("HAND_R", nozzle_local, t)
            d = pen(min(max(t, T0), T1)) - nz
            want = max(-70, min(35, math.degrees(math.atan2(d[1], d[0]))))
            return -8 * (1 - k) + want * k
        return -8.0

    can_rot = sampled(lambda t: round(can_world(t) - sc.world_rot("HAND_R", t), 3), 0, DUR)
    can = layer("SPRAY_CAN", can_groups(*grip), parent="HAND_R", anchor=grip, pos=grip, rot=keys(*can_rot))
    chars = insert_after(chars, "TORSO", [can])
    sc = Scene(scene("tmp", [0, 0, 0], chars))

    bg = [240, 228, 230]
    layers = [background(bg), layer("WALL", brick_wall([228, 212, 216])),
              layer("FLOOR", [group("Floor", [rrect_path(-20, 1250, W + 20, H + 20, 0)], fill=[222, 206, 210]),
                              group("Edge", [poly_path([[-20, 1250], [W + 20, 1250]], closed=False)], stroke=[200, 182, 188], width=5)])]
    # надпись: обводка-перелив (мягкое свечение) + краска + подтёки; тает после любования
    red, dark = [214, 24, 44], [150, 10, 28]
    fade = keys(K(0, 100), K(3.6, 100), K(4.15, 0, [60, 40]), K(DUR, 0))
    trims = [{"start": 0, "end": keys(K(0, 0, "L"), K(a, 0, "L"), K(b, 100, "L"), K(DUR, 100, "L"))} for a, b in spans]
    layers.append(layer("RED_GLOW", [group("Glow %d" % (i + 1), [p], stroke=[255, 60, 90], width=48, trim=trims[i]) for i, p in enumerate(paths)],
                        opacity=keys(K(0, 45), K(3.6, 45), K(4.15, 0, [60, 40]), K(DUR, 0)), blur=18))
    drips = [(0, 1.0, 70), (1, 0.97, 120), (2, 0.86, 64), (3, 0.62, 52), (4, 0.8, 140), (1, 0.42, 44)]
    dgroups = []
    for j, (si, f, ln) in enumerate(drips):
        p0 = point_on(paths[si], f)
        tp = spans[si][0] + (spans[si][1] - spans[si][0]) * f + 0.12
        dgroups.append(group("Drip %d" % (j + 1), [poly_path([[p0[0], p0[1]], [p0[0] + 2, p0[1] + ln]], closed=False)], stroke=red, width=13,
                             trim={"start": 0, "end": keys(K(0, 0), K(tp, 0, [33, 8]), K(tp + 1.3, 100, [88, 33]), K(DUR, 100))}))
    layers.append(layer("RED_PAINT", dgroups + [group("Stroke %d" % (i + 1), [p], stroke=red, width=26, trim=trims[i]) for i, p in enumerate(paths)],
                        opacity=fade))
    layers.append(layer("RED_SHADE", [group("Shade %d" % (i + 1), [xform_path(p, np.array([[1, 0, 4], [0, 1, 5], [0, 0, 1.0]]))], stroke=dark,
                                            width=26, trim=trims[i]) for i, p in enumerate(paths)], opacity=fade))
    layers[-1], layers[-2] = layers[-2], layers[-1]   # тень под краской
    # аура: красное свечение по силуэту каждой детали (дети деталей), пульсирует
    pulse = keys(*[K(i * 0.625, 55 if i % 2 == 0 else 85, [50, 50]) for i in range(9)])
    aura = []
    for L in chars:
        if L["name"] in ORDER:
            part = vec["parts"][L["name"]]
            aura.append(layer("AURA_" + L["name"], [group("Glow", part["base"]["paths"], fill=[255, 30, 70], stroke=[255, 30, 70], width=60)],
                              parent=L["name"], anchor=piv[L["name"]], pos=piv[L["name"]], blur=60, opacity=pulse))
    layers += aura
    layers.append(floor_shadow(sc, feet))
    # искры ауры: поднимаются вокруг фигуры
    rng = np.random.default_rng(11)
    for j in range(12):
        x = feet[0] + rng.uniform(-230, 230)
        y0, y1 = 1180 - rng.uniform(0, 300), 350 - rng.uniform(0, 200)
        laps = int(rng.choice([2, 3]))
        ph = rng.uniform(0, 1)
        r = rng.uniform(7, 13)
        ks = [K(k[0], [x + 18 * math.sin(k[0] * 3 + j), k[1]], k[2]) for k in scroll_x(y0, y1, laps, ph)]
        layers.append(layer("SPARK_%d" % (j + 1), [group("Spark", [star_path(0, 0, r, 0.35)], fill=[255, 90, 120] if j % 3 else [255, 255, 255])],
                            pos=keys(*ks), rot=keys(K(0, 0, "L"), K(DUR, 360 * (1 if j % 2 else -1), "L")),
                            opacity=keys(*[K(i * 0.5 + (j % 5) * 0.1, 90 if i % 2 == 0 else 25, [50, 50]) for i in range(10)])))
    layers += chars
    # спрей: конус краски от сопла к точке рисования + капельки
    def cone(t):
        nz = sc.to_comp("SPRAY_CAN", nozzle_local, t)
        pp = pen(min(max(t, T0), T1))
        d = pp - nz
        n = np.array([-d[1], d[0]]) / (np.linalg.norm(d) + 1e-6)
        out = [poly_path([nz + n * 4, pp + n * 24, pp - n * 24, nz - n * 4])]
        for k in range(7):
            u = (t * 7.3 + k * 0.37) % 1
            c = nz + d * u + n * rng_j[k] * 26 * u
            out.append(ellipse_path(c[0], c[1], 3.5, 3.5))
        return out
    rng_j = np.random.default_rng(5).uniform(-1, 1, 7)
    pk = [[round(t, 4), cone(t)] for t in np.arange(T0 - 1 / 30, T1 + 1 / 30 + 1e-6, 1 / 30)]
    layers.append(layer("SPRAY_MIST", [group("Mist", [], fill=[255, 70, 100], fillOpacity=55, pathKeys=pk)], blur=6,
                        opacity=keys(K(0, 0, "H"), K(T0, 100, "H"), K(T1, 0, "H"), K(DUR, 0, "H"))))
    # блик на очках, когда любуется
    gl = [845, 458]
    layers.append(layer("GLASSES_GLINT", [group("Glint", [star_path(gl[0], gl[1], 46, 0.18)], fill=[255, 255, 255])], parent="HEAD", anchor=gl, pos=gl,
                        scale=keys(K(0, [0, 0]), K(0.15, [0, 0]), K(0.3, [100, 100], [40, 60]), K(0.5, [0, 0]), K(3.15, [0, 0]), K(3.3, [120, 120], [40, 60]),
                                   K(3.55, [0, 0]), K(DUR, [0, 0])),
                        rot=keys(K(0, 0), K(0.5, 90), K(3.15, 0), K(3.55, 90), K(DUR, 90))))
    return scene("RED_DREADS_SPRAY", bg, layers)


# =============================================================================================
# ASTRO_BRICK · хедбэнг: трясёт головой, дреды развеваются (каждая прядь — маятник на голове,
# изгиб считается физикой и передаётся выражению на контурах)
# =============================================================================================

def simulate_strands(sc, dreads, scale, k_bend=1.15, limit=42, laps=3, dt=1 / 240):
    """pendulum per lock driven by the head; returns {name: [(t, bend deg)]} for one steady loop"""
    out = {}
    for i, d in enumerate(dreads):
        root = d["root"]
        l = d["len"] * 0.62 * scale / 100
        w = 2 * math.pi * (2.0 + 0.25 * (i % 3))       # natural frequency per lock
        g, c = w * w * l, 5.0
        T = np.arange(0, DUR * laps, dt)
        R = np.array([sc.to_comp("HEAD", root, t % DUR) for t in T])
        th = np.array([sc.world_rot("HEAD", t % DUR) for t in T])
        acc = np.gradient(np.gradient(R, dt, axis=0), dt, axis=0)
        phi, om, rel = 0.0, 0.0, []
        for j in range(len(T)):
            ax, ay = acc[j]
            a = (ax * math.cos(phi) - (g - ay) * math.sin(phi)) / l - c * om
            om += a * dt
            phi += om * dt
            rel.append(math.degrees(phi) - th[j])
        rel = np.array(rel)
        n = int(round(DUR / dt))
        last = rel[-n:]
        out[d["name"]] = [(round(t, 4), round(float(limit * math.tanh(k_bend * last[int(round(t / dt)) % n] / limit)), 2))
                          for t in np.arange(0, DUR + 1e-6, 1 / 30)]
        out[d["name"]][-1] = (DUR, out[d["name"]][0][1])
    return out


def open_outline(p, y_min):
    """the part of a closed outline below y_min, as an open path (the top run is dropped)"""
    v = p["v"]
    n = len(v)
    low = [v[k][1] >= y_min for k in range(n)]
    if all(low) or not any(low):
        return [p]
    start = next(k for k in range(n) if low[k] and not low[k - 1])   # first vertex after the top run
    out, k = [], start
    while low[k % n]:
        out.append(k % n)
        k += 1
    idx = [(out[0] - 1) % n] + out + [(out[-1] + 1) % n]   # reach just into the top run (stroke ends in the hair)
    return [{"v": [v[i] for i in idx], "i": [p["i"][i] for i in idx], "o": [p["o"][i] for i in idx], "c": False}]


def dread_groups(part, lw, stroke_from, root_y):
    outline = [q for pth in part["base"]["paths"] for q in open_outline(pth, stroke_from)]
    top = np.array([v for pth in part["base"]["paths"] for v in pth["v"] if v[1] < stroke_from] or [[0, 0]])
    g = [group("Outline", outline, stroke=OUTLINE, width=lw)]
    g += [group("Print %d" % (i + 1), pr["paths"], fill=pr["color"]) for i, pr in enumerate(part["prints"])]
    if len(top) > 1:   # the root is hair-dark (it melts into the hair cap)
        g.append(group("Root", [rrect_path(top[:, 0].min() + 2, root_y - 2, top[:, 0].max() - 2, stroke_from + 4, 6)], fill=[14, 12, 12]))
    g += [group("Base", part["base"]["paths"], fill=part["base"]["color"])]
    return g


def build_headbang():
    vec = load_vec("ASTRO_BRICK_DREADS")
    feet, scale = [540, 1250], 58
    beat = 0.25
    shake = []
    for i in range(int((4.2 - 0.6) / beat) + 1):
        t = 0.6 + i * beat
        shake.append(K(t, 13 if i % 2 == 0 else -13, [38, 38]))
    A = {
        "HEAD": {"rot": [K(0, 0), K(0.2, -3), K(0.4, 3), K(0.6, 0)] + shake[1:] + [K(4.45, 7, [40, 60]), K(4.7, -3), K(4.9, 0)],
                 "pos": [K(0, [0, 0]), K(0.3, [0, 8]), K(0.6, [0, 0])] +
                        [K(0.6 + i * beat + beat / 2, [0, 12 if i % 2 == 0 else 6], [45, 45]) for i in range(int((4.2 - 0.6) / beat))] +
                        [K(4.4, [0, 0])]},
        "TORSO": {"rot": [K(0, 0), K(0.6, 0)] + [K(0.6 + i * beat + 0.08, (-3 if i % 2 == 0 else 3), [45, 45]) for i in range(1, 14)] +
                         [K(4.5, 0)]},
        "ARM_L": {"rot": [K(0, 0), K(0.6, 0)] + [K(0.6 + i * beat + 0.12, (14 if i % 2 == 0 else -4), [45, 45]) for i in range(1, 14)] +
                         [K(4.6, 0)]},
        "ARM_R": {"rot": [K(0, 0), K(0.6, 0)] + [K(0.6 + i * beat + 0.12, (4 if i % 2 == 0 else -14), [45, 45]) for i in range(1, 14)] +
                         [K(4.6, 0)]},
        "LEGS": {"pos": [K(0, [0, 0]), K(0.6, [0, 0])] + [K(0.6 + i * 2 * beat + beat, [0, -9], [45, 45]) for i in range(7)] +
                        [K(0.6 + i * 2 * beat, [0, 0], [45, 45]) for i in range(1, 8)] + [K(4.6, [0, 0])]},
    }
    for p in A.values():
        for k_ in p:
            p[k_] = sorted(p[k_], key=lambda x: x[0])
    chars = character(vec, feet, scale, A)
    piv = vec["pivots"]
    dread_layers = []
    for d in vec["dreads"]:
        part = vec["parts"][d["name"]]
        dread_layers.append(layer(d["name"], dread_groups(part, vec["lineWidth"], d["strokeFrom"], d["root"][1]), parent="HEAD", anchor=d["root"], pos=d["root"],
                                  bend={"root": d["root"], "len": d["len"], "deg": 0}))
    chars = insert_after(chars, "HEAD", dread_layers)
    sc = Scene(scene("tmp", [0, 0, 0], chars))
    bends = simulate_strands(sc, vec["dreads"], scale)
    for L in chars:
        if L["name"] in bends:
            L["bend"]["deg"] = keys(*[K(t, v, "L") for t, v in bends[L["name"]]])
    bg = [226, 238, 247]
    layers = [background(bg), layer("FLOOR", [group("Floor", [rrect_path(-20, 1250, W + 20, H + 20, 0)], fill=[212, 226, 238])])]
    layers.append(floor_shadow(Scene(scene("tmp", [0, 0, 0], chars)), feet))
    layers += chars
    return scene("ASTRO_BRICK_HEADBANG", bg, layers)


SCENES = {"BRICK_BRAIDS_ANNOYED": build_brick, "VARSITY_BEAR_FLY": build_bear, "RED_SUIT_MIC": build_suit, "RED_DREADS_SPRAY": build_spray, "ASTRO_BRICK_HEADBANG": build_headbang}

if __name__ == "__main__":
    names = sys.argv[1:] or list(SCENES)
    os.makedirs(os.path.join(ROOT, "scenes"), exist_ok=True)
    for n in names:
        data = SCENES[n]()
        save(data, os.path.join(ROOT, "scenes", n + ".jsxinc"))
        print(n, "layers", len(data["layers"]), "->", os.path.getsize(os.path.join(ROOT, "scenes", n + ".jsxinc")) // 1024, "KB")
