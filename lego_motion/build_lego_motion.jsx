#target aftereffects
/*
 * LEGO-персонаж · моушн "рука к лицу" · 1080 x 1350 · 30 fps · 5 s (бесшовный луп)
 * ------------------------------------------------------------------------------------
 * Сборщик композиции для After Effects (ExtendScript, AE CC 2018+).
 * Скрипт должен лежать рядом с папкой assets/ (7 PNG: части персонажа на общем холсте 1122x1500).
 *
 * Запуск:  File > Scripts > Run Script File...  ->  build_lego_motion.jsx
 *
 * Риг (все PNG на одном холсте, поэтому у ребёнка Position = точке сустава в пикселях картинки):
 *   LEGS  (корень, стоит в кадре)
 *     TORSO   точка вращения — бёдра;  дыхание — выражение на Scale
 *       HEAD    шея
 *       ARM_R   плечо  -> HAND_R  запястье
 *       ARM_L   плечо (поднимается вперёд: Scale Y + лёгкий Rotation)   <- эта рука идёт к лицу
 *       HAND_L  едет за запястьем ARM_L выражением, без деформации
 *   CONTROLS  слайдеры: Breath (дыхание), Shadow Opacity; цвет фона
 *
 * Сюжет: стоит и дышит -> замах-подготовка -> поднимает руку и закрывает лицо ладонью,
 * голова чуть опускается -> держит позу -> рука возвращается вниз ровно в стартовую позу к 5 s.
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
        breath: 1.2,
        breathPeriod: 2.5
    };

    // Части персонажа (снизу вверх по слоям). pivot — точка вращения в пикселях PNG 1122x1500
    var RIG = [
        { name: "LEGS", file: "legs.png", pivot: [565, 1360], parent: "" },
        { name: "HEAD", file: "head.png", pivot: [565, 520], parent: "TORSO" },
        { name: "TORSO", file: "torso.png", pivot: [565, 918], parent: "LEGS" },
        { name: "ARM_R", file: "arm_right.png", pivot: [767, 600], parent: "TORSO" },
        { name: "HAND_R", file: "hand_right.png", pivot: [846, 868], parent: "ARM_R" },
        { name: "ARM_L", file: "arm_left.png", pivot: [362, 600], parent: "TORSO" },
        { name: "HAND_L", file: "hand_left.png", pivot: [283, 868], parent: "TORSO", follow: "ARM_L" }
    ];

    // Анимация: [время, значение, [influence in, influence out]]. pos — смещение от точки сустава.
    var ANIM = {
        // Рука LEGO жёсткая и крутится только в плече вперёд-вверх: во фронтальном виде это
        // укорочение по длине (Scale Y: 100 -> 0 = смотрит в камеру -> минус = поднята выше плеча)
        // плюс небольшой доворот к лицу (Rotation). Кисть масштаб руки не наследует и не искажается.
        ARM_L: {
            rot: [[0.55, 0, [33, 40]], [0.85, 7, [70, 30]], [1.55, 27, [60, 40]], [1.85, 22, [60, 50]], [2.10, 24, [70, 33]],
                  [4.15, 24, [33, 55]], [4.85, 0, [70, 33]]],
            scale: [[0.85, [100, 100], [33, 45]], [1.55, [100, -84], [60, 40]], [1.85, [100, -70], [60, 50]], [2.10, [100, -75], [70, 33]],
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
    var WARN = [];
    var CTRL = 'thisComp.layer("CONTROLS")';

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

    function findAssets() {
        var here = new File($.fileName).parent;
        var dir = new Folder(here.fsName + "/assets");
        if (!dir.exists) dir = Folder.selectDialog("Select the lego_motion/assets folder");
        if (!dir) return null;
        for (var i = 0; i < RIG.length; i++) {
            if (!new File(dir.fsName + "/" + RIG[i].file).exists) {
                alert("Missing asset: " + RIG[i].file + "\nin " + dir.fsName);
                return null;
            }
        }
        return dir;
    }

    // =====================================================================
    // 3. СБОРКА
    // =====================================================================
    function buildControls(comp) {
        var c = comp.layers.addNull(CFG.duration);
        c.name = "CONTROLS";
        c.label = 2;
        var fx = c.property("ADBE Effect Parade");
        var e = fx.addProperty("ADBE Slider Control");
        e.name = "Breath";
        e.property(1).setValue(CFG.breath);
        e = fx.addProperty("ADBE Slider Control");
        e.name = "Shadow Opacity";
        e.property(1).setValue(18);
        e = fx.addProperty("ADBE Color Control");
        e.name = "Background";
        e.property(1).setValue(rgba(CFG.background));
        var m = c.property("ADBE Marker");
        var marks = [[0.55, "ANTICIPATION"], [0.85, "HAND TO FACE"], [2.1, "HOLD"], [4.15, "RETURN -> loop"]];
        for (var i = 0; i < marks.length; i++) {
            try { m.setValueAtTime(marks[i][0], new MarkerValue(marks[i][1])); } catch (err) { }
        }
        return c;
    }

    function shapeLayer(comp, name) {
        var l = comp.layers.addShape();
        l.name = name;
        var g = l.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group");
        g.name = name;
        return l;
    }

    function buildBackground(comp) {
        var l = shapeLayer(comp, "BG");
        var v = l.property("ADBE Root Vectors Group").property(1).property("ADBE Vectors Group");
        v.addProperty("ADBE Vector Shape - Rect").property("ADBE Vector Rect Size").setValue([W + 20, H + 20]);
        var f = v.addProperty("ADBE Vector Graphic - Fill");
        f.property("ADBE Vector Fill Color").setValue(rgba(CFG.background));
        v.property("ADBE Vector Graphic - Fill").property("ADBE Vector Fill Color").expression = CTRL + ".effect(\"Background\")(1)";
        return l;
    }

    // мягкая тень под ногами (сжимается, когда корпус наклоняется)
    function buildShadow(comp) {
        var l = shapeLayer(comp, "FLOOR_SHADOW");
        var v = l.property("ADBE Root Vectors Group").property(1).property("ADBE Vectors Group");
        v.addProperty("ADBE Vector Shape - Ellipse").property("ADBE Vector Ellipse Size").setValue([560, 46]);
        var f = v.addProperty("ADBE Vector Graphic - Fill");
        f.property("ADBE Vector Fill Color").setValue([0, 0, 0, 1]);
        tr(l, "pos").setValue([CFG.feet[0], CFG.feet[1] + 6]);
        tr(l, "opacity").expression = CTRL + ".effect(\"Shadow Opacity\")(1)";
        var blur = l.property("ADBE Effect Parade").addProperty("ADBE Gaussian Blur 2");
        blur.property(1).setValue(22);
        return l;
    }

    function run() {
        var dir = findAssets();
        if (!dir) return;
        app.beginUndoGroup("Build LEGO facepalm");
        try {
            var comp = app.project.items.addComp(uniqueItemName(CFG.compName), W, H, 1, CFG.duration, CFG.fps);
            var folder = app.project.items.addFolder(uniqueItemName(CFG.compName + " parts"));
            comp.bgColor = rgb(CFG.background);
            comp.motionBlur = true;
            comp.shutterAngle = 180;
            comp.shutterPhase = -90;

            var ctrl = buildControls(comp);
            buildBackground(comp);
            buildShadow(comp);

            var layers = {}, i, r;
            for (i = 0; i < RIG.length; i++) {
                r = RIG[i];
                var io = new ImportOptions(new File(dir.fsName + "/" + r.file));
                io.importAs = ImportAsType.FOOTAGE;
                var item = app.project.importFile(io);
                item.parentFolder = folder;
                try { item.mainSource.alphaMode = AlphaMode.STRAIGHT; } catch (e) { }
                var l = comp.layers.add(item);
                l.name = r.name;
                l.motionBlur = true;
                l.label = r.parent ? 13 : 9;
                tr(l, "anchor").setValue(r.pivot);
                layers[r.name] = l;
            }
            // иерархия: у ребёнка Position = точка сустава (холсты совпадают)
            for (i = 0; i < RIG.length; i++) {
                r = RIG[i];
                var L = layers[r.name];
                if (r.parent) {
                    L.parent = layers[r.parent];
                    tr(L, "pos").setValue(r.pivot);
                    // кисть едет за точкой запястья руки, но не наследует её масштаб
                    if (r.follow) {
                        tr(L, "pos").expression = "var a = thisComp.layer(\"" + r.follow + "\");\n" +
                            "parent.fromComp(a.toComp([" + r.pivot[0] + ", " + r.pivot[1] + "]))";
                    }
                } else {
                    tr(L, "pos").setValue(CFG.feet);
                    tr(L, "scale").setValue([CFG.charScale, CFG.charScale]);
                }
            }
            // ключи
            for (var name in ANIM) {
                if (!ANIM.hasOwnProperty(name)) continue;
                var A = ANIM[name], lay = layers[name];
                if (A.rot) keys(tr(lay, "rot"), A.rot);
                if (A.scale) keys(tr(lay, "scale"), A.scale);
                if (A.pos) {
                    var pv = [], pivot = null;
                    for (i = 0; i < RIG.length; i++) if (RIG[i].name === name) pivot = RIG[i].pivot;
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
            var msg = "LEGO facepalm built: " + comp.name + " (" + W + "x" + H + ", " + CFG.fps + " fps, " + CFG.duration + " s)\n" +
                      "Keyframes: ARM_L / HAND_L / HEAD / TORSO / ARM_R / HAND_R. Controls: CONTROLS layer.";
            if (WARN.length) msg += "\n\nWarnings:\n- " + WARN.join("\n- ");
            alert(msg);
        } catch (e) {
            alert("LEGO facepalm build failed at line " + e.line + ":\n" + e.toString());
        } finally {
            app.endUndoGroup();
        }
    }

    run();
})();
