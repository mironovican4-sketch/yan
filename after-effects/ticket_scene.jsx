/*
 * TICKET SCENE — скрипт для Adobe After Effects (ExtendScript)
 *
 * Собирает композицию по скриншотам, 1920x1080, 30 fps, 7 с:
 *   - тёмный фон: оранжевые «планеты», рваные чёрные скалы, колонны справа;
 *   - сверху тёмный лендинг концерта;
 *   - тикет в стиле рваной бумаги;
 *   - снизу светлая карточка со схемой зала. Из-за неё выглядывает человек
 *     и держит схему руками.
 *
 * Камера: крупно карточка → отъезд и панорама вверх на общий план →
 * тикет слетает человеку в руки, камера наезжает.
 *
 * ЧЕЛОВЕК: выдели в панели Project PNG с вырезанным человеком (голова + руки,
 * прозрачный фон) и запусти скрипт. Он встанет в центр вместо заглушки.
 * Если выделить второй картинкой фото артиста, оно встанет в тикет.
 *
 * Запуск: File > Scripts > Run Script File...
 */

(function ticketScene() {

    // ======================= НАСТРОЙКИ =======================
    var CFG = {
        name:      "TICKET_SCENE",
        width:     1920,
        height:    1080,
        fps:       30,
        seconds:   7,

        // тексты (поменяй на свои)
        date:      "Сб, 10 октября 2026, 20:00",
        event:     "Концерт в Санкт-Петербурге",
        venue:     "Арена",
        price1:    "7 000 ₽",
        price2:    "50 000 ₽",
        pageBrand: "agency",
        pageKicker:"ARTIST NAME",
        pageTitle: "LIVE",
        pageSub:   "КОНЦЕРТ\nВ САНКТ-ПЕТЕРБУРГЕ",
        partners:  ["PARTNER", "ARENA", "TICKETS", "ACCESS"],
        footer:    "Copyright 2026. Все права защищены",
        ticketTop: "LIVE IN CONCERT",
        ticketName:"ARTIST\nNAME",
        ticketSub: "GENERAL ADMISSION  |  FAN CONCEPT",

        fonts: {
            ui:    ["Inter-Regular", "SFProText-Regular", "SegoeUI", "HelveticaNeue", "ArialMT"],
            uiBold:["Inter-SemiBold", "SFProText-Semibold", "SegoeUI-Semibold", "HelveticaNeue-Bold", "Arial-BoldMT"],
            heavy: ["Montserrat-Black", "Anton-Regular", "Arial-Black", "Impact", "Arial-BoldMT"]
        },
        renderNow: false
    };
    // =========================================================

    var FPS = CFG.fps;
    var DUR = CFG.seconds;
    var W = CFG.width, H = CFG.height;
    var LOG = [];
    var FONT_CACHE = {};
    var FONT_REPORT = [];

    function fr(f) { return f / FPS; }
    function sec(s) { return s * FPS; }     // секунды → кадры для keyF

    function rotZ(layer) {
        return layer.property("ADBE Transform Group").property("ADBE Rotate Z");
    }

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
        if (R.length) keyF(rotZ(layer), R);
    }


    // простой детерминированный рандом, чтобы сцена каждый раз была одинаковой
    var SEED = 7;
    function rnd() {
        SEED = (SEED * 16807) % 2147483647;
        return (SEED - 1) / 2147483646;
    }

    // рваный многоугольник: контур прямоугольника с зубцами по верху/низу
    function jaggedRect(cx, cy, w, h, teeth, depth) {
        var v = [];
        var i;
        for (i = 0; i <= teeth; i++) v.push([cx - w / 2 + w * i / teeth, cy - h / 2 + (rnd() - 0.5) * depth]);
        for (i = teeth; i >= 0; i--) v.push([cx - w / 2 + w * i / teeth, cy + h / 2 + (rnd() - 0.5) * depth]);
        return v;
    }

    // скала: вытянутый рваный силуэт
    function rockShape(cx, cy, len, thick, angle, points) {
        var v = [];
        var a = angle * Math.PI / 180;
        for (var i = 0; i < points; i++) {
            var t = i / points * Math.PI * 2;
            var r = 1 + (rnd() - 0.5) * 0.55;
            var x = Math.cos(t) * len / 2 * r;
            var y = Math.sin(t) * thick / 2 * r * (1 + (rnd() - 0.5) * 0.8);
            v.push([cx + x * Math.cos(a) - y * Math.sin(a), cy + x * Math.sin(a) + y * Math.cos(a)]);
        }
        return v;
    }

    function poly(layer, name, verts, fill, opacity) {
        path(layer, name, verts, zeros(verts.length), zeros(verts.length), true, fill, null, 0);
        if (opacity !== undefined) {
            try {
                layer.property("ADBE Root Vectors Group").property(name).property("ADBE Vectors Group")
                    .property("ADBE Vector Graphic - Fill").property("ADBE Vector Fill Opacity").setValue(opacity);
            } catch (e) {}
        }
    }

    function dropShadow(layer, opacity, distance, softness) {
        var ds = addFx(layer, "ADBE Drop Shadow", "Shadow");
        if (!ds) return;
        setVal(ds, ["ADBE Drop Shadow-0002", "Opacity", 2], opacity * 2.55, "Shadow Opacity");
        setVal(ds, ["ADBE Drop Shadow-0003", "Direction", 3], 180, "Shadow Direction");
        setVal(ds, ["ADBE Drop Shadow-0004", "Distance", 4], distance, "Shadow Distance");
        setVal(ds, ["ADBE Drop Shadow-0005", "Softness", 5], softness, "Shadow Softness");
    }

    function txt(comp, str, size, color, fonts, pos, anchor, name) {
        return makeText(comp, str, { name: name || str, size: size, color: color, fonts: fonts, pos: pos, anchor: anchor || "center" });
    }

    function fitInto(layer, item, w, h, cover) {
        var s = cover ? Math.max(w / item.width, h / item.height) : Math.min(w / item.width, h / item.height);
        layer.transform.scale.setValue([s * 100, s * 100]);
    }

    function pickImages(proj) {
        var out = [];
        var audio = null;
        var sel = proj.selection || [];
        for (var i = 0; i < sel.length; i++) {
            var it = sel[i];
            if (!(it instanceof FootageItem)) continue;
            if (it.hasVideo && it.width > 0) out.push(it);
            else if (it.hasAudio && !audio) audio = it;
        }
        return { images: out, audio: audio };
    }

    // ============================================================
    //  ФОН (экранные координаты, двигается с параллаксом)
    // ============================================================
    function buildBackground(folder) {
        var c = app.project.items.addComp(uniqueName(CFG.name + " BG"), 2600, 1600, 1, DUR, FPS);
        c.parentFolder = folder;
        solid(c, [0.035, 0.03, 0.028], "BG DARK");

        var sh = shapeLayer(c, "BG SHAPES");
        // колонны справа и тёмная стена сверху (сдвиг +340,+260 от кадра 1920x1080)
        rect(sh, "Pillar light edge", [340 + 1705, 260 + 640], [26, 1400], 0, [0.36, 0.34, 0.32]);
        rect(sh, "Pillar", [340 + 1610, 260 + 640], [200, 1400], 0, [0.16, 0.155, 0.15]);
        rect(sh, "Pillar 2", [340 + 1860, 260 + 640], [170, 1400], 0, [0.1, 0.095, 0.09]);
        rect(sh, "Top wall", [340 + 1600, 260 + 60], [900, 250], 0, [0.19, 0.18, 0.17]);
        rect(sh, "Gold line", [340 + 1600, 260 + 480], [12, 380], 0, [0.62, 0.45, 0.2]);
        ellipse(sh, "Planet top-right", [340 + 1560, 260 + 230], [300, 300], [0.62, 0.27, 0.12]);
        ellipse(sh, "Planet left", [340 + 230, 260 + 700], [560, 560], [0.72, 0.47, 0.18]);
        ellipse(sh, "Planet left glow", [340 + 230, 260 + 700], [700, 700], [0.35, 0.22, 0.1]);

        // рваные скалы поверх левой планеты
        var rocks = shapeLayer(c, "ROCKS");
        var R = [
            [340 + 250, 260 + 220, 900, 170, 35], [340 + 120, 260 + 430, 520, 120, -20],
            [340 + 180, 260 + 690, 260, 520, 0], [340 + 260, 260 + 1020, 700, 160, -30],
            [340 + 480, 260 + 60, 520, 90, 15]
        ];
        for (var i = 0; i < R.length; i++) {
            poly(rocks, "Rock " + (i + 1), rockShape(R[i][0], R[i][1], R[i][2], R[i][3], R[i][4], 34), [0.02, 0.018, 0.016]);
        }
        var grain = addFx(rocks, "ADBE Noise", "Grain");
        if (grain) setVal(grain, ["ADBE Noise-0001", "Amount of Noise", 1], 6, "Noise");
        return c;
    }

    // ============================================================
    //  ЛЕНДИНГ (1442x1400)
    // ============================================================
    function buildPage(folder) {
        var c = app.project.items.addComp(uniqueName(CFG.name + " PAGE"), 1442, 1400, 1, DUR, FPS);
        c.parentFolder = folder;
        var cx = 721;
        var sh = shapeLayer(c, "PAGE BG");
        rect(sh, "Page", [cx, 700], [1442, 1400], 60, [0.07, 0.07, 0.075]);
        // «фото зала» за заголовком: мягкое светлое пятно
        var glow = shapeLayer(c, "HERO GLOW");
        ellipse(glow, "Glow", [cx, 520], [700, 520], [0.55, 0.55, 0.56]);
        var gb = addFx(glow, "ADBE Gaussian Blur 2", "Blur");
        if (gb) setVal(gb, ["ADBE Gaussian Blur 2-0001", "Blurriness", 1], 160, "Blur");
        glow.transform.opacity.setValue(55);

        var white = [0.96, 0.96, 0.96];
        txt(c, CFG.pageBrand, 40, white, CFG.fonts.uiBold, [cx, 60]);
        txt(c, CFG.pageKicker, 34, white, CFG.fonts.heavy, [cx, 145]);
        txt(c, CFG.pageTitle, 230, white, CFG.fonts.heavy, [cx, 250]);
        txt(c, CFG.pageSub, 36, white, CFG.fonts.heavy, [cx, 400]);
        rect(sh, "Btn 1", [cx - 60, 485], [115, 28], 14, [0.85, 0.85, 0.85]);
        rect(sh, "Btn 2", [cx + 65, 485], [115, 28], 14, [0.85, 0.85, 0.85]);
        var px = [-213, -66, 65, 212];
        for (var i = 0; i < CFG.partners.length && i < 4; i++) {
            txt(c, CFG.partners[i], 22, white, CFG.fonts.uiBold, [cx + px[i], 670], "center", "Partner " + (i + 1));
        }
        txt(c, "Политика конфиденциальности  /  Публичная оферта  /  Условия акции", 16, [0.7, 0.7, 0.7], CFG.fonts.ui, [cx, 764]);
        var ix = [-206, -66, 81, 217];
        for (i = 0; i < 4; i++) rect(sh, "Icon " + (i + 1), [cx + ix[i], 818], [30, 30], 8, [0.85, 0.85, 0.85]);
        txt(c, CFG.footer, 18, [0.7, 0.7, 0.7], CFG.fonts.ui, [cx, 1300]);
        return c;
    }

    // ============================================================
    //  ТИКЕТ (720x290): рваная бумага, фото слева, крупное имя
    // ============================================================
    function buildTicket(folder, photo) {
        var c = app.project.items.addComp(uniqueName(CFG.name + " TICKET"), 720, 290, 1, DUR, FPS);
        c.parentFolder = folder;
        var sh = shapeLayer(c, "TICKET PAPER");
        poly(sh, "Paper", jaggedRect(360, 145, 700, 270, 40, 12), [0.9, 0.6, 0.2]);
        poly(sh, "Dark band", jaggedRect(470, 145, 420, 230, 30, 10), [0.12, 0.11, 0.1]);
        poly(sh, "Torn stripe", jaggedRect(250, 250, 300, 30, 20, 14), [0.95, 0.9, 0.78]);

        if (photo) {
            var p = c.layers.add(photo);
            p.name = "ARTIST PHOTO";
            fitInto(p, photo, 260, 270, true);
            p.transform.position.setValue([140, 145]);
            var mask = p.property("ADBE Mask Parade").addProperty("ADBE Mask Atom");
            var ms = new Shape();
            var hw = 130 / (p.transform.scale.value[0] / 100), hh = 135 / (p.transform.scale.value[1] / 100);
            var ax = photo.width / 2, ay = photo.height / 2;
            ms.vertices = [[ax - hw, ay - hh], [ax + hw, ay - hh], [ax + hw, ay + hh], [ax - hw, ay + hh]];
            ms.closed = true;
            mask.property("ADBE Mask Shape").setValue(ms);
            addFx(p, "ADBE Black&White", "B&W");
        } else {
            var ph = shapeLayer(c, "PHOTO PLACEHOLDER");
            rect(ph, "Photo", [140, 145], [250, 250], 0, [0.32, 0.3, 0.28]);
            txt(c, "ФОТО", 34, [0.6, 0.58, 0.55], CFG.fonts.uiBold, [140, 145]);
        }
        txt(c, CFG.ticketTop, 20, [0.95, 0.6, 0.2], CFG.fonts.heavy, [480, 38]);
        makeText(c, CFG.ticketName, {
            name: "TICKET NAME", size: 90, color: [0.96, 0.91, 0.8], fonts: CFG.fonts.heavy,
            width: 380, anchor: "center", pos: [480, 145]
        });
        txt(c, CFG.ticketSub, 14, [0.9, 0.88, 0.82], CFG.fonts.uiBold, [480, 252]);
        var grain = adjustment(c, "PAPER GRAIN");
        var n = addFx(grain, "ADBE Noise", "Grain");
        if (n) setVal(n, ["ADBE Noise-0001", "Amount of Noise", 1], 8, "Noise");
        return c;
    }

    // ============================================================
    //  ЧЕЛОВЕК (560x660): PNG из Project или заглушка-силуэт
    // ============================================================
    function buildPerson(folder, img) {
        var c = app.project.items.addComp(uniqueName(CFG.name + " PERSON"), 560, 660, 1, DUR, FPS);
        c.parentFolder = folder;
        if (img) {
            var p = c.layers.add(img);
            p.name = "PERSON PNG";
            fitInto(p, img, 560, 660, false);
            p.transform.position.setValue([280, 330]);
        } else {
            var sh = shapeLayer(c, "PERSON PLACEHOLDER");
            var skin = [0.86, 0.64, 0.5];
            ellipse(sh, "Hand R", [405, 530], [150, 165], skin);
            ellipse(sh, "Hand L", [95, 590], [130, 185], skin);
            ellipse(sh, "Head", [285, 225], [285, 390], skin);
            ellipse(sh, "Hair", [285, 95], [300, 170], [0.3, 0.18, 0.1]);
            txt(c, "ЗАМЕНИ НА PNG\nЧЕЛОВЕКА", 26, [0.2, 0.12, 0.08], CFG.fonts.uiBold, [285, 250]);
        }
        return c;
    }

    // ============================================================
    //  КАРТОЧКА СО СХЕМОЙ ЗАЛА (1345x786), без человека
    // ============================================================
    function buildCard(folder) {
        var c = app.project.items.addComp(uniqueName(CFG.name + " CARD"), 1345, 786, 1, DUR, FPS);
        c.parentFolder = folder;
        var ox = 672.5, oy = 393;       // центр карточки = мировой (0,0)
        var ink = [0.2, 0.2, 0.22];
        var gray = [0.55, 0.55, 0.57];
        var sh = shapeLayer(c, "CARD UI");
        rect(sh, "Header line", [ox, oy - 298], [1345, 2], 0, [0.88, 0.88, 0.87]);
        rect(sh, "Price 1 line", [ox + 80, oy - 316], [70, 4], 2, [0.3, 0.8, 0.7]);
        rect(sh, "Price 2 line", [ox + 143, oy - 316], [66, 4], 2, [0.9, 0.12, 0.12]);
        rect(sh, "Badge", [ox - 639, oy - 272], [44, 32], 6, [0.1, 0.14, 0.24]);
        rect(sh, "Zoom +H", [ox + 622, oy - 247], [22, 3], 1, [0.2, 0.45, 0.95]);
        rect(sh, "Zoom +V", [ox + 622, oy - 247], [3, 22], 1, [0.2, 0.45, 0.95]);
        rect(sh, "Zoom -", [ox + 622, oy - 202], [22, 3], 1, [0.75, 0.75, 0.75]);
        rect(sh, "Blur text", [ox - 600, oy + 379], [90, 10], 5, [0.75, 0.75, 0.75]);
        var bg = shapeLayer(c, "CARD BG");
        rect(bg, "Card", [ox, oy], [1345, 786], 40, [0.965, 0.96, 0.95]);
        bg.moveToEnd();

        txt(c, CFG.date + "   •   " + CFG.event, 21, ink, CFG.fonts.uiBold, [ox - 652, oy - 374], "leftMid", "HEADER");
        txt(c, CFG.venue, 16, gray, CFG.fonts.ui, [ox + 606, oy - 374], "center", "VENUE");
        txt(c, CFG.price1, 17, ink, CFG.fonts.ui, [ox + 80, oy - 334], "center", "PRICE 1");
        txt(c, CFG.price2, 17, [0.85, 0.15, 0.15], CFG.fonts.ui, [ox + 143, oy - 334], "center", "PRICE 2");
        txt(c, "16+", 18, [1, 1, 1], CFG.fonts.uiBold, [ox - 639, oy - 272], "center", "16+");
        txt(c, "Помощь зрителю", 16, [0.3, 0.45, 0.8], CFG.fonts.ui, [ox + 579, oy + 372], "center", "HELP");
        var L = [["A", 0, -195], ["B", 263, 26], ["C", -2, 252], ["D", -272, 26]];
        for (var i = 0; i < L.length; i++) txt(c, L[i][0], 34, [0.62, 0.62, 0.64], CFG.fonts.uiBold, [ox + L[i][1], oy + L[i][2]], "center", "SECTOR " + L[i][0]);
        return c;
    }

    // схема стадиона («лист», который держит человек), 520x480
    function buildMap(folder) {
        var c = app.project.items.addComp(uniqueName(CFG.name + " MAP"), 520, 480, 1, DUR, FPS);
        c.parentFolder = folder;
        var sh = shapeLayer(c, "MAP");
        rect(sh, "Stage dot", [260, 232], [14, 14], 7, [0.9, 0.1, 0.8]);
        ellipse(sh, "Stage", [260, 240], [86, 86], [0.86, 0.86, 0.86]);
        rect(sh, "Inner field", [260, 240], [212, 146], 26, [0.95, 0.95, 0.94], [0.84, 0.84, 0.84], 8);
        rect(sh, "Ring", [260, 240], [330, 270], 70, null, [0.88, 0.88, 0.87], 10);
        rect(sh, "Stand", [260, 240], [462, 400], 120, [0.975, 0.975, 0.97]);
        txt(c, "СЦЕНА", 17, [0.35, 0.35, 0.37], CFG.fonts.uiBold, [260, 252], "center", "STAGE");
        return c;
    }

    // ============================================================
    //  ГЛАВНЫЙ КОМП И КАМЕРА
    // ============================================================
    function main() {
        if (!app.project) app.newProject();
        var proj = app.project;
        var picked = pickImages(proj);
        var personImg = picked.images.length > 0 ? picked.images[0] : null;
        var artistImg = picked.images.length > 1 ? picked.images[1] : null;

        var folder = proj.items.addFolder(uniqueName(CFG.name + " parts"));
        var bgC = buildBackground(folder);
        var pageC = buildPage(folder);
        var ticketC = buildTicket(folder, artistImg);
        var personC = buildPerson(folder, personImg);
        var cardC = buildCard(folder);
        var mapC = buildMap(folder);

        var comp = proj.items.addComp(uniqueName(CFG.name), W, H, 1, DUR, FPS);
        comp.bgColor = [0, 0, 0];
        comp.motionBlur = true;
        comp.shutterAngle = 220;

        // камера мира: экран = позиция + масштаб * мир (мир: центр карточки = 0,0)
        var cam = comp.layers.addNull(DUR);
        cam.name = "CAMERA";
        cam.transform.anchorPoint.setValue([0, 0]);
        cam.transform.position.setValue([0, 0]);

        var bg = comp.layers.add(bgC);
        bg.name = "BACKGROUND";

        function world(item, name, pos, anchor) {
            var l = comp.layers.add(item);
            l.name = name;
            l.parent = cam;
            if (anchor) l.transform.anchorPoint.setValue(anchor);
            l.transform.position.setValue(pos);
            l.motionBlur = true;
            return l;
        }

        var page = world(pageC, "LANDING PAGE", [10, -1460]);
        dropShadow(page, 60, 20, 80);
        var card = world(cardC, "SEAT MAP CARD", [0, 0]);
        dropShadow(card, 55, 20, 90);
        var map = world(mapC, "STADIUM MAP", [-1, 28]);
        dropShadow(map, 35, 18, 60);
        var person = world(personC, "PERSON (head + hands)", [-45, -275]);
        var tone = addFx(person, "ADBE Brightness & Contrast 2", "Comic Contrast");
        if (tone) setVal(tone, ["ADBE Brightness & Contrast 2-0002", "Contrast", 2], 35, "Contrast");
        var sharp = addFx(person, "ADBE Unsharp Mask2", "Comic Sharpen");
        if (sharp) {
            setVal(sharp, ["ADBE Unsharp Mask2-0001", "Amount", 1], 180, "Sharpen Amount");
            setVal(sharp, ["ADBE Unsharp Mask2-0002", "Radius", 2], 2.5, "Sharpen Radius");
        }
        var ticket = world(ticketC, "TICKET", [67, -715], [360, 145]);
        dropShadow(ticket, 70, 16, 40);

        // ---- тайминг (секунды) ----
        // 0.0–1.4  крупно карточка, лёгкий дрейф
        // 1.4–3.0  отъезд и панорама вверх: общий план
        // 3.0–3.8  общий план, дрейф
        // 3.8–4.8  тикет слетает в руки, камера наезжает
        // 4.8–7.0  средний план, медленный наезд
        var cp = cam.transform.position;
        keyF(cp, [[sec(0), [938, 640]], [sec(1.4), [938, 609]], [sec(3.0), [933, 843]],
                  [sec(3.8), [933, 850]], [sec(4.8), [921, 658]], [sec(7), [921, 640]]]);
        var cs = cam.transform.scale;
        keyF(cs, [[sec(0), [104, 104]], [sec(1.4), [100, 100]], [sec(3.0), [48, 48]],
                  [sec(3.8), [48.5, 48.5]], [sec(4.8), [75.5, 75.5]], [sec(7), [79, 79]]]);
        easeAll(cp, 75, 75);
        easeAll(cs, 75, 75);

        var tp = ticket.transform.position;
        keyF(tp, [[sec(3.8), [67, -715]], [sec(4.8), [142, -61]]]);
        var tsc = ticket.transform.scale;
        keyF(tsc, [[sec(3.8), [100, 100]], [sec(4.35), [108, 108]], [sec(4.8), [84, 84]]]);
        keyF(rotZ(ticket), [[sec(3.8), 0], [sec(4.3), -9], [sec(4.8), -1]]);
        easeAll(tp, 80, 60);
        easeAll(tsc, 60, 60);
        easeAll(rotZ(ticket), 60, 60);

        // фон двигается медленнее мира (параллакс)
        bg.transform.anchorPoint.setValue([1300, 800]);
        setExpr(bg.transform.position, [
            'var c = thisComp.layer("CAMERA").transform;',
            'var p = c.position;',
            '[960 + 0.35 * (p[0] - 933), 540 + 0.35 * (p[1] - 843)];'
        ].join("\n"), "bg parallax");
        setExpr(bg.transform.scale, [
            'var s = thisComp.layer("CAMERA").transform.scale[0];',
            'var k = 100 + 0.3 * (s - 48);',
            '[k, k];'
        ].join("\n"), "bg zoom");

        // зерно и виньетка
        var fx = adjustment(comp, "GRADE");
        var n = addFx(fx, "ADBE Noise", "Grain");
        if (n) setVal(n, ["ADBE Noise-0001", "Amount of Noise", 1], 3, "Grain");

        // порядок сверху вниз
        var order = [fx, ticket, person, map, card, page, bg, cam];
        for (var i = order.length - 1; i >= 0; i--) order[i].moveToBeginning();

        if (picked.audio) {
            var al = comp.layers.add(picked.audio);
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

        var msg = "Готово! Комп «" + comp.name + "» собран (1920x1080, 7 с).\n\n";
        msg += personImg ? "Человек: " + personImg.name + "\n"
                         : "Человек: заглушка. Выдели PNG человека (голова + руки, прозрачный фон) в Project и запусти снова,\nили замени слой в прекомпе PERSON.\n";
        if (artistImg) msg += "Фото в тикете: " + artistImg.name + "\n";
        if (FONT_REPORT.length) msg += "\nШрифты:\n- " + FONT_REPORT.join("\n- ") + "\n";
        msg += "\nТексты меняются в блоке CFG в начале скрипта или прямо в прекомпах.";
        if (LOG.length) msg += "\n\nЗамечания:\n- " + LOG.join("\n- ");
        alert(msg, "Ticket Scene");
    }

    app.beginUndoGroup("Ticket Scene");
    try {
        main();
    } catch (err) {
        alert("Скрипт остановился с ошибкой:\n" + err.toString() + (err.line ? "\nстрока " + err.line : ""), "Ticket Scene");
    } finally {
        app.endUndoGroup();
    }
})();
