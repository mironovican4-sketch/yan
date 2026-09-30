#target aftereffects
/*
 * Минималистичный моушн логотипа  ·  1280 x 1240  ·  30 fps  ·  6 s (бесшовный луп)
 * ------------------------------------------------------------------------------------
 * Сборщик композиции для After Effects (ExtendScript, AE CC 2018+). Картинка не нужна:
 * логотип заново построен вектором по модульной сетке исходника (буквы 286 px, модуль 95.3 px).
 *
 * Запуск:  File > Scripts > Run Script File...  ->  build_logo_motion.jsx
 *
 * Слои (сверху вниз):
 *   CONTROLS         null: цвета логотипа (Black, Pink, Background, Grid)
 *   LOGO             null: родитель всех частей логотипа, медленный наезд 97 -> 100 %
 *   DISC             прекомп DISC_SPIN: белое "D" + малый розовый полукруг крутятся как пластинка
 *                    (null DISC_ROTATION: раскрутка на входе, разгон и сжатие на выходе); маска = панель
 *   PINK_PANEL       розовая панель — выезжает слева направо
 *   GLYPH_4_О ... GLYPH_1_Ь   буквы; каждая "рисуется" квадратной кистью по штрихам (группы Bar N)
 *   GRID             тонкая строительная сетка модулей, растворяется к 2.4 s
 *   BG               фон
 *
 * Все движения — обычные ключи с easing (Size/Position прямоугольников, Rotation/Scale диска),
 * их можно двигать в таймлайне. Тайминги — блок T, геометрия — GEO и GLYPHS, цвета — COLORS.
 * Кадр 0 и последний кадр — чистый фон, поэтому ролик зацикливается без шва.
 */

(function logoMotionBuilder() {

    // =====================================================================
    // 1. НАСТРОЙКИ
    // =====================================================================
    var CFG = {
        compName: "LOGO_MOTION",
        width: 1280,
        height: 1240,
        fps: 30,
        duration: 6,
        outro: true,
        grid: true
    };

    // Цвета (0-255), сняты с исходной картинки
    var COLORS = {
        black: [29, 29, 27],
        pink: [242, 179, 198],
        background: [255, 255, 255],
        grid: [222, 222, 222]
    };

    // Геометрия логотипа в px; начало координат — левый верхний угол логотипа (размер 1000 x 620)
    var GEO = {
        glyph: 286,
        gap: 48,
        logoW: 1000,
        logoH: 620,
        panelX: 690,
        panelW: 310,
        discR: 310,
        smallR: 90
    };

    // Буквы на сетке 3x3. col/row — место буквы в сетке 2x2.
    // Штрих: [колонка, ряд, ширина, высота (в модулях), направление рисования]
    var GLYPHS = [
        { name: "Ь", col: 0, row: 0, strokes: [[0, 0, 1, 3, "down"], [1, 0, 1, 1, "right"], [1, 1, 2, 2, "right"]] },
        { name: "Г", col: 1, row: 0, strokes: [[0, 0, 3, 1, "right"], [0, 1, 1, 2, "down"]] },
        { name: "С", col: 0, row: 1, strokes: [[0, 0, 3, 1, "left"], [0, 1, 1, 2, "down"], [1, 2, 2, 1, "right"]] },
        { name: "О", col: 1, row: 1, strokes: [[0, 0, 3, 1, "right"], [2, 1, 1, 2, "down"], [0, 2, 2, 1, "left"], [0, 1, 1, 1, "up"]] }
    ];

    // Тайминги (секунды). Этот же блок читает превью-рендер tools/render_preview.py
    var T = {
        gridIn: 0.00,
        gridStagger: 0.025,
        gridDur: 0.45,
        gridFadeStart: 1.80,
        gridFadeEnd: 2.40,
        build: 0.30,
        glyphStagger: 0.12,
        stroke1: 0.22,
        stroke2: 0.30,
        stroke3: 0.36,
        handoff: 0.70,
        panelIn: 1.20,
        panelDur: 0.42,
        discIn: 1.35,
        discInDur: 1.00,
        discTurns: 1.5,
        smallIn: 1.75,
        smallDur: 0.40,
        outro: 4.10,
        discOut: 4.20,
        discOutDur: 0.95,
        panelOut: 4.95,
        pushStart: 0.30,
        pushEnd: 5.40
    };

    // Easing ключей: [influence in, influence out] — мягкий старт, длинное торможение
    var EASE = {
        start: [33, 45],
        end: [85, 33]
    };

    var W = CFG.width, H = CFG.height;
    var M = GEO.glyph / 3;                       // модуль сетки
    var OX = -GEO.logoW / 2, OY = -GEO.logoH / 2; // логотип центрирован в кадре
    var CTRL = 'thisComp.layer("CONTROLS")';
    var WARN = [];

    // =====================================================================
    // 2. ХЕЛПЕРЫ
    // =====================================================================
    function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
    function rgb(c) { return [c[0] / 255, c[1] / 255, c[2] / 255]; }
    function rgba(c) { return [c[0] / 255, c[1] / 255, c[2] / 255, 1]; }
    function zeros(n) { var a = []; for (var i = 0; i < n; i++) a.push([0, 0]); return a; }
    function safe(label, fn) { try { fn(); } catch (e) { WARN.push(label + ": " + e.toString()); } }

    var TP = { anchor: "ADBE Anchor Point", pos: "ADBE Position", scale: "ADBE Scale", rot: "ADBE Rotate Z", opacity: "ADBE Opacity" };
    function tr(layer, key) { return layer.property("ADBE Transform Group").property(TP[key]); }

    function easeDims(prop) {
        var t = prop.propertyValueType;
        if (t === PropertyValueType.TwoD) return 2;
        if (t === PropertyValueType.ThreeD) return 3;
        return 1;
    }
    function applyEase(prop, k, spec) {
        var KIT = KeyframeInterpolationType;
        if (spec === "L") { prop.setInterpolationTypeAtKey(k, KIT.LINEAR, KIT.LINEAR); return; }
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
    // keys(prop, [[time, value, ease], ...])
    function keys(prop, list) {
        var i;
        for (i = 0; i < list.length; i++) prop.setValueAtTime(list[i][0], list[i][1]);
        for (i = 0; i < list.length; i++) {
            applyEase(prop, prop.nearestKeyIndex(list[i][0]), list[i].length > 2 ? list[i][2] : [66, 66]);
        }
        if (prop.isSpatial) straightPath(prop);
    }
    // ключи "появиться" (+ "уйти", если включён outro)
    function inOut(tIn, dIn, vFrom, vFull, tOut, dOut, vTo) {
        var list = [[tIn, vFrom, EASE.start], [tIn + dIn, vFull, EASE.end]];
        if (CFG.outro) {
            list.push([tOut, vFull, EASE.start]);
            list.push([tOut + dOut, vTo, EASE.end]);
        }
        return list;
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

    // ---------- шейпы (каждое обращение идёт заново от слоя: AE инвалидирует старые ссылки) ----------
    function shapeLayer(comp, name, label) {
        var l = comp.layers.addShape();
        l.name = name;
        l.label = label || 0;
        l.motionBlur = true;
        return l;
    }
    function root(l) { return l.property("ADBE Root Vectors Group"); }
    function addGroup(l, name) {
        var g = root(l).addProperty("ADBE Vector Group");
        g.name = name;
        return root(l).numProperties;
    }
    function vecs(l, gi) { return root(l).property(gi).property("ADBE Vectors Group"); }
    function addRect(l, gi) { vecs(l, gi).addProperty("ADBE Vector Shape - Rect"); }
    function rectProp(l, gi, mn) { return vecs(l, gi).property("ADBE Vector Shape - Rect").property(mn); }
    function makeShape(verts, inT, outT, closed) {
        var s = new Shape();
        s.vertices = verts;
        s.inTangents = inT || zeros(verts.length);
        s.outTangents = outT || zeros(verts.length);
        s.closed = closed;
        return s;
    }
    // правый полукруг радиуса r с центром в (0, 0): прямой край слева, дуга справа
    function halfDisc(r) {
        var k = 0.5523 * r;
        return makeShape(
            [[0, -r], [r, 0], [0, r]],
            [[0, 0], [0, -k], [k, 0]],
            [[k, 0], [0, k], [0, 0]],
            true);
    }
    function rectShape(x0, y0, x1, y1) { return makeShape([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], null, null, true); }
    function addMask(layer, shape) {
        var m = layer.property("ADBE Mask Parade").addProperty("ADBE Mask Atom");
        m.property("ADBE Mask Shape").setValue(shape);
    }
    function addPath(l, gi, shape) {
        var p = vecs(l, gi).addProperty("ADBE Vector Shape - Group");
        p.property("ADBE Vector Shape").setValue(shape);
    }
    function addTrim(l, gi) { vecs(l, gi).addProperty("ADBE Vector Filter - Trim"); }
    function trimProp(l, gi, mn) { return vecs(l, gi).property("ADBE Vector Filter - Trim").property(mn); }
    function addStroke(l, gi, colorKey, width) {
        var s = vecs(l, gi).addProperty("ADBE Vector Graphic - Stroke");
        s.property("ADBE Vector Stroke Color").setValue(rgba(COLORS[colorKey]));
        s.property("ADBE Vector Stroke Width").setValue(width);
        s.property("ADBE Vector Stroke Line Cap").setValue(1); // butt: ровные края по вертикали
        vecs(l, gi).property("ADBE Vector Graphic - Stroke").property("ADBE Vector Stroke Color").expression = colorExpr(colorKey);
    }
    // заливка на уровне слоя — одна на все группы, поэтому стыки штрихов без швов
    function addRootFill(l, colorKey) {
        var f = root(l).addProperty("ADBE Vector Graphic - Fill");
        f.property("ADBE Vector Fill Color").setValue(rgba(COLORS[colorKey]));
        root(l).property("ADBE Vector Graphic - Fill").property("ADBE Vector Fill Color").expression = colorExpr(colorKey);
    }
    var CTRL_NAMES = { black: "Black", pink: "Pink", background: "Background", grid: "Grid" };
    function colorExpr(key) { return CTRL + ".effect(\"" + CTRL_NAMES[key] + "\")(1)"; }

    function parentTo(child, parent) {
        child.parent = parent;
        var a = tr(parent, "anchor").value;
        tr(child, "pos").setValue([a[0], a[1]]);
    }

    // прямоугольник, который "рисуется" вдоль направления и так же "стирается" дальше по ходу
    function barKeys(l, gi, x0, y0, x1, y1, dir, tIn, dIn, tOut, dOut) {
        var w = x1 - x0, h = y1 - y0, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
        var zero, from, to;
        if (dir === "right") { zero = [0, h]; from = [x0, cy]; to = [x1, cy]; }
        else if (dir === "left") { zero = [0, h]; from = [x1, cy]; to = [x0, cy]; }
        else if (dir === "down") { zero = [w, 0]; from = [cx, y0]; to = [cx, y1]; }
        else { zero = [w, 0]; from = [cx, y1]; to = [cx, y0]; }
        var size = rectProp(l, gi, "ADBE Vector Rect Size");
        var pos = rectProp(l, gi, "ADBE Vector Rect Position");
        keys(size, inOut(tIn, dIn, zero, [w, h], tOut, dOut, zero));
        keys(pos, inOut(tIn, dIn, from, [cx, cy], tOut, dOut, to));
    }

    // =====================================================================
    // 3. СЛОИ
    // =====================================================================
    function buildControls(comp) {
        var c = comp.layers.addNull(CFG.duration);
        c.name = "CONTROLS";
        c.label = 2;
        var order = ["black", "pink", "background", "grid"];
        for (var i = 0; i < order.length; i++) {
            var e = c.property("ADBE Effect Parade").addProperty("ADBE Color Control");
            e.name = CTRL_NAMES[order[i]];
            e.property(1).setValue(rgba(COLORS[order[i]]));
        }
        var m = c.property("ADBE Marker");
        var built = T.discIn + T.discInDur;
        var marks = [[T.build, "BUILD"], [built, "LOGO COMPLETE - hold"]];
        if (CFG.outro) marks.push([T.outro, "OUTRO"]);
        for (i = 0; i < marks.length; i++) safe("marker", function () { m.setValueAtTime(marks[i][0], new MarkerValue(marks[i][1])); });
        return c;
    }

    function buildBackground(comp) {
        var l = shapeLayer(comp, "BG", 0);
        var g = addGroup(l, "Background");
        addRect(l, g);
        rectProp(l, g, "ADBE Vector Rect Size").setValue([W + 20, H + 20]);
        addRootFill(l, "background");
        l.motionBlur = false;
        return l;
    }

    function buildGrid(comp) {
        var l = shapeLayer(comp, "GRID", 15);
        var xs = [0, M, 2 * M, GEO.glyph, GEO.glyph + GEO.gap, GEO.glyph + GEO.gap + M, GEO.glyph + GEO.gap + 2 * M,
                  2 * GEO.glyph + GEO.gap, GEO.panelX, GEO.logoW];
        var ys = [0, M, 2 * M, GEO.glyph, GEO.logoH / 2, GEO.glyph + GEO.gap, GEO.glyph + GEO.gap + M,
                  GEO.glyph + GEO.gap + 2 * M, GEO.logoH];
        var lines = [], i;
        for (i = 0; i < xs.length; i++) lines.push([[OX + xs[i], -H * 0.6], [OX + xs[i], H * 0.6]]);
        for (i = 0; i < ys.length; i++) lines.push([[-W * 0.6, OY + ys[i]], [W * 0.6, OY + ys[i]]]);
        for (i = 0; i < lines.length; i++) {
            var g = addGroup(l, "Line " + (i + 1));
            addPath(l, g, makeShape(lines[i], null, null, false));
            addTrim(l, g);
            addStroke(l, g, "grid", 1.2);
            var t0 = T.gridIn + i * T.gridStagger;
            keys(trimProp(l, g, "ADBE Vector Trim End"), [[t0, 0, EASE.start], [t0 + T.gridDur, 100, EASE.end]]);
        }
        keys(tr(l, "opacity"), [[T.gridFadeStart, 100, [33, 33]], [T.gridFadeEnd, 0, [70, 33]]]);
        l.motionBlur = false;
        return l;
    }

    function strokeDur(len) { return len >= 3 ? T.stroke3 : (len === 2 ? T.stroke2 : T.stroke1); }

    function buildGlyph(comp, gi) {
        var G = GLYPHS[gi];
        var l = shapeLayer(comp, "GLYPH_" + (gi + 1) + "_" + G.name, 8);
        var gx = OX + G.col * (GEO.glyph + GEO.gap), gy = OY + G.row * (GEO.glyph + GEO.gap);
        var t = T.build + gi * T.glyphStagger;
        for (var s = 0; s < G.strokes.length; s++) {
            var st = G.strokes[s];
            var dir = st[4];
            var len = (dir === "left" || dir === "right") ? st[2] : st[3];
            var dur = strokeDur(len);
            var g = addGroup(l, "Bar " + (s + 1) + " - " + dir);
            addRect(l, g);
            barKeys(l, g, gx + st[0] * M, gy + st[1] * M, gx + (st[0] + st[2]) * M, gy + (st[1] + st[3]) * M,
                    dir, t, dur, t + (T.outro - T.build), dur);
            t += dur * T.handoff;
        }
        addRootFill(l, "black");
        return l;
    }

    function buildPanel(comp) {
        var l = shapeLayer(comp, "PINK_PANEL", 4);
        var g = addGroup(l, "Panel");
        addRect(l, g);
        barKeys(l, g, OX + GEO.panelX, OY, OX + GEO.panelX + GEO.panelW, OY + GEO.logoH, "right",
                T.panelIn, T.panelDur, T.panelOut, T.panelDur);
        addRootFill(l, "pink");
        return l;
    }

    // Диск справа ("пластинка"): белое "D" + малый розовый полукруг в прекомпе DISC_SPIN.
    // Оба вращаются вместе на null DISC_ROTATION: вход — раскрутка из точки с торможением,
    // выход — разгон в ту же сторону (по часовой) со сжатием. Маска слоя DISC = розовая панель,
    // поэтому левая половина вращающегося диска не заходит на буквы.
    function buildDisc(main) {
        var pc = app.project.items.addComp(uniqueItemName("DISC_SPIN"), W, H, 1, CFG.duration, CFG.fps);
        pc.motionBlur = true;
        pc.shutterAngle = 180;
        pc.shutterPhase = -90;
        var savedCtrl = CTRL;
        CTRL = 'comp("' + main.name + '").layer("CONTROLS")';

        var cx = W / 2 + OX + GEO.panelX, cy = H / 2 + OY + GEO.logoH / 2;
        var rot = pc.layers.addNull(CFG.duration);
        rot.name = "DISC_ROTATION";
        rot.label = 2;
        tr(rot, "pos").setValue([cx, cy]);
        var turns = 360 * T.discTurns, inEnd = T.discIn + T.discInDur, outEnd = T.discOut + T.discOutDur;
        var rk = [[T.discIn, -turns, [33, 8]], [inEnd, 0, [90, 33]]];
        var sk = [[T.discIn, [0, 0], [33, 10]], [T.discIn + 0.6, [100, 100], [85, 33]]];
        if (CFG.outro) {
            rk.push([T.discOut, 0, [33, 75]]);
            rk.push([outEnd, turns, [8, 33]]);
            sk.push([outEnd - 0.55, [100, 100], [33, 80]]);
            sk.push([outEnd, [0, 0], [10, 33]]);
        }
        keys(tr(rot, "rot"), rk);
        keys(tr(rot, "scale"), sk);

        var d = shapeLayer(pc, "D_CUTOUT", 9);
        addPath(d, addGroup(d, "Half Disc"), halfDisc(GEO.discR + 1));   // +1 px: без розовой каймы
        addRootFill(d, "background");
        parentTo(d, rot);

        var s = shapeLayer(pc, "SMALL_DISC", 4);
        addPath(s, addGroup(s, "Half Disc"), halfDisc(GEO.smallR));
        addRootFill(s, "pink");
        parentTo(s, rot);
        var ss = [[T.smallIn, [0, 0], [33, 10]], [T.smallIn + T.smallDur, [100, 100], [85, 33]]];
        if (CFG.outro) {
            ss.push([T.discOut, [100, 100], [33, 70]]);
            ss.push([T.discOut + 0.4, [0, 0], [10, 33]]);
        }
        keys(tr(s, "scale"), ss);
        CTRL = savedCtrl;

        var layer = main.layers.add(pc);
        layer.name = "DISC";
        layer.label = 9;
        layer.motionBlur = true;
        addMask(layer, rectShape(cx, cy - GEO.logoH / 2 - 10, cx + GEO.panelW + 10, cy + GEO.logoH / 2 + 10));
        return layer;
    }

    // =====================================================================
    // 4. ЗАПУСК
    // =====================================================================
    function run() {
        app.beginUndoGroup("Build logo motion");
        try {
            var comp = app.project.items.addComp(uniqueItemName(CFG.compName), W, H, 1, CFG.duration, CFG.fps);
            comp.bgColor = rgb(COLORS.background);
            comp.motionBlur = true;
            comp.shutterAngle = 180;
            comp.shutterPhase = -90;

            // CONTROLS первым — на него ссылаются выражения цветов
            var ctrl = buildControls(comp);
            buildBackground(comp);
            var parts = [];
            if (CFG.grid) parts.push(buildGrid(comp));
            for (var i = 0; i < GLYPHS.length; i++) parts.push(buildGlyph(comp, i));
            parts.push(buildPanel(comp));
            parts.push(buildDisc(comp));

            var logo = comp.layers.addNull(CFG.duration);
            logo.name = "LOGO";
            logo.label = 2;
            var pushEnd = CFG.outro ? T.pushEnd : CFG.duration;
            keys(tr(logo, "scale"), [[T.pushStart, [97, 97], [30, 20]], [pushEnd, [100, 100], [60, 30]]]);
            for (i = 0; i < parts.length; i++) parentTo(parts[i], logo);
            ctrl.moveToBeginning();

            comp.openInViewer();
            comp.time = T.discIn + T.discInDur + 0.5;
            var msg = "Logo motion built: " + comp.name + " (" + W + "x" + H + ", " + CFG.fps + " fps, " + CFG.duration + " s)\n" +
                      "Colors: CONTROLS layer. Timing: keyframes on the GLYPH / PANEL / DISC layers.";
            if (WARN.length) msg += "\n\nWarnings:\n- " + WARN.join("\n- ");
            alert(msg);
        } catch (e) {
            alert("Logo motion build failed at line " + e.line + ":\n" + e.toString());
        } finally {
            app.endUndoGroup();
        }
    }

    run();
})();
