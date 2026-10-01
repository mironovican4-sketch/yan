"""Generates the ANIMS block of build_lego_squad.jsx (keyframes of the five character animations).

Every animation is a 5 s seamless loop: values at 0 s and 5 s are equal.
Key format: [time, value, [ease in, ease out]] (AE temporal influence, speed 0).
Properties per part: rot (deg), pos (offset from the joint, source px; LEGS = comp px), scale ([x, y] %).
Arms only rotate in the picture plane about the round shoulder joint, like a minifigure seen from the front:
ARM_L (screen left) goes up/out with positive angles, ARM_R with negative ones. The hands ride on the arms.
Raised arms stay below ~135 deg so they never cover the face.

Usage: python3 anim_design.py      (rewrites the block between // <ANIMS> and // </ANIMS> in the .jsx)
"""
import json
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
    """RED_DREADS: head-nod groove, 96 BPM (8 beats in 5 s), body bounce, arms swing side to side"""
    beat = D / 8
    A = {"HEAD": {"rot": [], "pos": []}, "TORSO": {"rot": []}, "LEGS": {"pos": []}, "ARM_L": {"rot": []}, "ARM_R": {"rot": []}}
    for i in range(9):
        t = i * beat
        side = 1 if i % 2 == 0 else -1
        if i == 8:
            A["HEAD"]["rot"].append(k(t, 0, HIT)); A["HEAD"]["pos"].append(k(t, [0, 0], HIT))
            A["LEGS"]["pos"].append(k(t, [0, 0], HIT))
            continue
        A["HEAD"]["rot"] += [k(t, 0, HIT), k(t + beat * 0.5, 4 * side, S)]
        A["HEAD"]["pos"] += [k(t, [0, 0], HIT), k(t + beat * 0.5, [0, 14], S)]
        A["LEGS"]["pos"] += [k(t, [0, 0], HIT), k(t + beat * 0.5, [0, -12], S)]
    for i in range(5):  # sway + arm swing every 2 beats
        t = i * 2 * beat
        side = 1 if i % 2 == 0 else -1
        if i < 4:
            A["TORSO"]["rot"] += [k(t, 0), k(t + beat, 3 * side)]
            A["ARM_L"]["rot"] += [k(t, 0), k(t + beat, 24 if side > 0 else -5)]
            A["ARM_R"]["rot"] += [k(t, 0), k(t + beat, 5 if side > 0 else -24)]
        else:
            for p in ("TORSO", "ARM_L", "ARM_R"):
                A[p]["rot"].append(k(t, 0))
    return A


def rage():
    """ANGRY_CHAIN: winds up, throws both fists up, shakes with rage, slams them down and stomps, breathes hard"""
    shake_l = wiggle(1.15, 3.1, 5, 4, 122)
    A = {
        "ARM_L": {"rot": [k(0, 0), k(0.5, 0), k(0.75, -7, SNAP), k(1.05, 130, [60, 30]), k(1.15, 122, HIT)] + shake_l +
                         [k(3.15, 122, SNAP), k(3.4, -9, [20, 70]), k(3.6, 2, HIT), k(3.85, 0), k(D, 0)]},
        "ARM_R": {"rot": [k(0, 0), k(0.55, 0), k(0.8, 7, SNAP), k(1.1, -130, [60, 30]), k(1.2, -122, HIT)] +
                         wiggle(1.2, 3.1, 5, 4, -122, start_sign=-1) +
                         [k(3.15, -122, SNAP), k(3.42, 9, [20, 70]), k(3.62, -2, HIT), k(3.87, 0), k(D, 0)]},
        "TORSO": {"rot": [k(0, 0), k(0.5, 0), k(0.75, -2.5, SNAP), k(1.1, 1.5)] + wiggle(1.2, 3.1, 6, 1.2) +
                         [k(3.15, 0), k(3.45, 2.5, HIT), k(4.0, -1), k(4.5, 0.4), k(D, 0)],
                  "pos": [k(0, [0, 0]), k(3.35, [0, 0]), k(3.48, [0, 8], HIT), k(3.9, [0, 0]), k(D, [0, 0])]},
        "HEAD": {"rot": [k(0, 0), k(0.5, 0), k(0.75, 4, SNAP), k(1.1, -3)] + wiggle(1.2, 3.1, 4, 5) +
                        [k(3.15, 0), k(3.48, -6, HIT), k(4.1, 2), k(4.7, 0), k(D, 0)],
                 "pos": [k(0, [0, 0]), k(0.5, [0, 0]), k(0.75, [0, 8]), k(1.1, [0, -6]), k(1.4, [0, 0]),
                         k(3.4, [0, 0]), k(3.52, [0, 10], HIT), k(3.9, [0, 0]), k(D, [0, 0])]},
        "LEGS": {"pos": [k(0, [0, 0]), k(3.36, [0, 0]), k(3.46, [0, -14], [60, 40]), k(3.56, [0, 0], [30, 70]), k(D, [0, 0])]},
    }
    return A


def wave():
    """SMILE_VARSITY: raises the right arm high to the side and waves, head tilts to it, little bounce"""
    A = {
        "ARM_R": {"rot": [k(0, 0), k(0.35, 0), k(0.55, 6, SNAP), k(0.95, -138, [60, 30]), k(1.1, -128, HIT)] +
                         wiggle(1.1, 3.55, 2.4, 14, -128) + [k(3.55, -128), k(4.15, 0, [70, 40]), k(D, 0)]},
        "ARM_L": {"rot": [k(0, 0), k(0.6, 0), k(1.1, 6), k(2.3, 2), k(3.5, 6), k(4.3, 0), k(D, 0)]},
        "HEAD": {"rot": [k(0, 0), k(0.5, 0), k(1.1, 6, HIT), k(2.3, 3), k(3.5, 6), k(4.2, 0), k(D, 0)]},
        "TORSO": {"rot": [k(0, 0), k(0.4, 0), k(1.0, 2.5, HIT), k(3.5, 2.5), k(4.2, 0), k(D, 0)]},
        "LEGS": {"pos": [k(0, [0, 0])] + [x for i in range(4) for x in (k(1.2 + i * 0.62, [0, -9]), k(1.51 + i * 0.62, [0, 0]))] +
                        [k(D, [0, 0])]},
    }
    return A


def jump():
    """ASTRO_BRICK: arms swing back, jump with both arms up, land with a dip; a second, higher 'yay' jump"""
    A = {"LEGS": {"pos": [], "rot": []}, "TORSO": {"pos": []}, "ARM_L": {"rot": []}, "ARM_R": {"rot": []}, "HEAD": {"rot": [], "pos": []}}

    def one(t0, h, up, tilt):
        A["LEGS"]["pos"] += [k(t0, [0, 0]), k(t0 + 0.28, [0, 0], SNAP), k(t0 + 0.62, [0, -h], [70, 30]),
                             k(t0 + 0.8, [0, -h * 0.97], [40, 40]), k(t0 + 1.12, [0, 0], [20, 80])]
        A["LEGS"]["rot"] += [k(t0 + 0.28, 0), k(t0 + 0.7, tilt), k(t0 + 1.05, 0)]
        A["TORSO"]["pos"] += [k(t0, [0, 0]), k(t0 + 0.25, [0, 7], SNAP), k(t0 + 0.4, [0, 0]),
                              k(t0 + 1.1, [0, 0]), k(t0 + 1.2, [0, 9], HIT), k(t0 + 1.45, [0, 0])]
        for arm, sg in (("ARM_L", 1), ("ARM_R", -1)):
            A[arm]["rot"] += [k(t0, 0), k(t0 + 0.28, -10 * sg, SNAP), k(t0 + 0.62, (up + 8) * sg, [70, 30]),
                              k(t0 + 0.85, up * sg), k(t0 + 1.15, 0, [30, 70]), k(t0 + 1.3, 4 * sg, HIT), k(t0 + 1.5, 0)]
        A["HEAD"]["rot"] += [k(t0, 0), k(t0 + 0.28, 0, SNAP), k(t0 + 0.62, -4, [70, 30]), k(t0 + 1.12, 0),
                             k(t0 + 1.25, 3, HIT), k(t0 + 1.5, 0)]
        A["HEAD"]["pos"] += [k(t0, [0, 0]), k(t0 + 0.28, [0, 8], SNAP), k(t0 + 0.62, [0, -8], [70, 30]), k(t0 + 1.12, [0, 0]),
                             k(t0 + 1.25, [0, 10], HIT), k(t0 + 1.5, [0, 0])]
    one(0.3, 170, 110, 0)
    one(2.3, 270, 128, -6)
    for p, props in A.items():
        for pr in props:
            if A[p][pr][0][0] > 0:
                A[p][pr].insert(0, k(0, A[p][pr][0][1]))
            A[p][pr].append(k(D, A[p][pr][0][1]))
    return A


def point():
    """RED_SUIT: nods, points far to the side and pumps to the beat, then raises the roof, back down"""
    beat = 0.42
    A = {
        "ARM_L": {"rot": [k(0, 0), k(0.55, 0), k(0.75, -6, SNAP), k(1.05, 92, [60, 30]), k(1.18, 84, HIT)] +
                         [x for i in range(4) for x in (k(1.3 + i * beat, 90), k(1.3 + i * beat + beat / 2, 80))] +
                         [k(2.98, 84), k(3.25, 128, [60, 30])] +
                         [x for i in range(2) for x in (k(3.42 + i * beat, 118), k(3.42 + i * beat + beat / 2, 128))] +
                         [k(4.35, 0, [60, 40]), k(4.5, -4, HIT), k(4.7, 0), k(D, 0)]},
        "ARM_R": {"rot": [k(0, 0), k(0.7, 0), k(1.2, -8, HIT), k(2.98, -8), k(3.25, -128, [60, 30])] +
                         [x for i in range(2) for x in (k(3.42 + i * beat, -118), k(3.42 + i * beat + beat / 2, -128))] +
                         [k(4.38, 0, [60, 40]), k(4.53, 4, HIT), k(4.73, 0), k(D, 0)]},
        "HEAD": {"rot": [k(0, 0), k(0.25, -3), k(0.5, 0), k(1.1, -5, HIT)] +
                        [x for i in range(4) for x in (k(1.3 + i * beat, -5), k(1.3 + i * beat + beat / 2, -2))] +
                        [k(2.98, -5), k(3.25, 0)] + [x for i in range(2) for x in (k(3.42 + i * beat, 0), k(3.42 + i * beat + beat / 2, 0.5))] +
                        [k(4.4, 0), k(D, 0)],
                 "pos": [k(0, [0, 0]), k(0.25, [0, 10]), k(0.5, [0, 0])] +
                        [x for i in range(6) for x in (k(1.3 + i * beat, [0, 0]), k(1.3 + i * beat + beat / 2, [0, 9]))] +
                        [k(3.86, [0, 0]), k(D, [0, 0])]},
        "TORSO": {"rot": [k(0, 0), k(0.6, 0), k(1.15, -3, HIT), k(2.98, -3), k(3.3, 0), k(D, 0)]},
        "LEGS": {"pos": [k(0, [0, 0]), k(3.25, [0, 0])] + [x for i in range(2) for x in (k(3.42 + i * beat, [0, -10]), k(3.42 + i * beat + beat / 2, [0, 0]))] +
                        [k(D, [0, 0])]},
    }
    return A


def shrug():
    """BRICK_BRAIDS: two slow cool nods, a big 'whatever' shrug with a head tilt, drops it, leans back"""
    A = {
        "HEAD": {"rot": [k(0, 0), k(0.4, -2), k(0.8, 0), k(1.2, -2), k(1.6, 0), k(1.8, 0), k(2.15, 9, HIT), k(2.95, 7),
                         k(3.3, -2, HIT), k(3.6, 0), k(4.1, -5), k(4.8, 0), k(D, 0)],
                 "pos": [k(0, [0, 0]), k(0.4, [0, 12]), k(0.8, [0, 0]), k(1.2, [0, 12]), k(1.6, [0, 0]), k(1.8, [0, 0]),
                         k(2.12, [0, -12], [60, 30]), k(2.3, [0, -8], HIT), k(2.95, [0, -9]), k(3.25, [0, 4], [20, 70]),
                         k(3.5, [0, 0]), k(4.1, [0, 10]), k(4.5, [0, 0]), k(D, [0, 0])]},
        "ARM_L": {"rot": [k(0, 0), k(1.75, 0), k(1.9, -4, SNAP), k(2.12, 38, [60, 30]), k(2.3, 32, HIT), k(2.95, 30),
                          k(3.2, -5, [20, 70]), k(3.4, 1.5, HIT), k(3.6, 0), k(D, 0)]},
        "ARM_R": {"rot": [k(0, 0), k(1.78, 0), k(1.93, 4, SNAP), k(2.15, -38, [60, 30]), k(2.33, -32, HIT), k(2.95, -30),
                          k(3.22, 5, [20, 70]), k(3.42, -1.5, HIT), k(3.62, 0), k(D, 0)]},
        "TORSO": {"rot": [k(0, 0), k(0.8, 1), k(1.6, 0), k(2.15, -1.5, HIT), k(2.95, -1), k(3.3, 0.5), k(3.6, 0), k(4.1, -2.5),
                          k(4.8, 0), k(D, 0)],
                  "pos": [k(0, [0, 0]), k(3.15, [0, 0]), k(3.3, [0, 6], HIT), k(3.6, [0, 0]), k(D, [0, 0])]},
    }
    return A


def disco():
    """VARSITY_BEAR: disco pointing - one arm up on the diagonal, the other down, switching on the beat"""
    beat = D / 8
    up, down = 138, 8
    A = {"ARM_L": {"rot": [k(0, 0), k(0.35, 0)]}, "ARM_R": {"rot": [k(0, 0), k(0.35, 0)]},
         "HEAD": {"rot": [k(0, 0), k(0.35, 0)]}, "TORSO": {"rot": [k(0, 0), k(0.35, 0)]}, "LEGS": {"pos": [], "rot": []}}
    for n, t in enumerate((beat, 3 * beat, 5 * beat)):   # poses A, B, A; each held two beats with a pump
        a = 1 if n % 2 == 0 else -1
        lv, rv = (up, -down) if a > 0 else (down, -up)
        A["ARM_L"]["rot"] += [k(t, lv, [60, 25]), k(t + beat, lv - 10 * (a > 0), S), k(t + 1.6 * beat, lv, S)]
        A["ARM_R"]["rot"] += [k(t, rv, [60, 25]), k(t + beat, rv + 10 * (a < 0), S), k(t + 1.6 * beat, rv, S)]
        A["HEAD"]["rot"] += [k(t, -8 * a, HIT), k(t + 1.6 * beat, -6 * a)]
        A["TORSO"]["rot"] += [k(t, -3 * a, HIT), k(t + 1.6 * beat, -2 * a)]
    t_end = 7 * beat
    for p, v in (("ARM_L", 0), ("ARM_R", 0), ("HEAD", 0), ("TORSO", 0)):
        A[p]["rot"] += [k(t_end, v, [60, 40]), k(D, v)]
    for i in range(9):   # bounce + hip sway on every beat
        t = i * beat
        if i == 8:
            A["LEGS"]["pos"].append(k(t, [0, 0], HIT)); A["LEGS"]["rot"].append(k(t, 0))
            continue
        A["LEGS"]["pos"] += [k(t, [0, 0], HIT), k(t + beat / 2, [0, -10])]
        A["LEGS"]["rot"].append(k(t, 0 if i in (0, 7) else (2.5 if i % 2 else -2.5)))
    return A


ANIMS = {"groove": groove(), "rage": rage(), "wave": wave(), "jump": jump(), "point": point(), "shrug": shrug(), "disco": disco()}


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
