// Dry-run of build_nike_loop.jsx against a strict mock of the After Effects scripting DOM.
// Catches: ES3 syntax errors, unknown matchNames, wrong value dimensions, bad ease arrays,
// stale (invalidated) property references, expression syntax errors, missing assets.
//
// Usage: node ae_mock_check.js ../build_nike_loop.jsx   (needs `npm i acorn`)
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const acorn = require("acorn");

const jsxPath = path.resolve(process.argv[2] || path.join(__dirname, "..", "build_nike_loop.jsx"));
let src = fs.readFileSync(jsxPath, "utf8").replace(/^﻿/, "");
src = src.split("\n").map((l) => (/^\s*#/.test(l) ? "" : l)).join("\n");

// ---------- 1. ES3 syntax ----------
acorn.parse(src, { ecmaVersion: 3, allowReserved: true });
console.log("ES3 syntax: OK");

// ---------- 2. DOM mock ----------
const PVT = { NO_VALUE: 6412, ThreeD_SPATIAL: 6413, ThreeD: 6414, TwoD_SPATIAL: 6415, TwoD: 6416, OneD: 6417, COLOR: 6418, CUSTOM_VALUE: 6419, MARKER: 6420, LAYER_INDEX: 6421, MASK_INDEX: 6422, SHAPE: 6423, TEXT_DOCUMENT: 6424 };
const KIT = { LINEAR: 6612, BEZIER: 6613, HOLD: 6614 };
const stats = { comps: 0, layers: 0, keys: 0, expressions: 0, effects: 0 };
const expressions = [];

function fail(msg) { throw new Error(msg); }

class TextDocument {
  constructor(t) { this.text = t; this.font = "ArialMT"; this.fontSize = 36; this.applyFill = true; this.fillColor = [1, 1, 1]; this.applyStroke = false; this.strokeColor = [0, 0, 0]; this.strokeWidth = 1; this.strokeOverFill = false; this.tracking = 0; this.justification = 7413; }
  resetCharStyle() {} resetParagraphStyle() {}
}
class Shape { constructor() { this.vertices = []; this.inTangents = []; this.outTangents = []; this.closed = true; } }
class KeyframeEase { constructor(speed, influence) { if (influence < 0.1 || influence > 100) fail("KeyframeEase influence out of range: " + influence); this.speed = speed; this.influence = influence; } }
class MarkerValue { constructor(c) { this.comment = c; } }

// --- schema ---
const P = (type, def) => ({ kind: "prop", type, def });
const G = (children) => ({ kind: "named", children });           // fixed children
const IG = (allowed) => ({ kind: "indexed", allowed });          // addProperty() group
const T3 = PVT.ThreeD_SPATIAL;
const TRANSFORM = G({ "ADBE Anchor Point": P(T3, [0, 0, 0]), "ADBE Position": P(T3, [0, 0, 0]), "ADBE Scale": P(PVT.ThreeD, [100, 100, 100]), "ADBE Rotate Z": P(PVT.OneD, 0), "ADBE Opacity": P(PVT.OneD, 100) });
const VEC_XFORM = G({ "ADBE Vector Anchor": P(PVT.TwoD, [0, 0]), "ADBE Vector Position": P(PVT.TwoD_SPATIAL, [0, 0]), "ADBE Vector Scale": P(PVT.TwoD, [100, 100]), "ADBE Vector Skew": P(PVT.OneD, 0), "ADBE Vector Skew Axis": P(PVT.OneD, 0), "ADBE Vector Rotation": P(PVT.OneD, 0), "ADBE Vector Group Opacity": P(PVT.OneD, 100) });
const VEC_ITEMS = {};
const VEC_CONTENTS = IG(VEC_ITEMS);
Object.assign(VEC_ITEMS, {
  "ADBE Vector Group": G({ "ADBE Vectors Group": VEC_CONTENTS, "ADBE Vector Transform Group": VEC_XFORM }),
  "ADBE Vector Shape - Rect": G({ "ADBE Vector Shape Direction": P(PVT.OneD, 1), "ADBE Vector Rect Size": P(PVT.TwoD, [100, 100]), "ADBE Vector Rect Position": P(PVT.TwoD_SPATIAL, [0, 0]), "ADBE Vector Rect Roundness": P(PVT.OneD, 0) }),
  "ADBE Vector Shape - Ellipse": G({ "ADBE Vector Shape Direction": P(PVT.OneD, 1), "ADBE Vector Ellipse Size": P(PVT.TwoD, [100, 100]), "ADBE Vector Ellipse Position": P(PVT.TwoD_SPATIAL, [0, 0]) }),
  "ADBE Vector Shape - Group": G({ "ADBE Vector Shape Direction": P(PVT.OneD, 1), "ADBE Vector Shape": P(PVT.SHAPE, null) }),
  "ADBE Vector Graphic - Fill": G({ "ADBE Vector Blend Mode": P(PVT.OneD, 1), "ADBE Vector Composite Order": P(PVT.OneD, 1), "ADBE Vector Fill Rule": P(PVT.OneD, 1), "ADBE Vector Fill Color": P(PVT.COLOR, [1, 0, 0, 1]), "ADBE Vector Fill Opacity": P(PVT.OneD, 100) }),
  "ADBE Vector Graphic - Stroke": G({ "ADBE Vector Blend Mode": P(PVT.OneD, 1), "ADBE Vector Composite Order": P(PVT.OneD, 1), "ADBE Vector Stroke Color": P(PVT.COLOR, [1, 1, 1, 1]), "ADBE Vector Stroke Opacity": P(PVT.OneD, 100), "ADBE Vector Stroke Width": P(PVT.OneD, 2), "ADBE Vector Stroke Line Cap": P(PVT.OneD, 1), "ADBE Vector Stroke Line Join": P(PVT.OneD, 1), "ADBE Vector Stroke Miter Limit": P(PVT.OneD, 4) }),
  "ADBE Vector Filter - Trim": G({ "ADBE Vector Trim Start": P(PVT.OneD, 0), "ADBE Vector Trim End": P(PVT.OneD, 100), "ADBE Vector Trim Offset": P(PVT.OneD, 0), "ADBE Vector Trim Type": P(PVT.OneD, 1) }),
  "ADBE Vector Filter - Repeater": G({ "ADBE Vector Repeater Copies": P(PVT.OneD, 3), "ADBE Vector Repeater Offset": P(PVT.OneD, 0), "ADBE Vector Repeater Order": P(PVT.OneD, 1),
    "ADBE Vector Repeater Transform": G({ "ADBE Vector Repeater Anchor": P(PVT.TwoD, [0, 0]), "ADBE Vector Repeater Position": P(PVT.TwoD, [100, 0]), "ADBE Vector Repeater Scale": P(PVT.TwoD, [100, 100]), "ADBE Vector Repeater Rotation": P(PVT.OneD, 0), "ADBE Vector Repeater Opacity 1": P(PVT.OneD, 100), "ADBE Vector Repeater Opacity 2": P(PVT.OneD, 100) }) }),
});
const EFFECTS = {
  "ADBE Slider Control": [P(PVT.OneD, 0)],
  "ADBE Color Control": [P(PVT.COLOR, [1, 0, 0, 1])],
  "ADBE Checkbox Control": [P(PVT.OneD, 0)],
  "ADBE Gaussian Blur 2": [P(PVT.OneD, 0), P(PVT.OneD, 1), P(PVT.OneD, 0)],
  "ADBE Glo2": [P(PVT.OneD, 2), P(PVT.OneD, 60), P(PVT.OneD, 10), P(PVT.OneD, 1), P(PVT.OneD, 1), P(PVT.OneD, 3), P(PVT.OneD, 1), P(PVT.OneD, 1), P(PVT.OneD, 1), P(PVT.OneD, 0), P(PVT.OneD, 50), P(PVT.COLOR, [1, 1, 1, 1]), P(PVT.COLOR, [0, 0, 0, 1]), P(PVT.OneD, 1)],
  "ADBE Drop Shadow": [P(PVT.COLOR, [0, 0, 0, 1]), P(PVT.OneD, 127.5), P(PVT.OneD, 135), P(PVT.OneD, 5), P(PVT.OneD, 0), P(PVT.OneD, 0)],
  "ADBE 4ColorGradient": [P(PVT.TwoD_SPATIAL, [0, 0]), P(PVT.COLOR, [1, 1, 0, 1]), P(PVT.TwoD_SPATIAL, [0, 0]), P(PVT.COLOR, [0, 1, 0, 1]), P(PVT.TwoD_SPATIAL, [0, 0]), P(PVT.COLOR, [1, 0, 1, 1]), P(PVT.TwoD_SPATIAL, [0, 0]), P(PVT.COLOR, [0, 0, 1, 1]), P(PVT.OneD, 100), P(PVT.OneD, 0), P(PVT.OneD, 100), P(PVT.OneD, 1)],
  "ADBE Noise": [P(PVT.OneD, 0), P(PVT.OneD, 1), P(PVT.OneD, 1)],
};
const EFFECT_ITEMS = {};
for (const mn of Object.keys(EFFECTS)) {
  const ch = {};
  EFFECTS[mn].forEach((p, i) => { ch[mn + "-" + String(i + 1).padStart(4, "0")] = p; });
  EFFECT_ITEMS[mn] = G(ch);
}
const MASK_ATOM = G({ "ADBE Mask Shape": P(PVT.SHAPE, null), "ADBE Mask Feather": P(PVT.TwoD, [0, 0]), "ADBE Mask Opacity": P(PVT.OneD, 100), "ADBE Mask Offset": P(PVT.OneD, 0) });
const TEXT_SELECTOR = G({ "ADBE Text Percent Start": P(PVT.OneD, 0), "ADBE Text Percent End": P(PVT.OneD, 100), "ADBE Text Percent Offset": P(PVT.OneD, 0) });
const TEXT_ANIM_PROPS = { "ADBE Text Tracking Amount": P(PVT.OneD, 0), "ADBE Text Opacity": P(PVT.OneD, 100), "ADBE Text Position 3D": P(T3, [0, 0, 0]) };
const TEXT_ANIMATOR = G({ "ADBE Text Selectors": IG({ "ADBE Text Selector": TEXT_SELECTOR }), "ADBE Text Animator Properties": IG(TEXT_ANIM_PROPS) });

function layerSchema(kind) {
  const ch = { "ADBE Marker": P(PVT.MARKER, null), "ADBE Time Remapping": P(PVT.OneD, 0), "ADBE Mask Parade": IG({ "ADBE Mask Atom": MASK_ATOM }), "ADBE Effect Parade": IG(EFFECT_ITEMS), "ADBE Transform Group": TRANSFORM };
  if (kind === "shape") ch["ADBE Root Vectors Group"] = VEC_CONTENTS;
  if (kind === "text") ch["ADBE Text Properties"] = G({ "ADBE Text Document": P(PVT.TEXT_DOCUMENT, null), "ADBE Text Animators": IG({ "ADBE Text Animator": TEXT_ANIMATOR }) });
  return G(ch);
}

// --- nodes with AE-like invalidation: adding a child to a group invalidates refs obtained below it ---
class Node {
  constructor(matchName, schema, parent, layer) {
    this.matchName = matchName; this.schema = schema; this.parentNode = parent; this.layer = layer; this.gen = 0;
    this.name = matchName; this.children = [];
    if (schema.kind === "named") for (const k of Object.keys(schema.children)) this.children.push(makeNode(k, schema.children[k], this, layer));
    if (schema.kind === "prop") { this.type = schema.type; this.val = clone(schema.def); this.keys = []; this.expr = ""; }
  }
  ancestors() { const a = []; let p = this.parentNode; while (p) { a.push(p); p = p.parentNode; } return a; }
}
function makeNode(mn, schema, parent, layer) { return new Node(mn, schema, parent, layer); }
const clone = (v) => {
  if (!v || typeof v !== "object") return v;
  for (const C of [TextDocument, Shape, MarkerValue]) if (v instanceof C) return Object.assign(Object.create(C.prototype), JSON.parse(JSON.stringify(v)));
  return JSON.parse(JSON.stringify(v));
};
const hasNaN = (v) => { for (let i = 0; i < v.length; i++) if (typeof v[i] !== "number" || isNaN(v[i])) return true; return false; };
const LEGACY_FONTS = process.argv.includes("--legacy-fonts");
const INSTALLED_FONTS = new Set(["ArialMT", "Arial-BoldMT", "Impact"]);

function dims(type) { return { [PVT.ThreeD_SPATIAL]: 3, [PVT.ThreeD]: 3, [PVT.TwoD_SPATIAL]: 2, [PVT.TwoD]: 2, [PVT.COLOR]: 4 }[type] || 1; }
function checkValue(node, v) {
  const t = node.type, where = node.layer.name + " > " + node.matchName;
  if (t === PVT.OneD) { if (typeof v !== "number" || isNaN(v)) fail("OneD expects number at " + where + ", got " + JSON.stringify(v)); return v; }
  if (t === PVT.COLOR) { if (!Array.isArray(v) || v.length !== 4) fail("COLOR expects [r,g,b,a] at " + where); return v; }
  if (t === PVT.TwoD || t === PVT.TwoD_SPATIAL) { if (!Array.isArray(v) || v.length !== 2 || hasNaN(v)) fail("TwoD expects [x,y] at " + where + ", got " + JSON.stringify(v)); return v; }
  if (t === PVT.ThreeD || t === PVT.ThreeD_SPATIAL) { if (!Array.isArray(v) || (v.length !== 2 && v.length !== 3) || hasNaN(v)) fail("ThreeD expects 2-3 numbers at " + where); return v.length === 2 ? [v[0], v[1], 0] : v; }
  if (t === PVT.SHAPE) {
    if (!(v instanceof Shape)) fail("SHAPE expects Shape at " + where);
    if (v.vertices.length !== v.inTangents.length || v.vertices.length !== v.outTangents.length) fail("Shape arrays mismatch at " + where);
    return v;
  }
  if (t === PVT.TEXT_DOCUMENT) { if (!(v instanceof TextDocument)) fail("TextDocument expected at " + where); v = clone(v); if (!INSTALLED_FONTS.has(v.font)) v.font = "ArialMT"; if (!(v.fontSize > 0)) fail("fontSize"); return v; }
  if (t === PVT.MARKER) { if (!(v instanceof MarkerValue)) fail("MarkerValue expected"); return v; }
  fail("unsupported set on " + where);
}

function checkExpr(node, code) {
  try { acorn.parse(code, { ecmaVersion: 5, allowReturnOutsideFunction: true }); }
  catch (e) { fail("Expression syntax error on " + node.layer.name + " > " + node.matchName + ": " + e.message + "\n" + code); }
  // every referenced layer must exist when the expression is set
  const re = /layer\("([^"]+)"\)/g; let m;
  while ((m = re.exec(code))) {
    const compRef = /comp\("([^"]+)"\)\.layer\("([^"]+)"\)/.exec(code.slice(Math.max(0, m.index - 60), m.index + m[0].length));
    const comp = compRef ? project.items.find((it) => it instanceof CompItem && it.name === compRef[1]) : node.layer.containingComp;
    if (!comp) fail("Expression references missing comp: " + code);
    if (!comp._layers.some((l) => l.name === m[1])) fail("Expression references missing layer '" + m[1] + "' (" + node.layer.name + ")");
  }
  const re2 = /effect\("([^"]+)"\)/g;
  while ((m = re2.exec(code))) {
    if (!/CONTROLS/.test(code)) continue;
    if (!controlsEffects.has(m[1])) fail("Expression references unknown control '" + m[1] + "'");
  }
  stats.expressions++; expressions.push({ layer: node.layer.name, prop: node.matchName, code });
}
const controlsEffects = new Set();

const defineAll = (o, src) => Object.defineProperties(o, Object.getOwnPropertyDescriptors(src));
function wrap(node) {
  const snap = node.ancestors().map((a) => [a, a.gen]);
  const check = () => { for (const [a, g] of snap) if (a.gen !== g) fail("Object is invalid: stale reference to " + node.layer.name + " > " + node.matchName); };
  const api = {};
  if (node.schema.kind !== "prop") {
    defineAll(api, {
      property(key) {
        check();
        let c = null;
        if (typeof key === "number") c = node.children[key - 1] || null;
        else c = node.children.find((ch) => ch.matchName === key || ch.name === key) || null;
        return c ? wrap(c) : null;
      },
      addProperty(mn) {
        check();
        if (node.schema.kind !== "indexed") fail("addProperty on non-indexed group " + node.matchName);
        const s = node.schema.allowed[mn];
        if (!s) fail("addProperty: '" + mn + "' not allowed in " + node.matchName + " (" + node.layer.name + ")");
        node.gen++;
        const c = makeNode(mn, s, node, node.layer);
        node.children.push(c);
        if (node.matchName === "ADBE Effect Parade") stats.effects++;
        return wrap(c);
      },
      get numProperties() { check(); return node.children.length; },
    });
  } else {
    defineAll(api, {
      get value() { check(); return clone(node.val); },
      setValue(v) { check(); if (node.keys.length) fail("setValue on keyframed property " + node.matchName); node.val = checkValue(node, v); },
      setValueAtTime(t, v) {
        check();
        if (typeof t !== "number" || isNaN(t)) fail("bad key time");
        v = checkValue(node, v);
        const ex = node.keys.findIndex((k) => Math.abs(k.t - t) < 1e-6);
        if (ex >= 0) node.keys[ex].v = v; else node.keys.push({ t, v, ease: null, interp: [KIT.BEZIER, KIT.BEZIER] });
        node.keys.sort((a, b) => a.t - b.t); stats.keys++;
      },
      get numKeys() { check(); return node.keys.length; },
      keyTime(k) { check(); return node.keys[k - 1].t; },
      keyValue(k) { check(); if (!node.keys[k - 1]) fail("keyValue bad index"); return clone(node.keys[k - 1].v); },
      nearestKeyIndex(t) { check(); let bi = 1, bd = 1e9; node.keys.forEach((k, i) => { const d = Math.abs(k.t - t); if (d < bd) { bd = d; bi = i + 1; } }); return bi; },
      setTemporalEaseAtKey(k, a, b) {
        check();
        if (!node.keys[k - 1]) fail("setTemporalEaseAtKey bad index " + k + " on " + node.matchName);
        const spatial = node.type === PVT.ThreeD_SPATIAL || node.type === PVT.TwoD_SPATIAL;
        const n = spatial ? 1 : node.type === PVT.TwoD ? 2 : node.type === PVT.ThreeD ? 3 : 1;
        if (a.length !== n || (b && b.length !== n)) fail("Ease array length " + a.length + " != " + n + " on " + node.layer.name + " > " + node.matchName);
        node.keys[k - 1].ease = [a, b];
      },
      setInterpolationTypeAtKey(k, i, o) { check(); if (!node.keys[k - 1]) fail("interp bad index"); node.keys[k - 1].interp = [i, o || i]; },
      setSpatialAutoBezierAtKey(k) { this._sp(k); }, setSpatialContinuousAtKey(k) { this._sp(k); },
      setSpatialTangentsAtKey(k, a, b) { this._sp(k); const n = node.type === PVT.ThreeD_SPATIAL ? 3 : 2; if (a.length !== n || b.length !== n) fail("tangent length"); },
      _sp(k) { check(); if (!(node.type === PVT.ThreeD_SPATIAL || node.type === PVT.TwoD_SPATIAL)) fail("spatial call on non-spatial"); if (!node.keys[k - 1]) fail("spatial bad index"); },
      get isSpatial() { return node.type === PVT.ThreeD_SPATIAL || node.type === PVT.TwoD_SPATIAL; },
      get propertyValueType() { return node.type; },
      get expression() { return node.expr; },
      set expression(code) { check(); checkExpr(node, code); node.expr = code; },
    });
  }
  Object.defineProperty(api, "matchName", { get() { return node.matchName; } });
  Object.defineProperty(api, "name", { get() { check(); return node.name; }, set(v) { check(); node.name = v; if (node.parentNode && node.parentNode.matchName === "ADBE Effect Parade" && node.layer.name === "CONTROLS") controlsEffects.add(v); } });
  Object.defineProperty(api, "propertyIndex", { get() { return node.parentNode.children.indexOf(node) + 1; } });
  api.remove = () => { check(); const p = node.parentNode; p.children.splice(p.children.indexOf(node), 1); p.gen++; };
  return api;
}

// --- items / layers ---
const project = { items: [] };
class Item { constructor(name) { this.name = name; this.parentFolder = null; project.items.push(this); } remove() { project.items.splice(project.items.indexOf(this), 1); } }
class FolderItem extends Item {}
class FootageItem extends Item { constructor(file) { super(path.basename(file)); this.width = 1600; this.height = 1000; this.mainSource = { alphaMode: 0 }; this.file = file; } }
class CompItem extends Item {
  constructor(name, w, h, par, dur, fps) {
    super(name);
    if (!(w > 0 && h > 0 && dur > 0 && fps > 0)) fail("bad comp args");
    Object.assign(this, { width: w, height: h, pixelAspect: par, duration: dur, frameRate: fps, _layers: [], motionBlur: false, shutterAngle: 180, shutterPhase: -90, bgColor: [0, 0, 0], workAreaStart: 0, workAreaDuration: dur, time: 0 });
    const comp = this;
    this.layers = {
      addShape: () => comp._add(new Layer(comp, "Shape Layer", "shape")),
      addNull: (d) => comp._add(new Layer(comp, "Null", "null")),
      addText: (t) => { const l = comp._add(new Layer(comp, t, "text")); l.property("ADBE Text Properties").property("ADBE Text Document").setValue(new TextDocument(t)); return l; },
      addSolid: (c, name, w2, h2, p, d) => { if (!Array.isArray(c) || c.length !== 3) fail("addSolid color must be [r,g,b]"); if (!(w2 > 0 && h2 > 0 && d > 0)) fail("addSolid dims"); return comp._add(new Layer(comp, name, "solid")); },
      add: (item) => { if (!(item instanceof FootageItem || item instanceof CompItem)) fail("layers.add expects item"); if (item === comp) fail("self nest"); const l = comp._add(new Layer(comp, item.name, "av")); l.source = item; return l; },
    };
    stats.comps++;
  }
  _add(l) { this._layers.unshift(l); stats.layers++; return l; }
  get numLayers() { return this._layers.length; }
  layer(k) { const l = typeof k === "number" ? this._layers[k - 1] : this._layers.find((x) => x.name === k); if (!l) fail("comp.layer(" + k + ") not found in " + this.name); return l; }
  openInViewer() {}
}
class Layer {
  constructor(comp, name, kind) {
    this.containingComp = comp; this.name = name; this.kind = kind; this.source = kind === "null" || kind === "solid" ? { isSolid: true } : null;
    this._inPoint = 0; this._outPoint = comp.duration; this.parent = null; this.enabled = true; this.motionBlur = false; this.label = 0; this.adjustmentLayer = false; this.blendingMode = 1; this.trackMatteType = 0; this._timeRemap = false;
    this.root = makeNode("layer", layerSchema(kind), null, this);
  }
  property(k) { return wrap(this.root).property(k); }
  get inPoint() { return this._inPoint; } set inPoint(v) { if (v < 0 || v >= this._outPoint) fail("inPoint " + v + " invalid on " + this.name); this._inPoint = v; }
  get outPoint() { return this._outPoint; } set outPoint(v) { if (v <= this._inPoint) fail("outPoint " + v + " <= inPoint on " + this.name); this._outPoint = v; }
  get timeRemapEnabled() { return this._timeRemap; } set timeRemapEnabled(v) { if (this.kind !== "av") fail("time remap on non-footage layer"); this._timeRemap = v; }
  duplicate() { const d = new Layer(this.containingComp, this.name + " 2", this.kind); d.root = cloneTree(this.root, null, d); d.source = this.source; const arr = this.containingComp._layers; arr.splice(arr.indexOf(this), 0, d); stats.layers++; return d; }
  moveBefore(other) { const arr = this.containingComp._layers; arr.splice(arr.indexOf(this), 1); arr.splice(arr.indexOf(other), 0, this); }
  moveToBeginning() { const arr = this.containingComp._layers; arr.splice(arr.indexOf(this), 1); arr.unshift(this); }
  setTrackMatte(m, type) { if (!(m instanceof Layer) || m.containingComp !== this.containingComp) fail("bad track matte"); this.matte = m; this.trackMatteType = type; }
  sourceRectAtTime() {
    if (this.kind !== "text") fail("sourceRectAtTime only used for text here");
    const td = this.property("ADBE Text Properties").property("ADBE Text Document").value;
    const w = td.text.length * td.fontSize * 0.48, h = td.fontSize * 0.72;
    return { left: td.justification === 7414 ? -w / 2 : 0, top: -h, width: w, height: h };
  }
}
function cloneTree(n, parent, layer) {
  const c = Object.create(Node.prototype);
  Object.assign(c, n, { parentNode: parent, layer, gen: 0 });
  c.val = clone(n.val); c.keys = n.keys ? n.keys.map((k) => Object.assign({}, k)) : undefined;
  c.children = n.children.map((ch) => cloneTree(ch, c, layer));
  return c;
}

const sandbox = {
  app: {
    project: {
      items: {
        addFolder: (n) => new FolderItem(n),
        addComp: (n, w, h, par, d, f) => new CompItem(n, w, h, par, d, f),
      },
      get numItems() { return project.items.length; },
      item: (i) => project.items[i - 1],
      importFile: (io) => { if (!fs.existsSync(io.file.fsName)) fail("import missing " + io.file.fsName); return new FootageItem(io.file.fsName); },
    },
    beginUndoGroup() {}, endUndoGroup() {},
    fonts: LEGACY_FONTS ? undefined : { getFontsByPostScriptName: (ps) => (INSTALLED_FONTS.has(ps) ? [{ postScriptName: ps }] : []) },
  },
  $: { fileName: jsxPath, writeln: console.log },
  File: function (p) { this.fsName = p; this.exists = fs.existsSync(p); this.parent = new sandbox.Folder(path.dirname(p)); },
  Folder: function (p) { this.fsName = p; this.exists = fs.existsSync(p) && fs.statSync(p).isDirectory(); },
  ImportOptions: function (f) { this.file = f; },
  ImportAsType: { FOOTAGE: 1, COMP: 2 }, AlphaMode: { STRAIGHT: 1, PREMULTIPLIED: 2, IGNORE: 3 },
  PropertyValueType: PVT, KeyframeInterpolationType: KIT,
  BlendingMode: { NORMAL: 1, ADD: 2, SCREEN: 3, MULTIPLY: 4 }, TrackMatteType: { ALPHA: 1, NO_TRACK_MATTE: 0 },
  ParagraphJustification: { LEFT_JUSTIFY: 7413, CENTER_JUSTIFY: 7414, RIGHT_JUSTIFY: 7415 },
  KeyframeEase, Shape, MarkerValue, CompItem,
  alert: (m) => { sandbox._alerts.push(m); }, _alerts: [],
};
sandbox.Folder.selectDialog = () => null;
sandbox.File.openDialog = () => null;
// $.evalFile: evaluate a data/script file in the same context and return its value
sandbox.$.evalFile = (f) => vm.runInContext(fs.readFileSync(f.fsName || String(f), "utf8"), sandbox, { filename: f.fsName || String(f) });
vm.createContext(sandbox);
// ExtendScript is ES3: remove ES5+ helpers so accidental use fails loudly
vm.runInContext(`
  delete Array.prototype.indexOf; delete Array.prototype.forEach; delete Array.prototype.map; delete Array.prototype.filter;
  delete Array.prototype.some; delete Array.prototype.every; delete Array.prototype.reduce; delete Array.isArray;
  delete Object.keys; delete String.prototype.trim; delete Function.prototype.bind; this.JSON = undefined;
`, sandbox);
vm.runInContext(src, sandbox, { filename: jsxPath });

// ---------- 3. report ----------
const alerts = sandbox._alerts;
const last = alerts[alerts.length - 1] || "";
console.log("\nAE alert:\n" + last.split("\n").map((l) => "  " + l).join("\n"));
if (/failed/.test(last) || /Warnings/.test(last)) process.exitCode = 1;
console.log("\n" + JSON.stringify(stats));
for (const it of project.items) {
  if (!(it instanceof CompItem)) continue;
  console.log(`\n[${it.name}] ${it.width}x${it.height} ${it.duration}s — ${it._layers.length} layers`);
  for (const l of it._layers) {
    const extra = [l.parent ? "parent=" + l.parent.name : "", l.matte ? "matte=" + l.matte.name : "", l.enabled ? "" : "hidden", l._timeRemap ? "timeRemap" : ""].filter(Boolean).join(" ");
    if (it._layers.length < 40 || !/^STRIPE_/.test(l.name)) console.log(`  ${l.name.padEnd(26)} ${l.inPoint.toFixed(2)}-${l.outPoint.toFixed(2)} ${extra}`);
  }
}
if (process.argv.includes("--expr")) for (const e of expressions) console.log(`\n# ${e.layer} > ${e.prop}\n${e.code}`);
