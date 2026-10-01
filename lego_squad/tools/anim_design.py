"""Generates the ANIMS block of build_lego_squad.jsx (keyframes of the five character animations).

Every animation is a 5 s seamless loop: values at 0 s and 5 s are equal.
Key format: [time, value, [ease in, ease out]] (AE temporal influence, speed 0).
Properties per part: rot (deg), pos (offset from the joint, source px; LEGS = comp px),
scale ([x, y] %), squash (arms only: 100 = hanging, 0 = pointing at the camera, <0 = raised above the shoulder).

Usage: python3 anim_design.py      (rewrites the block between // <ANIMS> and // </ANIMS> in the .jsx)
"""
import json
import math
import os
import re

S = [55, 55]        # smooth
SNAP = [80, 25]     # slow in, quick out
HIT = [25, 80]      # quick in, long settle
D = 5.0


def k(t, v, e=S):
    return [round(t, 3), v, e]


def wiggle(t0, t1, freq, amp, base=0.0, decay=False, start_sign=1):
    """alternating keys around base (shakes, waves)"""
    out, n = [], int(round((t1 - t0) * freq * 2))
    for i in range(1, n):
        a = amp * (1 - i / n) if decay else amp
        out.append(k(t0 + i / (2 * freq), round(base + a * start_sign * (1 if i % 2 else -1), 2), [50, 50]))
    return out


def groove():
    """RED_DREADS: head-nod groove, 96 BPM (8 beats in 5 s), arms pumping alternately"""
    beat = D / 8
    A = {"HEAD": {"rot": [], "pos": []}, "TORSO": {"rot": []}, "LEGS": {"pos": []},
         "ARM_L": {"squash": [], "rot": []}, "ARM_R": {"squash": [], "rot": []}, "HAND_L": {"rot": []}, "HAND_R": {"rot": []}}
    for i in range(9):
        t = i * beat
        side = 1 if i % 2 == 0 else -1
        A["HEAD"]["rot"] += [k(t, 0, HIT), k(t + beat * 0.45, 4 * side, S)] if i < 8 else [k(t, 0, HIT)]
        A["HEAD"]["pos"] += [k(t, [0, 0], HIT), k(t + beat * 0.45, [0, 16], S)] if i < 8 else [k(t, [0, 0], HIT)]
        A["LEGS"]["pos"] += [k(t, [0, 0], HIT), k(t + beat * 0.5, [0, -10], S)] if i < 8 else [k(t, [0, 0], HIT)]
    for i in range(5):  # sway + arm pumps every 2 beats
        t = i * 2 * beat
        side = 1 if i % 2 == 0 else -1
        if i < 4:
            A["TORSO"]["rot"] += [k(t, 0, S), k(t + beat, 3 * side, S)]
            A["ARM_L"]["squash"] += [k(t, 100, S), k(t + beat, 62 if side > 0 else 100, S)]
            A["ARM_R"]["squash"] += [k(t, 100, S), k(t + beat, 100 if side > 0 else 62, S)]
            A["ARM_L"]["rot"] += [k(t, 0, S), k(t + beat, 8 if side > 0 else -4, S)]
            A["ARM_R"]["rot"] += [k(t, 0, S), k(t + beat, 4 if side > 0 else -8, S)]
            A["HAND_L"]["rot"] += [k(t, 0, S), k(t + beat, -10 * side, S)]
            A["HAND_R"]["rot"] += [k(t, 0, S), k(t + beat, -10 * side, S)]
        else:
            for p, pr in (("TORSO", "rot"), ("ARM_L", "squash"), ("ARM_R", "squash"), ("ARM_L", "rot"), ("ARM_R", "rot"),
                          ("HAND_L", "rot"), ("HAND_R", "rot")):
                A[p][pr].append(k(t, 100 if pr == "squash" else 0, S))
    return A


def rage():
    """ANGRY_CHAIN: tense, both fists up, shaking with rage, slam down + stomp, heavy breathing"""
    A = {
        "ARM_L": {"squash": [k(0.55, 100), k(0.75, 112, SNAP), k(1.05, -88, [60, 30]), k(1.2, -78, HIT),
                             k(3.25, -78, SNAP), k(3.55, 100, [20, 70]), k(3.7, 104, HIT), k(3.95, 100), k(D, 100)],
                  "rot": [k(0.55, 0), k(1.05, 14, [60, 30]), k(1.2, 10, HIT), k(3.25, 10), k(3.55, 0, [20, 70]), k(D, 0)]},
        "ARM_R": {"squash": [k(0.6, 100), k(0.8, 112, SNAP), k(1.1, -88, [60, 30]), k(1.25, -78, HIT),
                             k(3.3, -78, SNAP), k(3.58, 100, [20, 70]), k(3.73, 104, HIT), k(3.98, 100), k(D, 100)],
                  "rot": [k(0.6, 0), k(1.1, -14, [60, 30]), k(1.25, -10, HIT), k(3.3, -10), k(3.58, 0, [20, 70]), k(D, 0)]},
        "HAND_L": {"rot": [k(0.8, 0), k(1.15, -150, [60, 30]), k(1.3, -140, HIT)] + wiggle(1.3, 3.2, 7, 9, -140) +
                          [k(3.25, -140), k(3.6, 0, [20, 70]), k(D, 0)]},
        "HAND_R": {"rot": [k(0.85, 0), k(1.2, 150, [60, 30]), k(1.35, 140, HIT)] + wiggle(1.35, 3.25, 7, 9, 140, start_sign=-1) +
                          [k(3.3, 140), k(3.62, 0, [20, 70]), k(D, 0)]},
        "TORSO": {"rot": [k(0.3, 0), k(0.6, -2.5, SNAP), k(1.1, 1.5)] + wiggle(1.2, 3.2, 11, 1.6) +
                         [k(3.3, 0), k(3.6, 2.5, HIT), k(4.1, -1), k(4.6, 0.5), k(D, 0)],
                  "pos": [k(3.45, [0, 0]), k(3.6, [0, 10], HIT), k(4.0, [0, 0]), k(D, [0, 0])]},
        "HEAD": {"rot": [k(0.3, 0), k(0.6, 4, SNAP), k(1.1, -3)] + wiggle(1.2, 3.2, 6.5, 6) +
                        [k(3.3, 0), k(3.62, -6, HIT), k(4.2, 2), k(4.8, 0), k(D, 0)],
                 "pos": [k(0.3, [0, 0]), k(0.6, [0, 8]), k(1.1, [0, -6]), k(1.4, [0, 0]), k(D, [0, 0])]},
        "LEGS": {"pos": [k(3.5, [0, 0]), k(3.6, [0, 7], HIT), k(3.85, [0, 0]), k(D, [0, 0])]},
    }
    return A


def wave():
    """SMILE_VARSITY: raises the right arm next to the head and waves, head tilts, little bounce"""
    waves = wiggle(1.05, 3.55, 2.4, 16, -12)
    A = {
        "ARM_R": {"squash": [k(0.35, 100), k(0.85, -78, [60, 30]), k(1.05, -70, HIT), k(3.55, -70), k(4.1, 100, [70, 40]), k(D, 100)],
                  "rot": [k(0.35, 0), k(0.85, -18, [60, 30]), k(1.05, -12, HIT)] + waves + [k(3.55, -12), k(4.1, 0, [70, 40]), k(D, 0)]},
        "HAND_R": {"rot": [k(0.35, 0), k(0.9, 168, [60, 30]), k(1.1, 160, HIT)] + wiggle(1.1, 3.55, 2.4, 22, 160, start_sign=-1) +
                          [k(3.55, 160), k(4.1, 0, [70, 40]), k(D, 0)],
                   "scale": [k(0.35, [100, 100]), k(0.9, [112, 112]), k(3.55, [112, 112]), k(4.1, [100, 100]), k(D, [100, 100])]},
        "HEAD": {"rot": [k(0.5, 0), k(1.1, 6, HIT), k(2.3, 3), k(3.5, 6), k(4.2, 0), k(D, 0)]},
        "TORSO": {"rot": [k(0.4, 0), k(1.0, 2.5, HIT), k(3.5, 2.5), k(4.2, 0), k(D, 0)]},
        "ARM_L": {"rot": [k(0.5, 0), k(1.2, 4), k(2.4, 0), k(3.6, 4), k(4.4, 0), k(D, 0)]},
        "LEGS": {"pos": [k(0, [0, 0])] + [x for i in range(4) for x in (k(1.2 + i * 0.62, [0, -8]), k(1.51 + i * 0.62, [0, 0]))] +
                        [k(D, [0, 0])]},
    }
    return A


def jump():
    """ASTRO_BRICK: crouch, jump with both arms up, land; a second bigger 'yay' jump"""
    def one(t0, h, A):
        A["LEGS"]["pos"] += [k(t0, [0, 0]), k(t0 + 0.25, [0, 18], SNAP), k(t0 + 0.6, [0, -h], [70, 30]),
                             k(t0 + 0.78, [0, -h * 0.97], [40, 40]), k(t0 + 1.12, [0, 0], [20, 80]), k(t0 + 1.22, [0, 14], HIT),
                             k(t0 + 1.45, [0, 0])]
        for arm, sg in (("ARM_L", 1), ("ARM_R", -1)):
            A[arm]["squash"] += [k(t0, 100), k(t0 + 0.25, 108, SNAP), k(t0 + 0.6, -82, [70, 30]), k(t0 + 0.85, -75),
                                 k(t0 + 1.15, 100, [30, 70]), k(t0 + 1.4, 100)]
            A[arm]["rot"] += [k(t0, 0), k(t0 + 0.25, -8 * sg, SNAP), k(t0 + 0.6, 16 * sg, [70, 30]), k(t0 + 0.85, 12 * sg),
                              k(t0 + 1.15, 0, [30, 70])]
        for hand, sg in (("HAND_L", 1), ("HAND_R", -1)):
            A[hand]["rot"] += [k(t0 + 0.2, 0), k(t0 + 0.65, -160 * sg, [70, 30]), k(t0 + 0.9, -150 * sg), k(t0 + 1.2, 0, [30, 70])]
        A["HEAD"]["rot"] += [k(t0, 0), k(t0 + 0.25, 0, SNAP), k(t0 + 0.6, -5, [70, 30]), k(t0 + 1.12, 0), k(t0 + 1.25, 3, HIT), k(t0 + 1.5, 0)]
        A["HEAD"]["pos"] += [k(t0 + 0.1, [0, 0]), k(t0 + 0.25, [0, 10], SNAP), k(t0 + 0.6, [0, -10], [70, 30]), k(t0 + 1.12, [0, 0]),
                             k(t0 + 1.25, [0, 12], HIT), k(t0 + 1.5, [0, 0])]
    A = {p: {} for p in ("LEGS", "ARM_L", "ARM_R", "HAND_L", "HAND_R", "HEAD")}
    for p in ("ARM_L", "ARM_R"):
        A[p] = {"squash": [], "rot": []}
    for p in ("HAND_L", "HAND_R"):
        A[p] = {"rot": []}
    A["HEAD"] = {"rot": [], "pos": []}
    A["LEGS"] = {"pos": []}
    one(0.35, 170, A)
    one(2.35, 260, A)
    for p, props in A.items():
        for pr in props:
            last = A[p][pr][-1]
            A[p][pr].append(k(D, last[1]))
    A["TORSO"] = {"rot": [k(0, 0), k(2.6, 0), k(3.0, -3), k(3.5, 0), k(D, 0)]}
    return A


def point():
    """RED_SUIT: nods, points straight at the camera (arm foreshortened, hand closer), pumps to the beat"""
    pumps = []
    for i in range(5):
        t = 1.25 + i * 0.42
        pumps += [k(t, 18), k(t + 0.21, 30)]
    hand_pumps = []
    for i in range(5):
        t = 1.25 + i * 0.42
        hand_pumps += [k(t, [138, 138]), k(t + 0.21, [128, 128])]
    A = {
        "ARM_L": {"squash": [k(0.6, 100), k(0.8, 106, SNAP), k(1.1, 12, [60, 30])] + pumps +
                            [k(3.55, 30), k(4.1, 100, [70, 40]), k(D, 100)],
                  "rot": [k(0.6, 0), k(0.8, 6, SNAP), k(1.1, -14, [60, 30]), k(1.25, -10, HIT), k(3.55, -10), k(4.1, 0, [70, 40]), k(D, 0)]},
        "HAND_L": {"rot": [k(0.75, 0), k(1.15, -62, [60, 30]), k(1.3, -55, HIT), k(3.55, -55), k(4.1, 0, [70, 40]), k(D, 0)],
                   "scale": [k(0.75, [100, 100]), k(1.15, [145, 145], [60, 30])] + hand_pumps + [k(3.55, [128, 128]), k(4.1, [100, 100], [70, 40]), k(D, [100, 100])]},
        "HEAD": {"rot": [k(0, 0), k(0.25, -3), k(0.5, 0), k(1.1, 5, HIT)] +
                        [x for i in range(5) for x in (k(1.25 + i * 0.42, 5), k(1.46 + i * 0.42, 2))] + [k(3.6, 5), k(4.3, 0), k(D, 0)],
                 "pos": [k(0, [0, 0]), k(0.25, [0, 10]), k(0.5, [0, 0])] +
                        [x for i in range(5) for x in (k(1.25 + i * 0.42, [0, 0]), k(1.46 + i * 0.42, [0, 9]))] + [k(3.6, [0, 0]), k(D, [0, 0])]},
        "TORSO": {"rot": [k(0.6, 0), k(1.15, -3, HIT), k(3.55, -3), k(4.2, 0), k(D, 0)]},
        "ARM_R": {"rot": [k(0.7, 0), k(1.2, 7, HIT), k(3.6, 7), k(4.3, 0), k(D, 0)]},
        "HAND_R": {"rot": [k(0.8, 0), k(1.3, -12), k(3.6, -12), k(4.3, 0), k(D, 0)]},
    }
    return A


ANIMS = {"groove": groove(), "rage": rage(), "wave": wave(), "jump": jump(), "point": point()}


def check(A):
    for name, parts in A.items():
        for p, props in parts.items():
            for pr, keys in props.items():
                ts = [x[0] for x in keys]
                assert ts == sorted(ts) and len(set(ts)) == len(ts), (name, p, pr, ts)
                assert keys[0][1] == keys[-1][1] or keys[-1][0] < D, (name, p, pr, "loop mismatch")
                first_v = keys[0][1]
                if keys[-1][0] >= D - 1e-6:
                    assert first_v == keys[-1][1], (name, p, pr, "start != end", first_v, keys[-1][1])


if __name__ == "__main__":
    check(ANIMS)
    jsx = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "build_lego_squad.jsx")
    src = open(jsx, encoding="utf-8-sig").read()
    body = "    var ANIMS = " + json.dumps(ANIMS, separators=(", ", ": ")) + ";\n"
    src = re.sub(r"(    // <ANIMS>\n).*?(    // </ANIMS>)", lambda m: m.group(1) + body + m.group(2), src, flags=re.S)
    open(jsx, "w", encoding="utf-8-sig").write(src)
    print("ANIMS written:", {k_: sum(len(v) for p in a.values() for v in p.values()) for k_, a in ANIMS.items()}, "keys")
