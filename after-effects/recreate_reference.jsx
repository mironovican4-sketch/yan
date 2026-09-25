/*
 * RECREATE REFERENCE — скрипт для Adobe After Effects (ExtendScript)
 *
 * Собирает по кадрам квадратный ролик 1080x1080, 30 fps, 6.9 с, как референс:
 *   0.00–1.10  затемнение уходит, камера отъезжает от поля ввода iMessage,
 *              буквы «Maybe i» выпрыгивают снизу с перелётом;
 *   1.10–1.77  сообщение улетает синим пузырём, клавиатура уезжает вниз;
 *   1.40–1.77  сверху падает маленький пузырь;
 *   1.77–3.43  пузырь взрывается на 3D-пузыри, камера крутится и наезжает;
 *   2.73–4.93  каракули «MAYBE I» / «Maybe I» с чёрными лучами, кольца
 *              текста, шрифт мигает; зум сквозь текст в серый, затемнение;
 *   5.13–6.90  «Lost My» по буквам, контурное «MIND» переворачивается,
 *              лучи света, уход в красный и разлёт в стороны.
 *
 * КАК ЗАПУСТИТЬ
 *   File > Scripts > Run Script File...  (Файл > Сценарии > Запустить файл сценария...)
 *   Если в панели Project выделен аудиофайл, он встанет в комп как музыка.
 *
 * Только встроенные эффекты AE (CC Radial Fast Blur, Invert, Tint, Glow,
 * Gaussian Blur), без плагинов. Шрифты берутся из списков ниже: первый
 * установленный у тебя. Для максимального сходства поставь похожие шрифты
 * и впиши их PostScript-имена первыми в списки.
 */

(function recreateReference() {

    // ======================= НАСТРОЙКИ =======================
    var CFG = {
        name:        "REFERENCE_RECREATE",
        fps:         30,
        frames:      207,                 // 6.9 с, как у референса

        // тексты сцен
        typed:       "Maybe i",           // сцены 1–2: iMessage и пузыри
        scribble:    "MAYBE I",           // сцена 3: каракули капсом
        scribble2:   "Maybe I",           // сцена 3: рукописный вариант (мигает)
        line1:       "Lost My",           // сцена 4: верхняя строка
        line2:       "MIND",              // сцена 4: контурная строка

        // кадры, на которых появляется каждая буква (как в референсе)
        typedFrames: [5, 10, 14, 19, 24, 28, 29],
        line1Frames: [155, 157, 159, 162, 163, 164, 168],
        line2Frames: [172, 175, 177, 179],
        // кадры, когда каракули переключаются на рукописный шрифт
        scriptFlash: [[91, 93], [106, 108], [112, 114], [133, 135], [139, 141]],

        // шрифты: берётся первый установленный (PostScript-имена)
        fonts: {
            ui:      ["SFProText-Regular", "SFProDisplay-Regular", "HelveticaNeue", "Helvetica", "SegoeUI", "ArialMT"],
            caps:    ["InkFree", "Chalkduster", "MarkerFelt-Wide", "SegoePrint-Bold", "SegoePrint", "ArialMT"],
            script:  ["SegoeScript", "SnellRoundhand", "Noteworthy-Bold", "BradleyHandITCTT-Bold", "InkFree", "ArialMT"],
            rounded: ["SFProRounded-Bold", "ArialRoundedMTBold", "Nunito-Black", "Arial-BoldMT"],
            wide:    ["Arial-Black", "Montserrat-Black", "Impact", "Arial-BoldMT"]
        },

        blue:        [0.04, 0.52, 1.0],   // цвет пузыря iMessage
        renderNow:   false                // true = сразу отрендерить .mp4 на рабочий стол
    };
    // =========================================================

    var S = 1080;                 // квадрат 1080x1080: все координаты ниже в этом масштабе
    var FPS = CFG.fps;
    var DUR = CFG.frames / FPS;
    var LOG = [];
    var FONT_CACHE = {};
    var FONT_REPORT = [];

    function fr(f) { return f / FPS; }
    function warn(msg) { LOG.push(msg); }

    // ---------------- утилиты ----------------

    function getProp(group, keys) {
        if (!group) return null;
        for (var i = 0; i < keys.length; i++) {
            try {
                var p = group.property(keys[i]);
                if (p) return p;
            } catch (e) {}
        }
        return null;
    }

    function setVal(group, keys, v, label) {
        var p = getProp(group, keys);
        if (!p) {
            warn("не найден параметр: " + label);
            return null;
        }
        try {
            p.setValue(v);
        } catch (e) {
            warn("не удалось выставить " + label + ": " + e.toString());
            return null;
        }
        return p;
    }

    function addFx(layer, matchName, label) {
        try {
            var fx = layer.property("ADBE Effect Parade").addProperty(matchName);
            if (label) fx.name = label;
            return fx;
        } catch (e) {
            warn("эффект не добавился: " + (label || matchName));
            return null;
        }
    }

    function setExpr(prop, expr, label) {
        if (!prop) {
            warn("нет свойства для выражения: " + label);
            return;
        }
        try {
            prop.expression = expr;
        } catch (e) {
            warn("выражение не применилось (" + label + "): " + e.toString());
        }
    }

    // Ключи по кадрам: pairs = [[кадр, значение], ...]
    function keyF(prop, pairs) {
        for (var i = 0; i < pairs.length; i++) {
            prop.setValueAtTime(fr(pairs[i][0]), pairs[i][1]);
        }
    }

    function holdAll(prop) {
        for (var k = 1; k <= prop.numKeys; k++) {
            try {
                prop.setInterpolationTypeAtKey(k, KeyframeInterpolationType.HOLD, KeyframeInterpolationType.HOLD);
            } catch (e) {}
        }
    }

    // Ease для одного ключа. Число измерений у свойств разное, пробуем 1..3.
    function easeKey(prop, k, inInf, outInf) {
        for (var n = 1; n <= 3; n++) {
            var a = [];
            var b = [];
            for (var j = 0; j < n; j++) {
                a.push(new KeyframeEase(0, inInf));
                b.push(new KeyframeEase(0, outInf));
            }
            try {
                prop.setTemporalEaseAtKey(k, a, b);
                return;
            } catch (e) {}
        }
    }

    function easeAll(prop, inInf, outInf) {
        for (var k = 1; k <= prop.numKeys; k++) easeKey(prop, k, inInf, outInf);
    }

    function uniqueName(base) {
        var name = base;
        var n = 1;
        var taken = true;
        while (taken) {
            taken = false;
            for (var i = 1; i <= app.project.numItems; i++) {
                if (app.project.item(i).name === name) {
                    taken = true;
                    break;
                }
            }
            if (taken) {
                n++;
                name = base + " " + n;
            }
        }
        return name;
    }

    // Равномерные кадры появления, если длина текста не совпала со списком.
    function charFrames(list, count, from, to) {
        if (list && list.length === count) return list;
        var out = [];
        for (var i = 0; i < count; i++) {
            out.push(Math.round(from + (count > 1 ? (to - from) * i / (count - 1) : 0)));
        }
        return out;
    }

    function arr(a) {
        return "[" + a.join(",") + "]";
    }

    // ---------------- шрифты и текст ----------------

    function fontInstalled(name) {
        try {
            if (app.fonts && app.fonts.getFontsByPostScriptName) {
                var r = app.fonts.getFontsByPostScriptName(name);
                if (!r || r.length === 0) return false;
                try { if (r[0].isSubstitute) return false; } catch (e) {}
                return true;
            }
        } catch (e) {}
        return null;    // старый AE: проверить нельзя, проверим по факту
    }

    function applyFont(tp, doc, cands) {
        var key = cands.join("|");
        if (FONT_CACHE[key]) {
            try {
                doc.font = FONT_CACHE[key];
                tp.setValue(doc);
            } catch (e) {}
            return tp.value;
        }
        for (var i = 0; i < cands.length; i++) {
            var inst = fontInstalled(cands[i]);
            if (inst === false) continue;
            try {
                doc.font = cands[i];
                tp.setValue(doc);
                var back = tp.value;
                if (inst === true || back.font === cands[i]) {
                    FONT_CACHE[key] = cands[i];
                    FONT_REPORT.push(cands[0] + " → " + cands[i]);
                    return back;
                }
            } catch (e) {}
        }
        FONT_CACHE[key] = "";
        warn("ни один шрифт из списка не найден (" + cands.join(", ") + "), стоит шрифт по умолчанию");
        return tp.value;
    }

    /*
     * opts: name, size, color, fonts, pos, anchor ('center'|'leftMid'|'leftBase'|'centerBase'),
     *       width (подогнать размер шрифта под ширину), fill (bool), stroke ([r,g,b]), strokeWidth
     */
    function makeText(comp, str, opts) {
        var tl = comp.layers.addText(str);
        tl.name = opts.name || str;
        var tp = tl.property("ADBE Text Properties").property("ADBE Text Document");
        var doc = tp.value;
        try { doc.resetCharStyle(); } catch (e) {}
        doc.text = str;
        doc.fontSize = opts.size || 100;
        doc.applyFill = opts.fill !== false;
        if (doc.applyFill) doc.fillColor = opts.color || [1, 1, 1];
        if (opts.stroke) {
            doc.applyStroke = true;
            doc.strokeColor = opts.stroke;
            doc.strokeWidth = opts.strokeWidth || 4;
            try { doc.strokeOverFill = true; } catch (e) {}
        } else {
            doc.applyStroke = false;
        }
        doc.tracking = opts.tracking || 0;
        doc.justification = ParagraphJustification.LEFT_JUSTIFY;
        tp.setValue(doc);
        doc = applyFont(tp, tp.value, opts.fonts || CFG.fonts.ui);

        if (opts.width) {
            var r0 = tl.sourceRectAtTime(0, false);
            if (r0.width > 1) {
                doc.fontSize = doc.fontSize * opts.width / r0.width;
                if (opts.stroke) doc.strokeWidth = opts.strokeWidth || 4;
                tp.setValue(doc);
            }
        }

        var r = tl.sourceRectAtTime(0, false);
        var mode = opts.anchor || "center";
        var ap;
        if (mode === "leftMid") ap = [r.left, r.top + r.height / 2];
        else if (mode === "leftBase") ap = [r.left, 0];
        else if (mode === "centerBase") ap = [r.left + r.width / 2, 0];
        else ap = [r.left + r.width / 2, r.top + r.height / 2];
        tl.transform.anchorPoint.setValue(ap);
        if (opts.pos) tl.transform.position.setValue(opts.pos);
        tl.motionBlur = true;
        return tl;
    }

    // Аниматор текста с Expression Selector. props: [[matchName, value], ...]
    function addExprAnimator(tl, name, props, amountExpr) {
        try {
            var an = tl.property("ADBE Text Properties").property("ADBE Text Animators").addProperty("ADBE Text Animator");
            an.name = name;
            var sel = an.property("ADBE Text Selectors").addProperty("ADBE Text Expressible Selector");
            setExpr(sel.property("ADBE Text Expressible Amount"), amountExpr, name);
            for (var i = 0; i < props.length; i++) {
                var p = tl.property("ADBE Text Properties").property("ADBE Text Animators").property(name)
                    .property("ADBE Text Animator Properties").addProperty(props[i][0]);
                p.setValue(props[i][1]);
            }
        } catch (e) {
            warn("аниматор «" + name + "»: " + e.toString());
        }
    }

    // ---------------- шейпы ----------------

    function shapeLayer(comp, name) {
        var l = comp.layers.addShape();
        l.name = name;
        l.transform.position.setValue([0, 0]);
        return l;
    }

    function newGroup(layer, name, center) {
        var grp = layer.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group");
        grp.name = name;
        grp.property("ADBE Vector Transform Group").property("ADBE Vector Position").setValue(center);
        return layer.property("ADBE Root Vectors Group").property(name).property("ADBE Vectors Group");
    }

    function addFill(v, color, opacity) {
        var f = v.addProperty("ADBE Vector Graphic - Fill");
        f.property("ADBE Vector Fill Color").setValue([color[0], color[1], color[2], 1]);
        if (opacity !== undefined) f.property("ADBE Vector Fill Opacity").setValue(opacity);
    }

    function addStroke(v, color, width) {
        var s = v.addProperty("ADBE Vector Graphic - Stroke");
        s.property("ADBE Vector Stroke Color").setValue([color[0], color[1], color[2], 1]);
        s.property("ADBE Vector Stroke Width").setValue(width);
    }

    function rect(layer, name, center, size, round, fill, stroke, strokeW, opacity) {
        try {
            var v = newGroup(layer, name, center);
            var r = v.addProperty("ADBE Vector Shape - Rect");
            r.property("ADBE Vector Rect Size").setValue(size);
            r.property("ADBE Vector Rect Roundness").setValue(round);
            if (stroke) addStroke(v, stroke, strokeW);
            if (fill) addFill(v, fill, opacity);
        } catch (e) {
            warn("шейп " + name + ": " + e.toString());
        }
    }

    function ellipse(layer, name, center, size, fill) {
        try {
            var v = newGroup(layer, name, center);
            var e1 = v.addProperty("ADBE Vector Shape - Ellipse");
            e1.property("ADBE Vector Ellipse Size").setValue(size);
            addFill(v, fill);
        } catch (e) {
            warn("шейп " + name + ": " + e.toString());
        }
    }

    function path(layer, name, verts, inT, outT, closed, fill, stroke, strokeW) {
        try {
            var v = newGroup(layer, name, [0, 0]);
            var pg = v.addProperty("ADBE Vector Shape - Group");
            var sh = new Shape();
            sh.vertices = verts;
            sh.inTangents = inT;
            sh.outTangents = outT;
            sh.closed = closed;
            pg.property("ADBE Vector Shape").setValue(sh);
            if (stroke) addStroke(v, stroke, strokeW);
            if (fill) addFill(v, fill);
        } catch (e) {
            warn("шейп " + name + ": " + e.toString());
        }
    }

    function zeros(n) {
        var a = [];
        for (var i = 0; i < n; i++) a.push([0, 0]);
        return a;
    }

    function solid(comp, color, name) {
        return comp.layers.addSolid(color, name, comp.width, comp.height, 1, comp.duration);
    }

    function adjustment(comp, name) {
        var l = solid(comp, [1, 1, 1], name);
        l.adjustmentLayer = true;
        return l;
    }

    // Слой-трансформ: key(layer, [[кадр, [x,y], scale, rot], ...])
    function keyTransform(layer, rows) {
        var P = [], Sc = [], R = [];
        for (var i = 0; i < rows.length; i++) {
            var f = rows[i][0];
            P.push([f, rows[i][1]]);
            if (rows[i][2] !== null && rows[i][2] !== undefined) Sc.push([f, [rows[i][2], rows[i][2]]]);
            if (rows[i][3] !== null && rows[i][3] !== undefined) R.push([f, rows[i][3]]);
        }
        keyF(layer.transform.position, P);
        if (Sc.length) keyF(layer.transform.scale, Sc);
        if (R.length) keyF(layer.transform.rotation, R);
    }

    // ---------------- выражения ----------------

    function charDelta(framesList) {
        return [
            'var T = ' + arr(framesList) + ';',
            'var i = textIndex - 1;',
            'var d = i < T.length ? time / thisComp.frameDuration - T[i] : -1;'
        ].join("\n");
    }

    function scriptFlashExpr(showScript, fadeIn, fadeOut) {
        var lines = [
            'var S = ' + JSON_like(CFG.scriptFlash) + ';',
            'var f = Math.round(time / thisComp.frameDuration);',
            'var on = false;',
            'for (var i = 0; i < S.length; i++) if (f >= S[i][0] && f <= S[i][1]) on = true;',
            'var fade = 1;'
        ];
        if (fadeIn) lines.push('fade = Math.min(fade, linear(f, ' + fadeIn[0] + ', ' + fadeIn[1] + ', 0, 1));');
        if (fadeOut) lines.push('fade = Math.min(fade, linear(f, ' + fadeOut[0] + ', ' + fadeOut[1] + ', 1, 0));');
        lines.push(showScript ? '(on ? 100 : 0) * fade;' : '(on ? 0 : 100) * fade;');
        return lines.join("\n");
    }

    function JSON_like(pairs) {
        var out = [];
        for (var i = 0; i < pairs.length; i++) out.push(arr(pairs[i]));
        return "[" + out.join(",") + "]";
    }

    // ============================================================
    //  BUBBLE: синий пузырь iMessage (520x220, центр пузыря 250,100)
    // ============================================================
    function buildBubble(folder) {
        var c = app.project.items.addComp(uniqueName(CFG.name + " BUBBLE"), 520, 220, 1, DUR, FPS);
        c.parentFolder = folder;
        var sh = shapeLayer(c, "BUBBLE SHAPE");
        path(sh, "Tail",
            [[418, 150], [492, 192], [446, 176]],
            [[0, 0], [-18, 2], [14, 4]],
            [[10, 24], [-22, -6], [0, 0]],
            true, CFG.blue);
        rect(sh, "Body", [250, 100], [440, 158], 79, CFG.blue);
        makeText(c, CFG.typed, {
            name: "BUBBLE TEXT", size: 96, color: [1, 1, 1], fonts: CFG.fonts.ui,
            width: 330, anchor: "center", pos: [250, 100]
        });
        return c;
    }

    // ============================================================
    //  СЦЕНА 1: интерфейс телефона. Координаты = кадр 30 референса x1.5,
    //  сдвинуты вниз на OY, чтобы при отъезде сверху был запас.
    // ============================================================
    var OY = 300;
    var UI_ANCHOR = [82.5, 324 + OY];     // центр кнопки «+»

    function buildPhoneUI(folder) {
        var c = app.project.items.addComp(uniqueName(CFG.name + " S1 PHONE UI"), 1400, 1800, 1, DUR, FPS);
        c.parentFolder = folder;
        var white = [1, 1, 1];
        var kbGray = [0.82, 0.835, 0.86];
        var keyDark = [0.675, 0.695, 0.725];
        var ink = [0.06, 0.06, 0.07];

        solid(c, white, "UI BG");

        var base = shapeLayer(c, "UI BASE");
        var kbTop = 393 + OY;
        rect(base, "Keyboard BG", [700, (kbTop + 1800) / 2], [1400, 1800 - kbTop], 0, kbGray);
        rect(base, "Top Line", [700, kbTop], [1400, 2], 0, [0.74, 0.75, 0.77]);
        rect(base, "Field", [172 + 664, 324 + OY], [1328, 92], 46, white, [0.8, 0.8, 0.83], 2.5);
        ellipse(base, "Plus BG", [82.5, 324 + OY], [100, 100], [0.905, 0.905, 0.92]);
        rect(base, "Plus H", [82.5, 324 + OY], [38, 5], 2, [0.55, 0.55, 0.58]);
        rect(base, "Plus V", [82.5, 324 + OY], [5, 38], 2, [0.55, 0.55, 0.58]);
        rect(base, "Sep 1", [368, 498 + OY], [2, 58], 0, [0.7, 0.71, 0.74]);
        rect(base, "Sep 2", [746, 498 + OY], [2, 58], 0, [0.7, 0.71, 0.74]);

        var sugg = [["I", 180], ["The", 558], ["I'm", 938]];
        for (var s = 0; s < sugg.length; s++) {
            makeText(c, sugg[s][0], {
                name: "SUGGEST " + sugg[s][0], size: 50, color: ink, fonts: CFG.fonts.ui,
                anchor: "centerBase", pos: [sugg[s][1], 498 + 18 + OY]
            });
        }

        // клавиши: тень + клавиша
        var rows = [
            { keys: "qwertyuiop", y: 645, x0: 55.5 },
            { keys: "asdfghjkl", y: 810, x0: 124.5 },
            { keys: "zxcvbnm", y: 975, x0: 250.5 }
        ];
        var shadow = shapeLayer(c, "KEY SHADOWS");
        var keysL = shapeLayer(c, "KEYS");
        for (var r = 0; r < rows.length; r++) {
            for (var k = 0; k < rows[r].keys.length; k++) {
                var cx = rows[r].x0 + k * 126;
                var cy = rows[r].y + OY;
                rect(shadow, "sh " + rows[r].keys.charAt(k), [cx, cy + 4], [108, 135], 14, [0.53, 0.54, 0.56], null, 0, 70);
                rect(keysL, "key " + rows[r].keys.charAt(k), [cx, cy], [108, 135], 14, white);
            }
        }
        // служебные клавиши
        rect(shadow, "sh shift", [72, 975 + 4 + OY], [142, 135], 14, [0.53, 0.54, 0.56], null, 0, 70);
        rect(keysL, "key shift", [72, 975 + OY], [142, 135], 14, keyDark);
        rect(shadow, "sh back", [1153, 975 + 4 + OY], [142, 135], 14, [0.53, 0.54, 0.56], null, 0, 70);
        rect(keysL, "key back", [1153, 975 + OY], [142, 135], 14, keyDark);
        rect(keysL, "key 123", [95, 1140 + OY], [170, 135], 14, keyDark);
        rect(keysL, "key space", [560, 1140 + OY], [600, 135], 14, white);
        rect(keysL, "key return", [1000, 1140 + OY], [230, 135], 14, keyDark);
        // стрелка shift
        var ay = 975 + OY;
        path(keysL, "shift arrow",
            [[72, ay - 26], [100, ay + 2], [84, ay + 2], [84, ay + 24], [60, ay + 24], [60, ay + 2], [44, ay + 2]],
            zeros(7), zeros(7), true, null, ink, 4);

        for (r = 0; r < rows.length; r++) {
            for (k = 0; k < rows[r].keys.length; k++) {
                var ch = rows[r].keys.charAt(k);
                makeText(c, ch, {
                    name: "KEY " + ch, size: 72, color: ink, fonts: CFG.fonts.ui,
                    anchor: "centerBase", pos: [rows[r].x0 + k * 126, rows[r].y + 22 + OY]
                });
            }
        }

        // набираемый текст
        var typed = makeText(c, CFG.typed, {
            name: "TYPED TEXT", size: 68, color: [0, 0, 0], fonts: CFG.fonts.ui,
            anchor: "leftBase", pos: [225, 342 + OY]
        });
        var T = charFrames(CFG.typedFrames, CFG.typed.length, 5, 29);
        var head = charDelta(T);
        // буква вылетает снизу узкой полоской, перелетает выше строки и садится
        addExprAnimator(typed, "Type Rise", [["ADBE Text Position 3D", [0, 150, 0]]],
            head + '\nd < 0 ? 100 : 100 * Math.exp(-0.37 * d) * Math.cos(0.52 * d);');
        addExprAnimator(typed, "Type Squash", [["ADBE Text Scale 3D", [8, 100, 100]]],
            head + '\nd < 0 ? 100 : 100 * Math.max(0, 1 - d / 2.5);');
        addExprAnimator(typed, "Type Hide", [["ADBE Text Opacity", 0]],
            head + '\nd < 0 ? 100 : 0;');
        keyF(typed.transform.opacity, [[0, 100], [33, 0]]);
        holdAll(typed.transform.opacity);
        return c;
    }

    function buildScene1(folder, ui) {
        var c = app.project.items.addComp(uniqueName(CFG.name + " S1 TYPE"), S, S, 1, DUR, FPS);
        c.parentFolder = folder;
        c.motionBlur = true;
        c.shutterAngle = 360;

        var L = c.layers.add(ui);
        L.name = "PHONE UI";
        L.transform.anchorPoint.setValue(UI_ANCHOR);
        L.motionBlur = true;
        // камера: кадр, позиция «+», масштаб (замерено по референсу)
        keyTransform(L, [
            [0, [105, 427], 172], [5, [105, 425], 170], [10, [105, 414], 165],
            [15, [100, 398], 154], [20, [93, 370], 135], [25, [87, 340], 114],
            [30, [82.5, 324], 100], [33, [64.5, 396], 96.5], [34, [62, 444], 96],
            [35, [61, 512], 95.5], [36, [60, 624], 95], [37, [60, 759], 95],
            [38, [60, 894], 95], [39, [60, 1044], 95], [40, [60, 1200], 95],
            [41, [60, 1380], 95]
        ]);

        var fade = solid(c, [0, 0, 0], "FADE FROM BLACK");
        keyF(fade.transform.opacity, [[0, 100], [5, 80], [10, 45], [15, 15], [20, 0]]);
        return c;
    }

    // ============================================================
    //  СЦЕНА 2: отправка, падающий пузырь, взрыв на 3D-пузыри
    // ============================================================
    function buildScene2(folder, bubble) {
        var c = app.project.items.addComp(uniqueName(CFG.name + " S2 BUBBLES"), S, S, 1, DUR, FPS);
        c.parentFolder = folder;
        c.motionBlur = true;
        c.shutterAngle = 360;

        // отправленный текст ещё чёрный, потом превращается в пузырь
        var sent = makeText(c, CFG.typed, {
            name: "SENT TEXT", size: 66, color: [0, 0, 0], fonts: CFG.fonts.ui,
            anchor: "leftMid", pos: [235, 315]
        });
        keyF(sent.transform.position, [[33, [235, 318]], [35, [252, 312]]]);
        keyF(sent.transform.opacity, [[33, 100], [35, 0]]);
        sent.inPoint = fr(33);
        sent.outPoint = fr(36);

        var main = c.layers.add(bubble);
        main.name = "BUBBLE MAIN";
        main.collapseTransformation = true;
        main.motionBlur = true;
        main.transform.anchorPoint.setValue([250, 100]);
        keyTransform(main, [
            [33, [337, 315], 55, 0], [34, [348, 315], 60, 0], [35, [376, 325], 66, 3],
            [36, [416, 337], 73, 8], [37, [460, 348], 78, 7], [38, [528, 360], 83, 8],
            [39, [590, 360], 86, 8], [41, [691, 370], 95, 10], [42, [725, 360], 96, 8],
            [45, [770, 337], 100, 2], [48, [776, 325], 103, 0], [50, [770, 337], 102, 0],
            [52, [770, 354], 100, 0]
        ]);
        keyF(main.transform.opacity, [[33, 0], [34, 35], [36, 80], [38, 100]]);
        main.inPoint = fr(33);
        main.outPoint = fr(53);

        var small = c.layers.add(bubble);
        small.name = "BUBBLE FALLING";
        small.collapseTransformation = true;
        small.motionBlur = true;
        small.transform.anchorPoint.setValue([250, 100]);
        keyTransform(small, [
            [41, [683, 90], 6, 20], [42, [685, 95], 8, 20], [45, [690, 108], 10, 30],
            [48, [708, 123], 12, 32], [50, [720, 135], 13, 35], [52, [742, 145], 16, 60],
            [53, [753, 200], 18, 75]
        ]);
        small.inPoint = fr(41);
        small.outPoint = fr(54);

        // рой: центр кадра, камера отъезжает на взрыве, потом крутится и наезжает
        var swarm = c.layers.addNull(DUR);
        swarm.name = "SWARM CAM";
        swarm.threeDLayer = true;
        swarm.transform.anchorPoint.setValue([0, 0, 0]);
        swarm.transform.position.setValue([540, 540, 0]);

        // [имя, экранная позиция на кадре 60, поворот Z, масштаб %, поворот Y, поворот X, блюр, задержка]
        var B = [
            ["E", [685, 415], 3, 63, 0, 0, 0, 0],
            ["A", [292, 146], 20, 98, 0, 0, 3, 0],
            ["B", [877, 157], -10, 68, 180, 0, 0, 1],
            ["C", [90, 562], -65, 81, 0, 78, 0, 1],
            ["D", [337, 460], -5, 49, 0, 76, 0, 0],
            ["F", [967, 415], -5, 65, 35, 0, 0, 2],
            ["J", [1040, 60], 70, 55, 180, 0, 0, 2],
            ["L", [470, -30], -80, 70, 0, 0, 4, 1],
            ["H", [900, 810], -5, 88, 180, 0, 6, 1],
            ["I", [75, 1020], 40, 60, 0, 0, 15, 2],
            ["K", [560, 1050], -20, 90, 180, 0, 18, 1],
            ["G", [202, 765], -55, 122, 0, 0, 22, 0]
        ];
        var origin = [685 - 540, 415 - 540, 0];
        var spread = 'var s = 1 + 0.44 * Math.max(0, time - 2.0);\n[value[0] * s, value[1] * s, value[2]];';
        for (var i = 0; i < B.length; i++) {
            var b = B[i];
            var L = c.layers.add(bubble);
            L.name = "BUBBLE " + b[0];
            L.threeDLayer = true;
            L.collapseTransformation = true;
            L.motionBlur = true;
            L.transform.anchorPoint.setValue([250, 100, 0]);
            L.parent = swarm;
            var fin = [b[1][0] - 540, b[1][1] - 540, 0];
            var t0 = 53 + b[7];
            var sign = (i % 2 === 0) ? 1 : -1;
            if (b[0] === "E") {
                L.transform.position.setValue(fin);
                L.transform.scale.setValue([b[3], b[3], 100]);
                L.transform.rotation.setValue(b[2]);
            } else {
                keyF(L.transform.position, [[t0, origin], [60, fin]]);
                keyF(L.transform.scale, [[t0, [12, 12, 100]], [60, [b[3], b[3], 100]]]);
                keyF(L.transform.rotation, [[t0, b[2] - 140 * sign], [60, b[2]]]);
                keyF(L.transform.property("ADBE Rotate Y"), [[t0, b[4] + 180 * sign], [60, b[4]]]);
                easeAll(L.transform.position, 90, 10);
                easeAll(L.transform.scale, 90, 10);
                easeAll(L.transform.rotation, 90, 10);
                easeAll(L.transform.property("ADBE Rotate Y"), 90, 10);
            }
            if (b[4] !== 0 && b[0] === "E") L.transform.property("ADBE Rotate Y").setValue(b[4]);
            if (b[5] !== 0) L.transform.property("ADBE Rotate X").setValue(b[5]);
            setExpr(L.transform.position, spread, "spread " + b[0]);
            if (b[6] > 0) {
                var gb = addFx(L, "ADBE Gaussian Blur 2", "DOF Blur");
                if (gb) setVal(gb, ["ADBE Gaussian Blur 2-0001", "Blurriness", 1], b[6], "Blurriness");
            }
            L.inPoint = fr(b[0] === "E" ? 53 : t0);
            L.outPoint = fr(105);
        }

        // камера роя (ключи ставим после привязки детей)
        var sc = swarm.transform.scale;
        keyF(sc, [[53, [160, 160, 100]], [60, [100, 100, 100]], [84, [145, 145, 100]], [103, [260, 260, 100]]]);
        easeKey(sc, 1, 10, 10);
        easeKey(sc, 2, 90, 70);
        easeKey(sc, 3, 30, 30);
        easeKey(sc, 4, 15, 15);
        var rot = swarm.transform.rotation;
        keyF(rot, [[53, -6], [60, 0], [84, 65], [103, 115]]);
        easeKey(rot, 1, 10, 10);
        easeKey(rot, 2, 60, 75);
        easeKey(rot, 3, 30, 30);
        return c;
    }

    // ============================================================
    //  СЦЕНА 3: каракули с лучами. Строится белым по чёрному,
    //  CC Radial Fast Blur (Brightest) даёт лучи, Invert делает чёрное
    //  по белому. В главный комп кладётся в режиме Multiply.
    // ============================================================
    function ringCopies(c, parent, count, radius, width, size, prefix, fadeIn, fadeOut) {
        for (var i = 0; i < count; i++) {
            var ang = i * 360 / count;
            var rad = ang * Math.PI / 180;
            var pos = [radius * Math.sin(rad), -radius * Math.cos(rad)];
            var variants = [[CFG.scribble, CFG.fonts.caps, false], [CFG.scribble2, CFG.fonts.script, true]];
            for (var v = 0; v < 2; v++) {
                var t = makeText(c, variants[v][0], {
                    name: prefix + " " + (i + 1) + (variants[v][2] ? " script" : " caps"),
                    size: size, color: [1, 1, 1], fonts: variants[v][1], width: width, anchor: "center"
                });
                t.parent = parent;
                t.transform.position.setValue(pos);
                t.transform.rotation.setValue(ang);
                setExpr(t.transform.opacity, scriptFlashExpr(variants[v][2], fadeIn, fadeOut), prefix + " flash");
            }
        }
    }

    function buildScene3(folder) {
        var c = app.project.items.addComp(uniqueName(CFG.name + " S3 SCRIBBLE"), S, S, 1, DUR, FPS);
        c.parentFolder = folder;
        c.motionBlur = true;
        c.shutterAngle = 270;
        solid(c, [0, 0, 0], "BG (becomes white)");

        // внешнее кольцо текста: крутится само по себе
        var outer = c.layers.addNull(DUR);
        outer.name = "OUTER RING";
        outer.transform.anchorPoint.setValue([0, 0]);
        outer.transform.position.setValue([540, 540]);
        ringCopies(c, outer, 8, 510, 190, 70, "OUTER", [82, 84], [139, 146]);
        keyF(outer.transform.rotation, [[82, 40], [148, -60]]);
        keyF(outer.transform.scale, [[82, [70, 63]], [96, [100, 90]], [138, [100, 90]], [146, [160, 144]]]);
        easeAll(outer.transform.scale, 50, 50);

        // главный текст: влетает с вращением, стоит, потом зум сквозь него
        var cam = c.layers.addNull(DUR);
        cam.name = "S3 CAM";
        cam.transform.anchorPoint.setValue([0, 0]);
        cam.transform.position.setValue([540, 540]);

        var inner = c.layers.addNull(DUR);
        inner.name = "INNER RING";
        inner.transform.anchorPoint.setValue([0, 0]);
        inner.parent = cam;
        inner.transform.position.setValue([0, 0]);
        ringCopies(c, inner, 6, 175, 110, 36, "INNER", null, null);
        keyF(inner.transform.rotation, [[82, 0], [149, 150]]);

        var caps = makeText(c, CFG.scribble, {
            name: "MAIN caps", size: 150, color: [1, 1, 1], fonts: CFG.fonts.caps, width: 600, anchor: "center"
        });
        var script = makeText(c, CFG.scribble2, {
            name: "MAIN script", size: 150, color: [1, 1, 1], fonts: CFG.fonts.script, width: 620, anchor: "center"
        });
        caps.parent = cam;
        script.parent = cam;
        caps.transform.position.setValue([0, 0]);
        script.transform.position.setValue([0, 0]);
        setExpr(caps.transform.opacity, scriptFlashExpr(false, null, null), "main caps flash");
        setExpr(script.transform.opacity, scriptFlashExpr(true, null, null), "main script flash");

        keyF(cam.transform.rotation, [
            [82, -250], [88, -80], [93, 55], [100, 38], [112, 27], [124, 18],
            [130, 2], [138, -3], [142, -8], [145, -20], [148, -35]
        ]);
        easeKey(cam.transform.rotation, 3, 70, 40);
        var zs = [[82, 6], [86, 14], [90, 40], [93, 55], [97, 58], [100, 82], [103, 76],
                  [112, 80], [124, 90], [130, 97], [138, 118], [142, 150], [145, 225],
                  [147, 380], [149, 700]];
        var zk = [];
        for (var i = 0; i < zs.length; i++) zk.push([zs[i][0], [zs[i][1], zs[i][1]]]);
        keyF(cam.transform.scale, zk);

        var rays = adjustment(c, "RAYS");
        var rfb = addFx(rays, "CC Radial Fast Blur", "Radial Fast Blur");
        if (rfb) {
            setVal(rfb, ["CC Radial Fast Blur-0001", "Center", 1], [540, 540], "RFB Center");
            setVal(rfb, ["CC Radial Fast Blur-0002", "Amount", 2], 88, "RFB Amount");
            setVal(rfb, ["CC Radial Fast Blur-0003", "Zoom", 3], 2, "RFB Zoom = Brightest");
        }
        var inv = adjustment(c, "INVERT");
        addFx(inv, "ADBE Invert", "Invert");
        return c;
    }

    // ============================================================
    //  СЦЕНА 4: «Lost My» / «MIND» со светом. Белое по чёрному,
    //  в главном компе режим Screen, сверху Tint в красный и Glow.
    // ============================================================
    function buildScene4(folder) {
        var c = app.project.items.addComp(uniqueName(CFG.name + " S4 LOST"), S, S, 1, DUR, FPS);
        c.parentFolder = folder;
        c.motionBlur = true;
        c.shutterAngle = 270;
        solid(c, [0, 0, 0], "BG");

        var l1 = makeText(c, CFG.line1, {
            name: "LINE 1", size: 150, color: [1, 1, 1], fonts: CFG.fonts.rounded, width: 585, anchor: "leftMid"
        });
        var T1 = charFrames(CFG.line1Frames, CFG.line1.length, 155, 168);
        addExprAnimator(l1, "Pop In", [
            ["ADBE Text Scale 3D", [0, 0, 100]],
            ["ADBE Text Rotation", -45],
            ["ADBE Text Opacity", 0]
        ], charDelta(T1) + '\nvar p = d < 0 ? 0 : Math.min(1, d / 4);\n100 * Math.pow(1 - p, 3);');
        keyTransform(l1, [
            [155, [67, 472], 28, -8], [158, [90, 460], 44, -8], [160, [100, 450], 61, -9],
            [162, [100, 472], 78, -10], [164, [112, 472], 83, -11], [166, [123, 460], 89, -13],
            [168, [135, 450], 94, -14], [171, [180, 427], 97, -12], [174, [190, 427], 99, -8],
            [177, [213, 427], 100, -6], [180, [235, 427], 100, -5], [184, [292, 427], 100, -3],
            [188, [382, 415], 100, -2], [192, [540, 415], 100, -1], [194, [652, 427], 100, 0],
            [196, [810, 427], 100, 0], [198, [1035, 427], 100, 0], [200, [1250, 427], 100, 0]
        ]);

        var l2 = makeText(c, CFG.line2, {
            name: "LINE 2 outline", size: 190, fill: false, stroke: [1, 1, 1], strokeWidth: 6,
            fonts: CFG.fonts.wide, width: 562, anchor: "leftMid"
        });
        var T2 = charFrames(CFG.line2Frames, CFG.line2.length, 172, 180);
        addExprAnimator(l2, "Flip In", [
            ["ADBE Text Scale 3D", [100, 0, 100]],
            ["ADBE Text Position 3D", [0, -60, 0]],
            ["ADBE Text Opacity", 0]
        ], charDelta(T2) + '\nvar p = d < 0 ? 0 : Math.min(1, d / 5);\n100 * Math.pow(1 - p, 3);');
        keyTransform(l2, [
            [172, [235, 618], 100, 0], [180, [235, 618], 100, 0], [184, [190, 607], 100, 0],
            [188, [190, 595], 100, 0], [192, [168, 595], 100, 0], [194, [135, 595], 100, -1],
            [196, [100, 595], 100, -2], [198, [55, 595], 100, -5], [200, [-60, 607], 100, -15],
            [202, [-180, 607], 100, -20], [204, [-400, 607], 100, -25]
        ]);

        var rays = adjustment(c, "LIGHT RAYS");
        var rfb = addFx(rays, "CC Radial Fast Blur", "Radial Fast Blur");
        if (rfb) {
            setVal(rfb, ["CC Radial Fast Blur-0001", "Center", 1], [540, 700], "RFB Center");
            setVal(rfb, ["CC Radial Fast Blur-0002", "Amount", 2], 82, "RFB Amount");
            setVal(rfb, ["CC Radial Fast Blur-0003", "Zoom", 3], 2, "RFB Zoom = Brightest");
        }
        return c;
    }

    // ============================================================
    //  ГЛАВНЫЙ КОМП
    // ============================================================
    function pickAudio(proj) {
        var sel = proj.selection || [];
        for (var i = 0; i < sel.length; i++) {
            var it = sel[i];
            if (it instanceof FootageItem && it.hasAudio) return it;
        }
        return null;
    }

    function main() {
        if (!app.project) app.newProject();
        var proj = app.project;
        var audio = pickAudio(proj);

        var folder = proj.items.addFolder(uniqueName(CFG.name + " parts"));
        var bubble = buildBubble(folder);
        var ui = buildPhoneUI(folder);
        var s1 = buildScene1(folder, ui);
        var s2 = buildScene2(folder, bubble);
        var s3 = buildScene3(folder);
        var s4 = buildScene4(folder);

        var comp = proj.items.addComp(uniqueName(CFG.name), S, S, 1, DUR, FPS);
        comp.bgColor = [0, 0, 0];
        comp.motionBlur = true;

        var white = solid(comp, [1, 1, 1], "WHITE BG");
        white.outPoint = fr(150);

        var L1 = comp.layers.add(s1);
        L1.outPoint = fr(42);

        var L2 = comp.layers.add(s2);
        L2.inPoint = fr(33);
        L2.outPoint = fr(105);

        var L3 = comp.layers.add(s3);
        L3.blendingMode = BlendingMode.MULTIPLY;
        L3.inPoint = fr(81);
        L3.outPoint = fr(150);

        var gray = solid(comp, [0.82, 0.82, 0.84], "ZOOM-THROUGH GRAY");
        gray.inPoint = fr(146);
        keyF(gray.transform.opacity, [[146, 0], [148, 55], [149, 100]]);

        var black = solid(comp, [0, 0, 0], "FADE TO BLACK");
        black.inPoint = fr(149);
        keyF(black.transform.opacity, [
            [149, 0], [150, 10], [151, 19], [152, 36], [153, 46], [154, 63],
            [155, 74], [156, 85], [157, 91], [158, 96], [160, 100]
        ]);

        var L4 = comp.layers.add(s4);
        L4.blendingMode = BlendingMode.SCREEN;
        L4.inPoint = fr(153);
        var tint = addFx(L4, "ADBE Tint", "Red Shift");
        if (tint) {
            var mw = getProp(tint, ["ADBE Tint-0002", "Map White To", 2]);
            if (mw) {
                try {
                    keyF(mw, [
                        [180, [1, 1, 1, 1]], [184, [1, 0.8, 0.84, 1]], [188, [1, 0.55, 0.6, 1]],
                        [192, [1, 0.3, 0.34, 1]], [196, [0.9, 0.12, 0.16, 1]]
                    ]);
                } catch (e) {
                    warn("Tint: " + e.toString());
                }
            } else {
                warn("не найден параметр Tint > Map White To");
            }
        }
        var glow = addFx(L4, "ADBE Glo2", "Glow");
        if (glow) {
            setVal(glow, ["ADBE Glo2-0002", "Glow Threshold", 2], 40, "Glow Threshold");
            setVal(glow, ["ADBE Glo2-0003", "Glow Radius", 3], 35, "Glow Radius");
            setVal(glow, ["ADBE Glo2-0004", "Glow Intensity", 4], 0.5, "Glow Intensity");
        }

        if (audio) {
            var al = comp.layers.add(audio);
            al.name = "MUSIC";
            al.moveToEnd();
        }

        comp.openInViewer();
        comp.time = 0;

        if (CFG.renderNow) {
            try {
                var rqi = proj.renderQueue.items.add(comp);
                var om = rqi.outputModule(1);
                try { om.applyTemplate("H.264 - Match Render Settings - 15 Mbps"); } catch (e) {}
                om.file = new File(Folder.desktop.fsName + "/" + comp.name + ".mp4");
                proj.renderQueue.render();
            } catch (e) {
                warn("рендер: " + e.toString());
            }
        }

        var msg = "Готово! Комп «" + comp.name + "» собран (1080x1080, 30 fps, 6.9 с).\n\n";
        msg += "Сцены лежат в папке «" + folder.name + "».\n";
        msg += audio ? "Музыка: " + audio.name + "\n" : "Музыки нет: выдели трек в Project и запусти снова, или просто перетащи его в комп.\n";
        if (FONT_REPORT.length) msg += "\nШрифты:\n- " + FONT_REPORT.join("\n- ") + "\n";
        msg += "\nЖми пробел для превью (первый прогон может считаться медленно из-за моушн-блюра).";
        if (LOG.length) msg += "\n\nЗамечания:\n- " + LOG.join("\n- ");
        alert(msg, "Recreate Reference");
    }

    app.beginUndoGroup("Recreate Reference");
    try {
        main();
    } catch (err) {
        alert("Скрипт остановился с ошибкой:\n" + err.toString() + (err.line ? "\nстрока " + err.line : ""), "Recreate Reference");
    } finally {
        app.endUndoGroup();
    }
})();
