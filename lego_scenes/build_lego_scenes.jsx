#target aftereffects
/*
 * LEGO SCENES · сцены с реквизитом · 1080 x 1350 · 30 fps · бесшовные лупы
 * ------------------------------------------------------------------------
 * Универсальный сборщик для After Effects (ExtendScript, AE 2020+: дреды гнутся, а рука, поднятая к камере,
 * укорачивается выражениями на контурах — обводка остаётся ровной).
 * Каждая сцена — файл данных scenes/<ИМЯ>.jsxinc (его пишет tools/scenes.py): слои, векторные контуры,
 * ключи. Превью (tools/render.py) рисуется из тех же данных, поэтому совпадает с композицией.
 *
 * Запуск:  File > Scripts > Run Script File...  ->  build_lego_scenes.jsx
 * Чтобы собрать одну сцену, впишите её имя в ONLY.
 */

(function legoScenesBuilder() {

    var ONLY = "";   // например "RED_SUIT_MIC"
    var SCENES = ["RED_DREADS_SPRAY", "ASTRO_BRICK_HEADBANG", "RED_SUIT_MIC", "BRICK_BRAIDS_ANNOYED", "VARSITY_BEAR_FLY"];

    // =====================================================================
    // ХЕЛПЕРЫ
    // =====================================================================
    function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
    function rgb(c) { return [c[0] / 255, c[1] / 255, c[2] / 255]; }
    function rgba(c) { return [c[0] / 255, c[1] / 255, c[2] / 255, 1]; }
    var TP = { anchor: "ADBE Anchor Point", pos: "ADBE Position", scale: "ADBE Scale", rot: "ADBE Rotate Z", opacity: "ADBE Opacity" };
    function tr(layer, key) { return layer.property("ADBE Transform Group").property(TP[key]); }
    function isKeyed(V) { return V !== null && typeof V === "object" && !(V instanceof Array) && V.k !== undefined; }

    function makeShape(p) {
        var s = new Shape();
        s.vertices = p.v;
        s.inTangents = p.i;
        s.outTangents = p.o;
        s.closed = p.c;
        return s;
    }
    function easeDims(prop) {   // spatial properties take one ease, the others one per dimension
        var t = prop.propertyValueType;
        if (t === PropertyValueType.TwoD) return 2;
        if (t === PropertyValueType.ThreeD) return 3;
        return 1;
    }
    function straightPath(prop) {
        for (var k = 1; k <= prop.numKeys; k++) {
            try {
                var z = prop.keyValue(k).length === 3 ? [0, 0, 0] : [0, 0];
                prop.setSpatialAutoBezierAtKey(k, false);
                prop.setSpatialContinuousAtKey(k, false);
                prop.setSpatialTangentsAtKey(k, z, z);
            } catch (e) { }
        }
    }
    // V: значение или {k: [[t, v, ease], ...]}; ease = [in, out] (influence, скорость 0) | "L" | "H"
    function setV(prop, V, conv) {
        var f = conv || function (v) { return v; };
        if (!isKeyed(V)) { prop.setValue(f(V)); return; }
        var ks = V.k, i, idx, e, a, b, j, n;
        for (i = 0; i < ks.length; i++) prop.setValueAtTime(ks[i][0], f(ks[i][1]));
        for (i = 0; i < ks.length; i++) {
            idx = prop.nearestKeyIndex(ks[i][0]);
            e = ks[i][2];
            if (e === "L") {
                prop.setInterpolationTypeAtKey(idx, KeyframeInterpolationType.LINEAR, KeyframeInterpolationType.LINEAR);
            } else if (e === "H") {
                prop.setInterpolationTypeAtKey(idx, KeyframeInterpolationType.LINEAR, KeyframeInterpolationType.HOLD);
            } else if (prop.propertyValueType !== PropertyValueType.SHAPE) {
                n = easeDims(prop); a = []; b = [];
                for (j = 0; j < n; j++) {
                    a.push(new KeyframeEase(0, clamp(e[0], 0.1, 100)));
                    b.push(new KeyframeEase(0, clamp(e[1], 0.1, 100)));
                }
                prop.setTemporalEaseAtKey(idx, a, b);
            }
        }
        if (prop.isSpatial) straightPath(prop);
    }
    function uniqueItemName(base) {
        var name = base, n = 1, taken = true;
        while (taken) {
            taken = false;
            for (var i = 1; i <= app.project.numItems; i++) {
                if (app.project.item(i).name === name) { taken = true; break; }
            }
            if (taken) { n++; name = base + "_" + n; }
        }
        return name;
    }
    function loadScene(name) {
        var here = new File($.fileName).parent;
        var f = new File(here.fsName + "/scenes/" + name + ".jsxinc");
        if (!f.exists) return null;
        return $.evalFile(f);
    }
    function squashExpr(q) {
        return [
            "var s = effect(\"Squash\")(1) / 100, py = " + q.py + ";",
            "var p = thisProperty.points(), it = thisProperty.inTangents(), ot = thisProperty.outTangents();",
            "for (var i = 0; i < p.length; i++) {",
            "  p[i] = [p[i][0], py + (p[i][1] - py) * s];",
            "  it[i] = [it[i][0], it[i][1] * s];",
            "  ot[i] = [ot[i][0], ot[i][1] * s];",
            "}",
            "createPath(p, it, ot, thisProperty.isClosed())"
        ].join("\n");
    }
    function bendExpr(b) {
        return [
            "var b = effect(\"Bend\")(1) * Math.PI / 180, rx = " + b.root[0] + ", ry = " + b.root[1] + ", L = " + b.len + ";",
            "var p = thisProperty.points(), it = thisProperty.inTangents(), ot = thisProperty.outTangents();",
            "for (var i = 0; i < p.length; i++) {",
            "  var d = Math.max(0, Math.min(1.3, (p[i][1] - ry) / L)), a = b * d * d, c = Math.cos(a), s = Math.sin(a);",
            "  var dx = p[i][0] - rx, dy = p[i][1] - ry;",
            "  p[i] = [rx + c * dx - s * dy, ry + s * dx + c * dy];",
            "  it[i] = [c * it[i][0] - s * it[i][1], s * it[i][0] + c * it[i][1]];",
            "  ot[i] = [c * ot[i][0] - s * ot[i][1], s * ot[i][0] + c * ot[i][1]];",
            "}",
            "createPath(p, it, ot, thisProperty.isClosed())"
        ].join("\n");
    }

    // =====================================================================
    // СЛОИ
    // =====================================================================
    function addGroup(l, G, bend, squash) {
        var root = function () { return l.property("ADBE Root Vectors Group"); };
        var g = root().addProperty("ADBE Vector Group");
        g.name = G.name;
        var gi = root().numProperties;
        var vecs = function () { return root().property(gi).property("ADBE Vectors Group"); };
        var i, j, p;
        var count = G.pathKeys ? G.pathKeys[0][1].length : G.paths.length;
        for (i = 0; i < count; i++) {
            p = vecs().addProperty("ADBE Vector Shape - Group");
            var sp = p.property("ADBE Vector Shape");
            if (G.pathKeys) {
                for (j = 0; j < G.pathKeys.length; j++) sp.setValueAtTime(G.pathKeys[j][0], makeShape(G.pathKeys[j][1][i]));
                for (j = 1; j <= sp.numKeys; j++) sp.setInterpolationTypeAtKey(j, KeyframeInterpolationType.LINEAR, KeyframeInterpolationType.LINEAR);
            } else {
                sp.setValue(makeShape(G.paths[i]));
            }
            if (bend) sp.expression = bendExpr(bend);
            if (squash) sp.expression = squashExpr(squash);
        }
        if (G.trim) {
            var tm = vecs().addProperty("ADBE Vector Filter - Trim");
            setV(tm.property("ADBE Vector Trim Start"), G.trim.start);
            setV(vecs().property(vecs().numProperties).property("ADBE Vector Trim End"), G.trim.end);
        }
        if (G.stroke) {
            var s = vecs().addProperty("ADBE Vector Graphic - Stroke");
            s.property("ADBE Vector Stroke Color").setValue(rgba(G.stroke.color));
            s.property("ADBE Vector Stroke Width").setValue(G.stroke.width);
            s.property("ADBE Vector Stroke Opacity").setValue(G.stroke.opacity);
            s.property("ADBE Vector Stroke Line Cap").setValue(2);
            s.property("ADBE Vector Stroke Line Join").setValue(2);
        }
        if (G.fill) {
            var f = vecs().addProperty("ADBE Vector Graphic - Fill");
            f.property("ADBE Vector Fill Color").setValue(rgba(G.fill));
            f.property("ADBE Vector Fill Opacity").setValue(G.fillOpacity);
        }
        setV(root().property(gi).property("ADBE Vector Transform Group").property("ADBE Vector Group Opacity"), G.opacity);
    }

    function buildLayer(comp, L) {
        var l = comp.layers.addShape();
        l.name = L.name;
        l.label = L.parent ? 13 : 9;
        if (L.blur) l.property("ADBE Effect Parade").addProperty("ADBE Gaussian Blur 2").property(1).setValue(L.blur);
        if (L.bend) {
            var e = l.property("ADBE Effect Parade").addProperty("ADBE Slider Control");
            e.name = "Bend";
            setV(l.property("ADBE Effect Parade").property("Bend").property(1), L.bend.deg);
        }
        if (L.squash) {
            var q = l.property("ADBE Effect Parade").addProperty("ADBE Slider Control");
            q.name = "Squash";
            setV(l.property("ADBE Effect Parade").property("Squash").property(1), L.squash.s);
        }
        for (var i = 0; i < L.groups.length; i++) addGroup(l, L.groups[i], L.bend, L.squash);
        return l;
    }

    function buildScene(S, folder) {
        var comp = app.project.items.addComp(uniqueItemName("LEGO_" + S.name), S.width, S.height, 1, S.duration, S.fps);
        comp.parentFolder = folder;
        comp.bgColor = rgb(S.bg);
        comp.motionBlur = false;   // каждый кадр чёткий
        var layers = {}, i, L, lay;
        for (i = 0; i < S.layers.length; i++) layers[S.layers[i].name] = buildLayer(comp, S.layers[i]);
        // сначала иерархия (пока у слоёв нет масштаба и поворота — AE иначе подкрутит Scale ребёнка), потом трансформации
        for (i = 0; i < S.layers.length; i++) {
            if (S.layers[i].parent) layers[S.layers[i].name].parent = layers[S.layers[i].parent];
        }
        for (i = 0; i < S.layers.length; i++) {
            L = S.layers[i];
            lay = layers[L.name];
            tr(lay, "anchor").setValue(L.anchor);
            setV(tr(lay, "pos"), L.pos);
            setV(tr(lay, "rot"), L.rot);
            setV(tr(lay, "scale"), L.scale);
            setV(tr(lay, "opacity"), L.opacity);
        }
        return comp;
    }

    function run() {
        app.beginUndoGroup("Build LEGO scenes");
        try {
            var folder = app.project.items.addFolder(uniqueItemName("LEGO_SCENES"));
            var built = [], missing = [], last = null;
            for (var i = 0; i < SCENES.length; i++) {
                if (ONLY && SCENES[i] !== ONLY) continue;
                var S = loadScene(SCENES[i]);
                if (!S) { missing.push(SCENES[i]); continue; }
                last = buildScene(S, folder);
                built.push(last.name);
            }
            if (last) last.openInViewer();
            alert("LEGO scenes built:\n- " + built.join("\n- ") + (missing.length ? "\n\nMissing scenes/*.jsxinc: " + missing.join(", ") : ""));
        } catch (e) {
            alert("LEGO scenes build failed at line " + e.line + ":\n" + e.toString());
        } finally {
            app.endUndoGroup();
        }
    }

    run();
})();
