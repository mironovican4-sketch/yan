"""Scene kit: one data model for the LEGO scenes, shared by the After Effects builder and the preview.

A scene is plain JSON (written to scenes/<NAME>.jsxinc). build_lego_scenes.jsx turns it into a comp,
render.py draws the same data with the same maths, so the preview matches the comp.

scene = {name, width, height, fps, duration, bg:[r,g,b], layers:[...bottom -> top]}
layer = {name, parent|None, anchor:[x,y], pos:V, rot:V, scale:V([x,y] %), opacity:V,
         groups:[...top -> bottom], blur: float|None, bend: {root:[x,y], len:L, deg:V}|None,
         squash: {py: y, s: V}|None}      bend / squash deform the paths (AE: slider + path expression)
group = {name, paths:[P], fill:[r,g,b]|None, fillOpacity, stroke:{color,width,opacity}|None,
         trim:{start:V, end:V}|None, pathKeys:[[t, [P...]], ...]|None, opacity:V}
P     = {v:[[x,y]..], i:[..], o:[..], c: closed}
V     = a static value or {"k": [[t, value, ease], ...]}, ease = [in, out] influence (speed 0),
        "L" (linear) or "H" (hold until the next key). Spatial paths are straight lines.
"""
import json
import math

import cv2
import numpy as np

# ------------------------------------------------------------------ keys


def K(t, v, e=(55, 55)):
    return [round(float(t), 4), v, e if isinstance(e, str) else [float(e[0]), float(e[1])]]


def keys(*ks):
    return {"k": sorted(ks, key=lambda x: x[0])}


def sampled(f, t0, t1, step=1 / 30):
    """dense linear keys of f(t) (for motion that is computed, e.g. a pen tracing a path)"""
    n = max(1, int(round((t1 - t0) / step)))
    return [K(t0 + (t1 - t0) * j / n, f(t0 + (t1 - t0) * j / n), "L") for j in range(n + 1)]


def _bez(u, x1, y1, x2, y2):
    lo, hi = 0.0, 1.0
    for _ in range(40):
        s = (lo + hi) / 2
        x = 3 * (1 - s) ** 2 * s * x1 + 3 * (1 - s) * s * s * x2 + s ** 3
        lo, hi = (s, hi) if x < u else (lo, s)
    s = (lo + hi) / 2
    return 3 * (1 - s) ** 2 * s * y1 + 3 * (1 - s) * s * s * y2 + s ** 3


def progress(a, b, t):
    """AE temporal interpolation between keys a and b (speed-0 ease, linear or hold)"""
    u = (t - a[0]) / (b[0] - a[0])
    ea, eb = a[2], b[2]
    if ea == "H":
        return 0.0
    if ea == "L" and eb in ("L", "H"):
        return u
    oa = 100 / 6 if ea == "L" else ea[1]
    ib = 100 / 6 if eb in ("L", "H") else eb[0]
    return _bez(u, oa / 100, 0, 1 - ib / 100, 1)


def lerp(a, b, p):
    if isinstance(a, dict):   # path
        return {"v": (np.array(a["v"]) + (np.array(b["v"]) - np.array(a["v"])) * p).tolist(),
                "i": (np.array(a["i"]) + (np.array(b["i"]) - np.array(a["i"])) * p).tolist(),
                "o": (np.array(a["o"]) + (np.array(b["o"]) - np.array(a["o"])) * p).tolist(), "c": a["c"]}
    if isinstance(a, list):
        return [x + (y - x) * p for x, y in zip(a, b)]
    return a + (b - a) * p


def value(V, t):
    if not (isinstance(V, dict) and "k" in V):
        return V
    ks = V["k"]
    if t <= ks[0][0]:
        return ks[0][1]
    if t >= ks[-1][0]:
        return ks[-1][1]
    for a, b in zip(ks, ks[1:]):
        if a[0] <= t <= b[0]:
            return lerp(a[1], b[1], progress(a, b, t))


def check_keys(V, where):
    if isinstance(V, dict) and "k" in V:
        ts = [k[0] for k in V["k"]]
        assert ts == sorted(ts) and len(set(ts)) == len(ts), (where, ts)


# ------------------------------------------------------------------ paths


def path_from_beziers(pts, ins, outs, closed):
    r = lambda a: [[round(float(x), 2), round(float(y), 2)] for x, y in a]
    return {"v": r(pts), "i": r(ins), "o": r(outs), "c": bool(closed)}


def smooth_path(points, closed=False, tension=1.0):
    """Catmull-Rom through points -> bezier path"""
    P = np.array(points, float)
    n = len(P)
    ins, outs = np.zeros_like(P), np.zeros_like(P)
    for k in range(n):
        if closed:
            a, b = P[(k - 1) % n], P[(k + 1) % n]
        else:
            a, b = P[max(k - 1, 0)], P[min(k + 1, n - 1)]
        tng = (b - a) / 6 * tension
        if not closed and k in (0, n - 1):
            tng = tng * 0.5
        ins[k], outs[k] = -tng, tng
    if not closed:
        ins[0], outs[-1] = 0, 0
    return path_from_beziers(P, ins, outs, closed)


def poly_path(points, closed=True):
    P = np.array(points, float)
    return path_from_beziers(P, np.zeros_like(P), np.zeros_like(P), closed)


def ellipse_path(cx, cy, rx, ry):
    k = 0.5523
    P = [[cx, cy - ry], [cx + rx, cy], [cx, cy + ry], [cx - rx, cy]]
    I = [[-rx * k, 0], [0, -ry * k], [rx * k, 0], [0, ry * k]]
    O = [[rx * k, 0], [0, ry * k], [-rx * k, 0], [0, -ry * k]]
    return path_from_beziers(P, I, O, True)


def rrect_path(x0, y0, x1, y1, r):
    r = min(r, (x1 - x0) / 2, (y1 - y0) / 2)
    k = 0.5523 * r
    P = [[x0 + r, y0], [x1 - r, y0], [x1, y0 + r], [x1, y1 - r], [x1 - r, y1], [x0 + r, y1], [x0, y1 - r], [x0, y0 + r]]
    I = [[-k, 0], [0, 0], [0, -k], [0, 0], [k, 0], [0, 0], [0, k], [0, 0]]
    O = [[0, 0], [k, 0], [0, 0], [0, k], [0, 0], [-k, 0], [0, 0], [0, -k]]
    return path_from_beziers(P, I, O, True)


def xform_path(p, M):
    v = np.array(p["v"], float) @ M[:2, :2].T + M[:2, 2]
    return path_from_beziers(v, np.array(p["i"], float) @ M[:2, :2].T, np.array(p["o"], float) @ M[:2, :2].T, p["c"])


def flatten(p, n=14):
    v, I, O = np.array(p["v"], float), np.array(p["i"], float), np.array(p["o"], float)
    m = len(v)
    pts = []
    segs = m if p["c"] else m - 1
    for k in range(segs):
        p0, p3 = v[k], v[(k + 1) % m]
        c1, c2 = p0 + O[k], p3 + I[(k + 1) % m]
        ts = [0.0] if (not O[k].any() and not I[(k + 1) % m].any()) else np.linspace(0, 1, n, endpoint=False)
        for t in ts:
            pts.append((1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * c1 + 3 * (1 - t) * t * t * c2 + t ** 3 * p3)
    if not p["c"]:
        pts.append(v[-1])
    return np.array(pts) if pts else np.zeros((0, 2))


def trim_poly(pts, s, e, closed):
    """AE trim paths on one path: keep [s, e] percent of its length"""
    if closed:
        pts = np.vstack([pts, pts[:1]])
    if len(pts) < 2 or e - s <= 1e-6:
        return None
    seg = np.linalg.norm(np.diff(pts, axis=0), axis=1)
    cum = np.concatenate([[0], np.cumsum(seg)])
    L = cum[-1]
    a, b = L * s / 100, L * e / 100

    def at(d):
        j = int(np.clip(np.searchsorted(cum, d) - 1, 0, len(seg) - 1))
        u = 0 if seg[j] == 0 else (d - cum[j]) / seg[j]
        return pts[j] + (pts[j + 1] - pts[j]) * u
    inner = pts[(cum > a) & (cum < b)]
    return np.vstack([at(a), inner, at(b)])


def point_on(p, frac):
    pts = flatten(p, 24)
    seg = np.linalg.norm(np.diff(pts, axis=0), axis=1)
    cum = np.concatenate([[0], np.cumsum(seg)])
    d = cum[-1] * frac
    j = int(np.clip(np.searchsorted(cum, d) - 1, 0, len(seg) - 1))
    u = 0 if seg[j] == 0 else (d - cum[j]) / seg[j]
    return pts[j] + (pts[j + 1] - pts[j]) * u


def squash_path(p, py, s):
    """arm raised towards the camera: the outline shortens along its length about the shoulder (s < 0: above it)"""
    return {"v": [[x, py + (y - py) * s] for x, y in p["v"]], "i": [[x, y * s] for x, y in p["i"]],
            "o": [[x, y * s] for x, y in p["o"]], "c": p["c"]}


SQUASH_EXPR = "\n".join([
    "var s = effect(\"Squash\")(1) / 100, py = %(py)s;",
    "var p = thisProperty.points(), it = thisProperty.inTangents(), ot = thisProperty.outTangents();",
    "for (var i = 0; i < p.length; i++) {",
    "  p[i] = [p[i][0], py + (p[i][1] - py) * s];",
    "  it[i] = [it[i][0], it[i][1] * s];",
    "  ot[i] = [ot[i][0], ot[i][1] * s];",
    "}",
    "createPath(p, it, ot, thisProperty.isClosed())"])


def bend_path(p, root, L, deg):
    """same maths as the AE path expression: every point turns about the root by deg * (d / L)^2"""
    rx, ry = root
    b = math.radians(deg)
    v, I, O = [], [], []
    for (x, y), (ix, iy), (ox, oy) in zip(p["v"], p["i"], p["o"]):
        d = max(0.0, min(1.3, (y - ry) / L))
        a = b * d * d
        c, s = math.cos(a), math.sin(a)
        dx, dy = x - rx, y - ry
        v.append([rx + c * dx - s * dy, ry + s * dx + c * dy])
        I.append([c * ix - s * iy, s * ix + c * iy])
        O.append([c * ox - s * oy, s * ox + c * oy])
    return {"v": v, "i": I, "o": O, "c": p["c"]}


BEND_EXPR = "\n".join([
    "var b = effect(\"Bend\")(1) * Math.PI / 180, rx = %(rx)s, ry = %(ry)s, L = %(L)s;",
    "var p = thisProperty.points(), it = thisProperty.inTangents(), ot = thisProperty.outTangents();",
    "for (var i = 0; i < p.length; i++) {",
    "  var d = Math.max(0, Math.min(1.3, (p[i][1] - ry) / L)), a = b * d * d, c = Math.cos(a), s = Math.sin(a);",
    "  var dx = p[i][0] - rx, dy = p[i][1] - ry;",
    "  p[i] = [rx + c * dx - s * dy, ry + s * dx + c * dy];",
    "  it[i] = [c * it[i][0] - s * it[i][1], s * it[i][0] + c * it[i][1]];",
    "  ot[i] = [c * ot[i][0] - s * ot[i][1], s * ot[i][0] + c * ot[i][1]];",
    "}",
    "createPath(p, it, ot, thisProperty.isClosed())"])

# ------------------------------------------------------------------ layers


def layer(name, groups, parent=None, anchor=(0, 0), pos=(0, 0), rot=0, scale=(100, 100), opacity=100, blur=None, bend=None, squash=None):
    return {"name": name, "parent": parent, "anchor": list(anchor), "pos": pos if isinstance(pos, dict) else list(pos),
            "rot": rot, "scale": scale if isinstance(scale, dict) else list(scale), "opacity": opacity,
            "groups": groups, "blur": blur, "bend": bend, "squash": squash}


def group(name, paths, fill=None, stroke=None, width=9, fillOpacity=100, strokeOpacity=100, trim=None, pathKeys=None, opacity=100):
    return {"name": name, "paths": paths, "fill": None if fill is None else [int(c) for c in fill], "fillOpacity": fillOpacity,
            "stroke": None if stroke is None else {"color": [int(c) for c in stroke], "width": width, "opacity": strokeOpacity},
            "trim": trim, "pathKeys": pathKeys, "opacity": opacity}


def affine(pos, rot, scale, anchor):
    r = math.radians(rot)
    c, s = math.cos(r), math.sin(r)
    M = np.array([[c * scale[0], -s * scale[1], 0], [s * scale[0], c * scale[1], 0], [0, 0, 1.0]])
    M[0, 2] = pos[0] - (M[0, 0] * anchor[0] + M[0, 1] * anchor[1])
    M[1, 2] = pos[1] - (M[1, 0] * anchor[0] + M[1, 1] * anchor[1])
    return M


class Scene:
    def __init__(self, data):
        self.d = data
        self.by = {L["name"]: L for L in data["layers"]}

    def local(self, L, t):
        sc = value(L["scale"], t)
        return affine(value(L["pos"], t), value(L["rot"], t), [sc[0] / 100, sc[1] / 100], L["anchor"])

    def world(self, name, t):
        L = self.by[name]
        M = self.local(L, t)
        return self.world(L["parent"], t) @ M if L["parent"] else M

    def to_comp(self, name, pt, t):
        return (self.world(name, t) @ np.array([pt[0], pt[1], 1.0]))[:2]

    def world_rot(self, name, t):
        r, L = 0.0, self.by[name]
        while L:
            r += value(L["rot"], t)
            L = self.by[L["parent"]] if L["parent"] else None
        return r

    def check(self):
        names = [L["name"] for L in self.d["layers"]]
        assert len(set(names)) == len(names), "duplicate layer names"
        for L in self.d["layers"]:
            assert L["parent"] is None or L["parent"] in self.by, (L["name"], L["parent"])
            for k in ("pos", "rot", "scale", "opacity"):
                check_keys(L[k], L["name"] + "." + k)
            for g in L["groups"]:
                check_keys(g["opacity"], L["name"] + "/" + g["name"])
                if g["trim"]:
                    check_keys(g["trim"]["start"], g["name"]); check_keys(g["trim"]["end"], g["name"])
            if L["bend"]:
                check_keys(L["bend"]["deg"], L["name"] + ".bend")
            if L.get("squash"):
                check_keys(L["squash"]["s"], L["name"] + ".squash")
                assert not L["bend"], "bend and squash on one layer"


def save(data, path):
    Scene(data).check()
    with open(path, "w") as f:
        f.write("// generated by tools/scenes.py - LEGO scene " + data["name"] + "\n(" + json.dumps(data, separators=(",", ":")) + ")\n")


def load(path):
    t = open(path).read().split("\n", 1)[1].strip()
    return json.loads(t[1:-1])


# ------------------------------------------------------------------ preview renderer

SS = 3


def raster_groups(groups, t, bend=None, squash=None):
    """premultiplied RGBA sprite of a layer's contents in layer space + offset"""
    items = []
    for g in reversed(groups):   # bottom first
        go = value(g["opacity"], t) / 100
        paths = g["paths"]
        if g.get("pathKeys"):
            paths = _pathkeys(g["pathKeys"], t)
        if bend:
            paths = [bend_path(p, bend["root"], bend["len"], value(bend["deg"], t)) for p in paths]
        if squash:
            paths = [squash_path(p, squash["py"], value(squash["s"], t) / 100) for p in paths]
        polys = [(flatten(p), p["c"]) for p in paths]
        if g.get("trim"):
            s, e = value(g["trim"]["start"], t), value(g["trim"]["end"], t)
            polys = [(trim_poly(q, s, e, c), False) for q, c in polys]
            polys = [(q, c) for q, c in polys if q is not None]
        items.append((g, polys, go))
    allp = [q for _, ps, _ in items for q, _ in ps if len(q)]
    if not allp:
        return None, None
    allp = np.concatenate(allp)
    pad = max([g["stroke"]["width"] for g, _, _ in items if g["stroke"]] + [0]) + 3
    x0, y0 = np.floor(allp.min(0) - pad).astype(int)
    x1, y1 = np.ceil(allp.max(0) + pad).astype(int)
    w, h = max(1, x1 - x0), max(1, y1 - y0)
    shape = (h * SS, w * SS)
    off = np.array([x0, y0], float)
    q = lambda pts: np.round((pts - off) * SS * 16).astype(np.int32)
    col = np.zeros(shape + (3,), np.float32)
    al = np.zeros(shape, np.float32)

    def comp(mask, c, a):
        nonlocal col, al
        m = mask * a
        col = col * (1 - m[..., None]) + (np.array(c, np.float32) / 255) * m[..., None]
        al = al * (1 - m) + m

    for g, polys, go in items:
        if g["fill"] is not None:
            acc = np.zeros(shape, np.int16)
            for pts, _ in polys:
                if len(pts) < 3:
                    continue
                area = 0.5 * np.sum(pts[:, 0] * np.roll(pts[:, 1], -1) - np.roll(pts[:, 0], -1) * pts[:, 1])
                m = np.zeros(shape, np.uint8)
                cv2.fillPoly(m, [q(pts)], 1, lineType=cv2.LINE_8, shift=4)
                acc += np.int16(np.sign(area) or 1) * m
            comp((acc != 0).astype(np.float32), g["fill"], go * g["fillOpacity"] / 100)
        if g["stroke"] is not None:
            m = np.zeros(shape, np.uint8)
            for pts, closed in polys:
                if len(pts) >= 2:
                    cv2.polylines(m, [q(pts)], closed, 1, thickness=max(1, int(round(g["stroke"]["width"] * SS))), lineType=cv2.LINE_8, shift=4)
            comp(m.astype(np.float32), g["stroke"]["color"], go * g["stroke"]["opacity"] / 100)
    small = lambda x: cv2.resize(x, (w, h), interpolation=cv2.INTER_AREA)
    a = small(al)
    return np.dstack([small(col * al[..., None]), a]), off


def _pathkeys(pk, t):
    """keyframed paths, linear in time"""
    if t <= pk[0][0]:
        return pk[0][1]
    if t >= pk[-1][0]:
        return pk[-1][1]
    for a, b in zip(pk, pk[1:]):
        if a[0] <= t <= b[0]:
            u = (t - a[0]) / (b[0] - a[0])
            return [lerp(x, y, u) for x, y in zip(a[1], b[1])]


def is_static(L):
    if L["bend"] or L.get("squash"):
        return False
    for g in L["groups"]:
        if g.get("trim") or g.get("pathKeys") or isinstance(g["opacity"], dict):
            return False
    return True


class Renderer:
    def __init__(self, data):
        self.sc = Scene(data)
        self.d = data
        self.cache = {}

    def frame(self, t):
        W, H = self.d["width"], self.d["height"]
        out = np.empty((H, W, 3), np.float32)
        out[:] = np.array(self.d["bg"], np.float32) / 255
        for L in self.d["layers"]:
            op = value(L["opacity"], t) / 100
            if op <= 0.002 or not L["groups"]:
                continue
            if is_static(L):
                if L["name"] not in self.cache:
                    self.cache[L["name"]] = raster_groups(L["groups"], 0)
                spr, off = self.cache[L["name"]]
            else:
                spr, off = raster_groups(L["groups"], t, L["bend"], L.get("squash"))
            if spr is None:
                continue
            M = self.sc.world(L["name"], t) @ np.array([[1, 0, off[0]], [0, 1, off[1]], [0, 0, 1.0]])
            lay = cv2.warpAffine(spr, M[:2], (W, H), flags=cv2.INTER_LINEAR, borderValue=0)
            if L.get("blur"):
                lay = cv2.GaussianBlur(lay, (0, 0), L["blur"] * 0.5)
            lay *= op
            out = out * (1 - lay[..., 3:4]) + lay[..., :3]
        return out
