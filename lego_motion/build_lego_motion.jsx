#target aftereffects
/*
 * LEGO-персонаж · моушн "рука к лицу" · 1080 x 1350 · 30 fps · 5 s (бесшовный луп)
 * ------------------------------------------------------------------------------------
 * Сборщик композиции для After Effects (ExtendScript, AE CC 2018+).
 * Персонаж целиком векторный: каждая деталь — шейп-слой с ровными заливками и обводкой.
 * Рядом со скриптом должен лежать lego_vectors.jsxinc (контуры деталей, tools/vectorize.py).
 *
 * Запуск:  File > Scripts > Run Script File...  ->  build_lego_motion.jsx
 *
 * Риг (координаты контуров = пиксели исходной картинки 1122x1500, поэтому Position ребёнка = точка сустава):
 *   LEGS  (корень, стоит в кадре)
 *     TORSO   точка вращения — бёдра;  дыхание — выражение на Scale
 *       HEAD    шея
 *       ARM_R   плечо  -> HAND_R  запястье
 *       ARM_L   плечо: подъём вперёд = Scale группы "Arm" (обводка снаружи группы, толщина линии не меняется)
 *       HAND_L  едет за запястьем ARM_L выражением, без деформации
 *   CONTROLS  цвета (Skin, Hat, Pants, Outline, Background), Breath, Shadow Opacity
 *
 * Сюжет: стоит и дышит -> замах -> поднимает руку и закрывает лицо ладонью, голова чуть опускается
 * -> держит позу -> рука возвращается вниз ровно в стартовую позу к 5 s.
 * Все движения — обычные ключи с easing (блок ANIM), их удобно править в Graph Editor.
 */

(function legoMotionBuilder() {

    // =====================================================================
    // 1. НАСТРОЙКИ
    // =====================================================================
    var CFG = {
        compName: "LEGO_FACEPALM",
        width: 1080,
        height: 1350,
        fps: 30,
        duration: 5,
        charScale: 90,
        feet: [540, 1215],
        background: [244, 241, 236],
        outline: [26, 26, 24],
        breath: 1.2,
        breathPeriod: 2.5
    };

    // Детали персонажа (снизу вверх по слоям). pivot — точка вращения в пикселях исходника 1122x1500
    var RIG = [
        { name: "LEGS", pivot: [565, 1360], parent: "" },
        { name: "HEAD", pivot: [565, 520], parent: "TORSO" },
        { name: "TORSO", pivot: [565, 918], parent: "LEGS" },
        { name: "ARM_R", pivot: [767, 600], parent: "TORSO" },
        { name: "HAND_R", pivot: [846, 868], parent: "ARM_R" },
        { name: "ARM_L", pivot: [362, 600], parent: "TORSO", foreshorten: true },
        { name: "HAND_L", pivot: [283, 868], parent: "TORSO", follow: "ARM_L" }
    ];

    // Анимация: [время, значение, [influence in, influence out]]. pos — смещение от точки сустава.
    var ANIM = {
        // Рука LEGO жёсткая и крутится только в плече вперёд-вверх: во фронтальном виде это
        // укорочение по длине (squash Y: 100 -> 0 = смотрит в камеру -> минус = поднята выше плеча)
        // плюс небольшой доворот к лицу (Rotation). Кисть масштаб руки не наследует и не искажается.
        ARM_L: {
            rot: [[0.55, 0, [33, 40]], [0.85, 7, [70, 30]], [1.55, 27, [60, 40]], [1.85, 22, [60, 50]], [2.10, 24, [70, 33]],
                  [4.15, 24, [33, 55]], [4.85, 0, [70, 33]]],
            squash: [[0.85, [100, 100], [33, 45]], [1.55, [100, -84], [60, 40]], [1.85, [100, -70], [60, 50]], [2.10, [100, -75], [70, 33]],
                     [4.15, [100, -75], [33, 55]], [4.88, [100, 103], [60, 50]], [5.00, [100, 100], [60, 33]]]
        },
        HAND_L: {
            rot: [[0.90, 0, [33, 40]], [1.60, -124, [70, 40]], [1.95, -110, [60, 50]], [2.20, -114, [70, 33]],
                  [4.15, -114, [33, 50]], [4.80, 0, [80, 33]]],
            scale: [[0.90, [100, 100], [33, 40]], [1.60, [116, 116], [70, 40]], [2.20, [112, 112], [70, 33]],
                    [4.15, [112, 112], [33, 50]], [4.80, [100, 100], [80, 33]]]
        },
        HEAD: {
            rot: [[1.45, 0, [33, 40]], [2.00, -5, [80, 33]], [3.40, -3, [50, 50]], [4.15, -5, [50, 40]], [4.75, 0, [80, 33]]],
            pos: [[1.45, [0, 0], [33, 40]], [2.00, [4, 12], [80, 33]], [4.20, [4, 12], [33, 45]], [4.75, [0, 0], [80, 33]]]
        },
        TORSO: {
            rot: [[0.55, 0, [33, 40]], [0.85, 1.5, [60, 40]], [1.60, -2.5, [60, 40]], [2.10, -2, [70, 33]],
                  [4.15, -2, [33, 50]], [4.85, 0, [80, 33]]]
        },
        ARM_R: {
            rot: [[0.85, 0, [33, 40]], [1.45, 5, [60, 40]], [2.05, -2, [60, 50]], [2.60, 0, [70, 33]],
                  [4.30, 0, [33, 40]], [4.70, -4, [60, 40]], [5.00, 0, [60, 33]]]
        },
        HAND_R: {
            rot: [[1.00, 0, [33, 40]], [1.60, 8, [60, 40]], [2.30, -3, [60, 50]], [2.80, 0, [70, 33]]]
        }
    };

    var W = CFG.width, H = CFG.height;
    var CTRL = 'thisComp.layer("CONTROLS")';
    var COLOR_CTRL = { skin: "Skin", green: "Hat", white: "Pants" };
    var VEC = null;

    // =====================================================================
    // 2. ХЕЛПЕРЫ
    // =====================================================================
    function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
    function rgb(c) { return [c[0] / 255, c[1] / 255, c[2] / 255]; }
    function rgba(c) { return [c[0] / 255, c[1] / 255, c[2] / 255, 1]; }

    var TP = { anchor: "ADBE Anchor Point", pos: "ADBE Position", scale: "ADBE Scale", rot: "ADBE Rotate Z", opacity: "ADBE Opacity" };
    function tr(layer, key) { return layer.property("ADBE Transform Group").property(TP[key]); }

    function easeDims(prop) {
        var t = prop.propertyValueType;
        if (t === PropertyValueType.TwoD) return 2;
        if (t === PropertyValueType.ThreeD) return 3;
        return 1;
    }
    function applyEase(prop, k, spec) {
        var n = easeDims(prop), a = [], b = [];
        for (var j = 0; j < n; j++) {
            a.push(new KeyframeEase(0, clamp(spec[0], 0.1, 100)));
            b.push(new KeyframeEase(0, clamp(spec[1], 0.1, 100)));
        }
        prop.setTemporalEaseAtKey(k, a, b);
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
    function keys(prop, list) {
        var i;
        for (i = 0; i < list.length; i++) prop.setValueAtTime(list[i][0], list[i][1]);
        for (i = 0; i < list.length; i++) applyEase(prop, prop.nearestKeyIndex(list[i][0]), list[i][2] || [66, 66]);
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

    function loadVectors() {
        var here = new File($.fileName).parent;
        var f = new File(here.fsName + "/lego_vectors.jsxinc");
        if (!f.exists) f = File.openDialog("Select lego_vectors.jsxinc");
        if (!f || !f.exists) return null;
        return $.evalFile(f);
    }

    // ---------- шейпы (каждое обращение заново от слоя: AE инвалидирует старые ссылки) ----------
    function makeShape(p) {
        var s = new Shape();
        s.vertices = p.v;
        s.inTangents = p.i;
        s.outTangents = p.o;
        s.closed = true;
        return s;
    }
    // группа с контурами; parentVecs — "ADBE Vectors Group", куда добавить
    function addPathsGroup(getVecs, name, paths) {
        var g = getVecs().addProperty("ADBE Vector Group");
        g.name = name;
        var gi = getVecs().numProperties;
        for (var i = 0; i < paths.length; i++) {
            var p = getVecs().property(gi).property("ADBE Vectors Group").addProperty("ADBE Vector Shape - Group");
            p.property("ADBE Vector Shape").setValue(makeShape(paths[i]));
        }
        return gi;
    }
    function addStroke(vecs, colorExpr) {
        var s = vecs.addProperty("ADBE Vector Graphic - Stroke");
        s.property("ADBE Vector Stroke Color").setValue(rgba(CFG.outline));
        s.property("ADBE Vector Stroke Width").setValue(VEC.lineWidth);
        s.property("ADBE Vector Stroke Line Cap").setValue(2);
        s.property("ADBE Vector Stroke Line Join").setValue(2);
        s.property("ADBE Vector Stroke Color").expression = colorExpr;
    }
    // Non-Zero (по умолчанию): у дырок контуры в обратную сторону, а перекрытия кусков сливаются без щелей
    function addFill(vecs, color, colorExpr) {
        var f = vecs.addProperty("ADBE Vector Graphic - Fill");
        f.property("ADBE Vector Fill Color").setValue(rgba(color));
        f.property("ADBE Vector Fill Color").expression = colorExpr;
    }
    function ctrlColor(name) { return CTRL + ".effect(\"" + name + "\")(1)"; }

    // Деталь персонажа: сверху линии-детали (лицо, пресс, тату), под ними цветные куски с обводкой
    function buildPart(comp, r) {
        var part = VEC.parts[r.name];
        var l = comp.layers.addShape();
        l.name = r.name;
        l.label = r.parent ? 13 : 9;
        l.motionBlur = true;
        var root = function () { return l.property("ADBE Root Vectors Group"); };
        var i, gi;
        if (part.details.length) {
            gi = addPathsGroup(root, "Line Art", part.details);
            addFill(root().property(gi).property("ADBE Vectors Group"), CFG.outline, ctrlColor("Outline"));
        }
        if (r.foreshorten) {
            // все куски руки в группе "Arm" (её Scale = подъём вперёд), заливка и обводка — снаружи группы
            var arm = root().addProperty("ADBE Vector Group");
            arm.name = "Arm";
            var ai = root().numProperties;
            var armVecs = function () { return root().property(ai).property("ADBE Vectors Group"); };
            for (i = 0; i < part.regions.length; i++) addPathsGroup(armVecs, "Piece " + (i + 1), part.regions[i].paths);
            var xf = root().property(ai).property("ADBE Vector Transform Group");
            xf.property("ADBE Vector Anchor").setValue(r.pivot);
            xf.property("ADBE Vector Position").setValue(r.pivot);
            addStroke(root(), ctrlColor("Outline"));
            addFill(root(), part.regions[0].color, ctrlColor(COLOR_CTRL[part.regions[0].name]));
        } else {
            for (i = 0; i < part.regions.length; i++) {
                var rg = part.regions[i];
                gi = addPathsGroup(root, (COLOR_CTRL[rg.name] || rg.name) + " " + (i + 1), rg.paths);
                var vecs = root().property(gi).property("ADBE Vectors Group");
                addStroke(vecs, ctrlColor("Outline"));
                addFill(root().property(gi).property("ADBE Vectors Group"), rg.color, ctrlColor(COLOR_CTRL[rg.name]));
            }
        }
        tr(l, "anchor").setValue(r.pivot);
        return l;
    }

    function partColor(cls) {
        for (var n in VEC.parts) {
            if (!VEC.parts.hasOwnProperty(n)) continue;
            var rs = VEC.parts[n].regions;
            for (var i = 0; i < rs.length; i++) if (rs[i].name === cls) return rs[i].color;
        }
        return [128, 128, 128];
    }

    // =====================================================================
    // 3. СБОРКА
    // =====================================================================
    function buildControls(comp) {
        var c = comp.layers.addNull(CFG.duration);
        c.name = "CONTROLS";
        c.label = 2;
        var fx = function () { return c.property("ADBE Effect Parade"); };
        var colors = [["Skin", partColor("skin")], ["Hat", partColor("green")], ["Pants", partColor("white")],
                      ["Outline", CFG.outline], ["Background", CFG.background]];
        for (var i = 0; i < colors.length; i++) {
            var e = fx().addProperty("ADBE Color Control");
            e.name = colors[i][0];
            e.property(1).setValue(rgba(colors[i][1]));
        }
        var sl = [["Breath", CFG.breath], ["Shadow Opacity", 18]];
        for (i = 0; i < sl.length; i++) {
            var s = fx().addProperty("ADBE Slider Control");
            s.name = sl[i][0];
            s.property(1).setValue(sl[i][1]);
        }
        var m = c.property("ADBE Marker");
        var marks = [[0.55, "ANTICIPATION"], [0.85, "HAND TO FACE"], [2.1, "HOLD"], [4.15, "RETURN -> loop"]];
        for (i = 0; i < marks.length; i++) {
            try { m.setValueAtTime(marks[i][0], new MarkerValue(marks[i][1])); } catch (err) { }
        }
        return c;
    }

    function simpleShape(comp, name, kind, size, color, colorExpr) {
        var l = comp.layers.addShape();
        l.name = name;
        var g = l.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group");
        g.name = name;
        var v = function () { return l.property("ADBE Root Vectors Group").property(1).property("ADBE Vectors Group"); };
        if (kind === "rect") v().addProperty("ADBE Vector Shape - Rect").property("ADBE Vector Rect Size").setValue(size);
        else v().addProperty("ADBE Vector Shape - Ellipse").property("ADBE Vector Ellipse Size").setValue(size);
        addFill(v(), color, colorExpr);
        return l;
    }

    function run() {
        VEC = loadVectors();
        if (!VEC) { alert("lego_vectors.jsxinc not found next to the script."); return; }
        app.beginUndoGroup("Build LEGO facepalm");
        try {
            var comp = app.project.items.addComp(uniqueItemName(CFG.compName), W, H, 1, CFG.duration, CFG.fps);
            comp.bgColor = rgb(CFG.background);
            comp.motionBlur = true;
            comp.shutterAngle = 180;
            comp.shutterPhase = -90;

            var ctrl = buildControls(comp);
            simpleShape(comp, "BG", "rect", [W + 20, H + 20], CFG.background, ctrlColor("Background"));
            var sh = simpleShape(comp, "FLOOR_SHADOW", "ellipse", [560, 46], [0, 0, 0], "[0, 0, 0, 1]");
            tr(sh, "pos").setValue([CFG.feet[0], CFG.feet[1] + 6]);
            tr(sh, "opacity").expression = ctrlColor("Shadow Opacity");
            sh.property("ADBE Effect Parade").addProperty("ADBE Gaussian Blur 2").property(1).setValue(22);

            var layers = {}, i, r;
            for (i = 0; i < RIG.length; i++) layers[RIG[i].name] = buildPart(comp, RIG[i]);
            // иерархия: Position ребёнка = точка сустава (все контуры в координатах исходника)
            for (i = 0; i < RIG.length; i++) {
                r = RIG[i];
                var L = layers[r.name];
                if (r.parent) {
                    L.parent = layers[r.parent];
                    tr(L, "pos").setValue(r.pivot);
                } else {
                    tr(L, "pos").setValue(CFG.feet);
                    tr(L, "scale").setValue([CFG.charScale, CFG.charScale]);
                }
                if (r.follow) {
                    // кисть едет за запястьем руки (с учётом Scale группы "Arm"), но не наследует её масштаб
                    tr(L, "pos").expression = [
                        "var a = thisComp.layer(\"" + r.follow + "\");",
                        "var g = a.content(\"Arm\").transform;",
                        "var p = [g.position[0] + (" + r.pivot[0] + " - g.anchorPoint[0]) * g.scale[0] / 100,",
                        "         g.position[1] + (" + r.pivot[1] + " - g.anchorPoint[1]) * g.scale[1] / 100];",
                        "parent.fromComp(a.toComp(p))"
                    ].join("\n");
                }
            }
            // ключи
            for (var name in ANIM) {
                if (!ANIM.hasOwnProperty(name)) continue;
                var A = ANIM[name], lay = layers[name], pivot = null;
                for (i = 0; i < RIG.length; i++) if (RIG[i].name === name) pivot = RIG[i].pivot;
                if (A.rot) keys(tr(lay, "rot"), A.rot);
                if (A.scale) keys(tr(lay, "scale"), A.scale);
                if (A.squash) {
                    keys(lay.property("ADBE Root Vectors Group").property("Arm").property("ADBE Vector Transform Group")
                        .property("ADBE Vector Scale"), A.squash);
                }
                if (A.pos) {
                    var pv = [];
                    for (i = 0; i < A.pos.length; i++) {
                        pv.push([A.pos[i][0], [pivot[0] + A.pos[i][1][0], pivot[1] + A.pos[i][1][1]], A.pos[i][2]]);
                    }
                    keys(tr(lay, "pos"), pv);
                }
            }
            // дыхание: период делит 5 s нацело -> луп без шва
            tr(layers.TORSO, "scale").expression =
                "var a = " + CTRL + ".effect(\"Breath\")(1);\n" +
                "var s = a * Math.sin(time * 2 * Math.PI / " + CFG.breathPeriod + ");\n" +
                "[value[0] - s * 0.3, value[1] + s]";

            ctrl.moveToBeginning();
            comp.openInViewer();
            comp.time = 3;
            alert("LEGO facepalm built: " + comp.name + " (" + W + "x" + H + ", " + CFG.fps + " fps, " + CFG.duration + " s)\n" +
                  "Vector parts: LEGS / TORSO / HEAD / ARM_L / HAND_L / ARM_R / HAND_R. Colors + breath: CONTROLS layer.");
        } catch (e) {
            alert("LEGO facepalm build failed at line " + e.line + ":\n" + e.toString());
        } finally {
            app.endUndoGroup();
        }
    }

    run();
})();
