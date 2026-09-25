/*
 * REEL RECREATE — скрипт для Adobe After Effects (ExtendScript)
 *
 * Собирает вертикальный рилс 1080x1920 в стиле эдитов naughtyyjuan:
 *   - zoom-панчи и тряска камеры на каждый удар;
 *   - velocity (рывок скорости на удар и слоу-мо к следующему);
 *   - RGB-расслоение, Turbulent Displace и вспышки на DROP;
 *   - glow, контраст, зерно, виньетка;
 *   - 3D-текст, который влетает на первый DROP.
 *
 * Весь моушн завязан на маркеры слоя BEAT CONTROL. Двигаешь маркеры, и всё
 * перестраивается под твой трек. Маркер с комментарием DROP — сильный удар.
 * Силу каждого эффекта крутишь слайдерами на том же слое.
 *
 * КАК ЗАПУСТИТЬ
 *   1. В панели Project выдели своё видео (и, если есть, трек .mp3/.wav).
 *      Ничего не выделил — будет заглушка, моушн всё равно видно.
 *   2. File > Scripts > Run Script File...  (Файл > Сценарии > Запустить файл сценария...)
 *   3. Выбери этот файл. Готовый комп откроется сам, жми пробел.
 *
 * Работает без сторонних плагинов, только на встроенных эффектах AE.
 */

(function reelRecreate() {

    // ======================= НАСТРОЙКИ =======================
    var CFG = {
        compName:      "REEL_RECREATE",
        width:         1080,
        height:        1920,
        fps:           30,
        maxDuration:   15,      // максимум секунд, если футаж или трек длиннее
        noFootageDur:  12,      // длина ролика, если футаж не выбран

        // --- ритм: подгони под свой трек ---
        bpm:           140,
        firstBeat:     0.0,     // секунда первого удара в треке
        beatEvery:     1,       // маркер на каждый удар (2 = через один)
        dropEvery:     8,       // каждый N-й маркер = DROP (сильный удар + вспышка)

        // --- сила эффектов (потом крутится слайдерами на слое BEAT CONTROL) ---
        punch:         6,       // зум на удар, %
        punchDecay:    9,       // как быстро зум возвращается
        shake:         22,      // тряска, px
        shakeRotation: 1.2,     // тряска поворотом, градусы
        shakeDecay:    7,
        rgbSplit:      14,      // RGB-расслоение, px
        distort:       40,      // Turbulent Displace на DROP
        flash:         65,      // вспышка на DROP, %
        velocity:      70,      // velocity: рывок скорости на удар, %

        overscan:      1.1,     // запас по краям, чтобы тряска не открывала чёрные края

        // --- текст ---
        title:         "YOUNG YANNY",
        subtitle:      "@young.yanny",
        font:          "Arial-BoldMT",
        titleSize:     150,
        subtitleSize:  54,
        accent:        [0.62, 1.0, 0.25],   // кислотно-зелёный

        renderNow:     false    // true = сразу отрендерить .mp4 на рабочий стол
    };
    // =========================================================

    var W = CFG.width;
    var H = CFG.height;
    var LOG = [];

    function warn(msg) {
        LOG.push(msg);
    }

    // Ищет свойство по списку ключей: matchName, английское имя, индекс.
    // Так скрипт работает и в русской, и в английской версии AE.
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

    function keyAll(prop, pairs) {
        for (var i = 0; i < pairs.length; i++) {
            prop.setValueAtTime(pairs[i][0], pairs[i][1]);
        }
    }

    // Резкий ease: быстрый старт, мягкая посадка. Число измерений
    // у свойств разное, поэтому пробуем 1, 2 и 3.
    function ease(prop, inInf, outInf) {
        if (!prop) return;
        for (var k = 1; k <= prop.numKeys; k++) {
            for (var n = 1; n <= 3; n++) {
                var a = [];
                var b = [];
                for (var j = 0; j < n; j++) {
                    a.push(new KeyframeEase(0, inInf));
                    b.push(new KeyframeEase(0, outInf));
                }
                try {
                    prop.setTemporalEaseAtKey(k, a, b);
                    break;
                } catch (e) {}
            }
        }
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

    function pickSources(proj) {
        var video = null;
        var audio = null;
        var sel = proj.selection || [];
        for (var i = 0; i < sel.length; i++) {
            var it = sel[i];
            if (it instanceof CompItem) {
                if (!video) video = it;
            } else if (it instanceof FootageItem) {
                var isSolid = false;
                try { isSolid = it.mainSource instanceof SolidSource; } catch (e) {}
                if (isSolid) continue;
                if (it.hasVideo) {
                    if (!video) video = it;
                } else if (it.hasAudio) {
                    if (!audio) audio = it;
                }
            }
        }
        return { video: video, audio: audio };
    }

    // ---------------- выражения ----------------
    // Общая шапка: где мы относительно последнего маркера BEAT CONTROL.
    var HEADER = [
        'var C = thisComp.layer("BEAT CONTROL");',
        'var M = C.marker;',
        'function lastIdx(t) {',
        '    if (M.numKeys == 0) return 0;',
        '    var n = M.nearestKey(t).index;',
        '    if (M.key(n).time > t) n--;',
        '    return n;',
        '}',
        'var bi = lastIdx(time);',
        'var dt = bi > 0 ? time - M.key(bi).time : 100000;',
        'var isDrop = bi > 0 && String(M.key(bi).comment).toUpperCase() == "DROP";',
        'function env(decay) { return Math.exp(-decay * dt); }',
        'function ctl(name) { return C.effect(name)(1); }',
        ''
    ].join("\n");

    var EXPR = {
        camScale: HEADER + [
            'var k = ctl("Punch") / 100 * env(ctl("Punch Decay")) * (isDrop ? 2 : 1);',
            '[value[0] * (1 + k), value[1] * (1 + k)];'
        ].join("\n"),

        camPosition: HEADER + [
            'var a = ctl("Shake") * env(ctl("Shake Decay")) * (isDrop ? 1.8 : 1);',
            'wiggle(18, a);'
        ].join("\n"),

        camRotation: HEADER + [
            'var a = ctl("Shake Rotation") * env(ctl("Shake Decay")) * (isDrop ? 2 : 1);',
            'wiggle(12, a);'
        ].join("\n"),

        // velocity: на ударе скорость ~x2.4, к следующему удару замедляется.
        // На маркерах время совпадает с оригиналом, поэтому синк не уезжает.
        velocity: HEADER + [
            'var v = ctl("Velocity") / 100;',
            'var out = time;',
            'if (bi > 0 && v > 0) {',
            '    var t0 = M.key(bi).time;',
            '    var t1 = bi < M.numKeys ? M.key(bi + 1).time : t0 + (bi > 1 ? t0 - M.key(bi - 1).time : 0.5);',
            '    var L = t1 - t0;',
            '    if (L > 0 && time < t1) {',
            '        var p = (time - t0) / L;',
            '        var f = 1 - Math.pow(1 - p, 3);',
            '        out = t0 + L * (p + (f - p) * v * (isDrop ? 1 : 0.6));',
            '    }',
            '}',
            'Math.max(0, Math.min(out, thisLayer.source.duration - thisComp.frameDuration));'
        ].join("\n"),

        rgbRed: HEADER + [
            'var s = ctl("RGB Split") * (0.12 + env(8) * (isDrop ? 1.6 : 1));',
            '[value[0] - s, value[1] + s * 0.25];'
        ].join("\n"),

        rgbBlue: HEADER + [
            'var s = ctl("RGB Split") * (0.12 + env(8) * (isDrop ? 1.6 : 1));',
            '[value[0] + s, value[1] - s * 0.25];'
        ].join("\n"),

        distortAmount: HEADER + 'ctl("Distort") * env(6) * (isDrop ? 1 : 0.2);',

        distortEvolution: 'time * 400;',

        flash: HEADER + 'ctl("Flash") * (isDrop ? env(9) : 0.18 * env(18));',

        glowPulse: HEADER + 'value * (1 + (isDrop ? 1.2 : 0.3) * env(5));',

        titleFlicker: HEADER + [
            'var fl = (isDrop && dt < 0.25 && Math.floor(time / thisComp.frameDuration) % 2 == 1) ? 0.3 : 1;',
            'value * fl;'
        ].join("\n")
    };

    // ---------------- сборка ----------------

    function buildFootageSource(src, video) {
        var still = false;
        if (video instanceof FootageItem) {
            try { still = video.mainSource.isStill; } catch (e) {}
        }
        var fl = src.layers.add(video);
        fl.name = "FOOTAGE";
        var s = Math.max(W / video.width, H / video.height) * 100;
        fl.transform.scale.setValue([s, s]);
        fl.transform.position.setValue([W / 2, H / 2]);
        try { fl.audioEnabled = false; } catch (e) {}

        // Видео короче трека: зацикливаем, чтобы не было чёрного хвоста.
        if (!still && video.duration < src.duration - 0.01) {
            try {
                fl.timeRemapEnabled = true;
                setExpr(fl.property("ADBE Time Remapping"), 'loopOut("cycle");', "loop footage");
                fl.outPoint = src.duration;
            } catch (e) {
                warn("не удалось зациклить футаж: " + e.toString());
            }
        }
    }

    function addShapeGroup(layer) {
        var grp = layer.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group");
        return grp.property("ADBE Vectors Group");
    }

    // Заглушка, если своё видео не выбрано: градиент, полосы, кольцо
    // и летающая точка, чтобы был виден весь моушн.
    function buildPlaceholder(src) {
        var a = CFG.accent;
        var bg = src.layers.addSolid([0.05, 0.05, 0.07], "PH BG", W, H, 1, src.duration);
        var ramp = addFx(bg, "ADBE Ramp", "Gradient");
        if (ramp) {
            setVal(ramp, ["ADBE Ramp-0001", "Start of Ramp", 1], [W / 2, 0], "Ramp start");
            setVal(ramp, ["ADBE Ramp-0002", "Start Color", 2], [a[0] * 0.18, a[1] * 0.18, a[2] * 0.18, 1], "Ramp color A");
            setVal(ramp, ["ADBE Ramp-0003", "End of Ramp", 3], [W / 2, H], "Ramp end");
            setVal(ramp, ["ADBE Ramp-0004", "End Color", 4], [0.01, 0.01, 0.02, 1], "Ramp color B");
        }

        try {
            var st = src.layers.addShape();
            st.name = "PH STRIPES";
            var v1 = addShapeGroup(st);
            var rect = v1.addProperty("ADBE Vector Shape - Rect");
            rect.property("ADBE Vector Rect Size").setValue([46, 3200]);
            var fill = v1.addProperty("ADBE Vector Graphic - Fill");
            fill.property("ADBE Vector Fill Color").setValue([a[0], a[1], a[2], 1]);
            fill.property("ADBE Vector Fill Opacity").setValue(22);
            var rep = v1.addProperty("ADBE Vector Filter - Repeater");
            rep.property("ADBE Vector Repeater Copies").setValue(18);
            rep.property("ADBE Vector Repeater Offset").setValue(-8.5);
            rep.property("ADBE Vector Repeater Transform").property("ADBE Vector Repeater Position").setValue([130, 0]);
            st.transform.position.setValue([W / 2, H / 2]);
            st.transform.rotation.setValue(20);
            st.transform.rotation.expression = "value + time * 18;";
        } catch (e) {
            warn("заглушка, полосы: " + e.toString());
        }

        try {
            var ring = src.layers.addShape();
            ring.name = "PH RING";
            var v2 = addShapeGroup(ring);
            var el = v2.addProperty("ADBE Vector Shape - Ellipse");
            el.property("ADBE Vector Ellipse Size").setValue([760, 760]);
            var stroke = v2.addProperty("ADBE Vector Graphic - Stroke");
            stroke.property("ADBE Vector Stroke Color").setValue([1, 1, 1, 1]);
            stroke.property("ADBE Vector Stroke Width").setValue(14);
            ring.transform.position.setValue([W / 2, H * 0.46]);
            ring.transform.scale.expression = "var s = 100 + 6 * Math.sin(time * 5);\n[s, s];";
        } catch (e) {
            warn("заглушка, кольцо: " + e.toString());
        }

        try {
            var dot = src.layers.addShape();
            dot.name = "PH ORBIT";
            var v3 = addShapeGroup(dot);
            var d = v3.addProperty("ADBE Vector Shape - Ellipse");
            d.property("ADBE Vector Ellipse Size").setValue([120, 120]);
            var dfill = v3.addProperty("ADBE Vector Graphic - Fill");
            dfill.property("ADBE Vector Fill Color").setValue([a[0], a[1], a[2], 1]);
            dot.transform.position.expression =
                "[" + (W / 2) + " + 380 * Math.cos(time * 2.2), " + (H * 0.46) + " + 380 * Math.sin(time * 2.2)];";
            dot.motionBlur = true;
        } catch (e) {
            warn("заглушка, точка: " + e.toString());
        }

        var hint = makeText(src, "ПОСТАВЬ СЮДА СВОЁ ВИДЕО", 44, [1, 1, 1], "PH HINT", [W / 2, H * 0.86], 80);
        hint.transform.opacity.setValue(55);
        src.motionBlur = true;
    }

    function makeText(comp, str, size, color, name, pos, tracking) {
        var tl = comp.layers.addText(str);
        tl.name = name;
        var tp = tl.property("ADBE Text Properties").property("ADBE Text Document");
        var doc = tp.value;
        try { doc.resetCharStyle(); } catch (e) {}
        doc.text = str;
        doc.fontSize = size;
        doc.applyFill = true;
        doc.fillColor = color;
        doc.applyStroke = false;
        doc.tracking = tracking || 0;
        try {
            doc.font = CFG.font;
        } catch (e) {
            warn("шрифт " + CFG.font + " не найден, стоит шрифт по умолчанию");
        }
        doc.justification = ParagraphJustification.CENTER_JUSTIFY;
        tp.setValue(doc);

        var r = tl.sourceRectAtTime(0, false);
        tl.transform.anchorPoint.setValue([r.left + r.width / 2, r.top + r.height / 2]);
        tl.transform.position.setValue(pos);
        tl.motionBlur = true;
        return tl;
    }

    function addTracking(tl, pairs) {
        try {
            var an = tl.property("ADBE Text Properties").property("ADBE Text Animators").addProperty("ADBE Text Animator");
            an.name = "Tracking";
            var trk = an.property("ADBE Text Animator Properties").addProperty("ADBE Text Tracking Amount");
            keyAll(trk, pairs);
            ease(trk, 50, 85);
        } catch (e) {
            warn("анимация трекинга: " + e.toString());
        }
    }

    function buildBeatControl(comp) {
        var dur = comp.duration;
        var ctrl = comp.layers.addNull(dur);
        ctrl.name = "BEAT CONTROL";

        var sliders = [
            ["Punch", CFG.punch],
            ["Punch Decay", CFG.punchDecay],
            ["Shake", CFG.shake],
            ["Shake Rotation", CFG.shakeRotation],
            ["Shake Decay", CFG.shakeDecay],
            ["RGB Split", CFG.rgbSplit],
            ["Distort", CFG.distort],
            ["Flash", CFG.flash],
            ["Velocity", CFG.velocity]
        ];
        for (var i = 0; i < sliders.length; i++) {
            var fx = addFx(ctrl, "ADBE Slider Control", sliders[i][0]);
            if (fx) setVal(fx, ["ADBE Slider Control-0001", 1], sliders[i][1], sliders[i][0]);
        }

        var markers = ctrl.property("ADBE Marker");
        var step = 60 / CFG.bpm * CFG.beatEvery;
        var beats = [];
        var drops = [];
        for (var b = 0; b < 10000; b++) {
            var t = Math.round((CFG.firstBeat + b * step) * CFG.fps) / CFG.fps;
            if (t > dur - 0.05) break;
            var isDrop = (b % CFG.dropEvery === 0);
            markers.setValueAtTime(t, new MarkerValue(isDrop ? "DROP" : ""));
            beats.push(t);
            if (isDrop) drops.push(t);
        }
        return { layer: ctrl, beats: beats, drops: drops };
    }

    function addAdjustment(comp, name) {
        var l = comp.layers.addSolid([1, 1, 1], name, W, H, 1, comp.duration);
        l.adjustmentLayer = true;
        return l;
    }

    function addVignette(comp) {
        var v = comp.layers.addSolid([0, 0, 0], "VIGNETTE", W, H, 1, comp.duration);
        try {
            var mask = v.property("ADBE Mask Parade").addProperty("ADBE Mask Atom");
            var cx = W / 2, cy = H / 2, rx = W * 0.62, ry = H * 0.56, k = 0.5523;
            var sh = new Shape();
            sh.vertices = [[cx, cy - ry], [cx + rx, cy], [cx, cy + ry], [cx - rx, cy]];
            sh.inTangents = [[-k * rx, 0], [0, -k * ry], [k * rx, 0], [0, k * ry]];
            sh.outTangents = [[k * rx, 0], [0, k * ry], [-k * rx, 0], [0, -k * ry]];
            sh.closed = true;
            mask.property("ADBE Mask Shape").setValue(sh);
            mask.property("ADBE Mask Feather").setValue([420, 420]);
            mask.inverted = true;
        } catch (e) {
            warn("виньетка: " + e.toString());
        }
        v.transform.opacity.setValue(60);
        return v;
    }

    function main() {
        if (!CFG.bpm || CFG.bpm <= 0) throw new Error("bpm должен быть больше нуля");
        if (!app.project) app.newProject();
        var proj = app.project;

        var picked = pickSources(proj);
        var video = picked.video;
        var audio = picked.audio;
        var videoIsStill = false;
        if (video && video instanceof FootageItem) {
            try { videoIsStill = video.mainSource.isStill; } catch (e) {}
        }

        var dur = CFG.noFootageDur;
        if (audio) dur = audio.duration;
        else if (video && !videoIsStill) dur = video.duration;
        dur = Math.min(dur, CFG.maxDuration);
        if (!(dur > 0.5)) dur = CFG.noFootageDur;
        var fd = 1 / CFG.fps;

        var folder = proj.items.addFolder(uniqueName(CFG.compName + " parts"));

        // 1. SOURCE: футаж или заглушка во весь кадр 1080x1920
        var src = proj.items.addComp(uniqueName(CFG.compName + " SOURCE"), W, H, 1, dur, CFG.fps);
        src.parentFolder = folder;
        if (video) buildFootageSource(src, video);
        else buildPlaceholder(src);

        // 2. Главный комп
        var comp = proj.items.addComp(uniqueName(CFG.compName), W, H, 1, dur, CFG.fps);
        comp.bgColor = [0, 0, 0];
        comp.motionBlur = true;

        var beat = buildBeatControl(comp);
        var ctrl = beat.layer;

        var bg = comp.layers.addSolid([0, 0, 0], "BG", W, H, 1, dur);
        var cam = comp.layers.addNull(dur);
        cam.name = "CAM";

        // 3. Три копии SOURCE: R, G и B по отдельности, режим Add.
        //    Вместе дают обычную картинку, раздвинутые дают RGB-расслоение.
        //    Значения Shift Channels: 2 = Red, 3 = Green, 4 = Blue, 11 = Off.
        var channels = [
            ["SRC B", 11, 11, 4],
            ["SRC G", 11, 3, 11],
            ["SRC R", 2, 11, 11]
        ];
        var srcLayers = [];
        var rgbOk = true;
        for (var i = 0; i < channels.length; i++) {
            var L = comp.layers.add(src);
            L.name = channels[i][0];
            var sc = addFx(L, "ADBE Shift Channels", "Channel " + channels[i][0].charAt(4));
            if (!sc ||
                !setVal(sc, ["ADBE Shift Channels-0002", "Take Red From", 2], channels[i][1], "Take Red From") ||
                !setVal(sc, ["ADBE Shift Channels-0003", "Take Green From", 3], channels[i][2], "Take Green From") ||
                !setVal(sc, ["ADBE Shift Channels-0004", "Take Blue From", 4], channels[i][3], "Take Blue From")) {
                rgbOk = false;
            }
            L.blendingMode = BlendingMode.ADD;
            L.motionBlur = true;
            srcLayers.push(L);
        }
        if (!rgbOk) {
            // Без Shift Channels оставляем одну обычную копию, иначе картинка пересветится.
            warn("RGB-расслоение выключено: не удалось настроить Shift Channels");
            srcLayers[2].remove();
            srcLayers[1].remove();
            srcLayers = [srcLayers[0]];
            srcLayers[0].name = "SRC";
            srcLayers[0].blendingMode = BlendingMode.NORMAL;
            try { srcLayers[0].property("ADBE Effect Parade").property(1).remove(); } catch (e) {}
        }
        for (i = 0; i < srcLayers.length; i++) srcLayers[i].parent = cam;

        // 4. Текст
        var drops = beat.drops;
        var ti = drops.length > 1 ? drops[1] : Math.min(1, dur * 0.3);
        if (ti > dur - 1.5) ti = Math.max(0, dur * 0.3);

        var titleY = H * 0.46;
        var title = makeText(comp, CFG.title, CFG.titleSize, [1, 1, 1], "TITLE", [W / 2, titleY], 0);
        var sub = makeText(comp, CFG.subtitle, CFG.subtitleSize, CFG.accent, "SUBTITLE", [W / 2, titleY + CFG.titleSize * 0.9], 0);
        title.parent = cam;
        sub.parent = cam;

        title.threeDLayer = true;
        var tOp = title.transform.opacity;
        keyAll(tOp, [[Math.max(0, ti - fd), 0], [ti, 100], [dur - 0.35, 100], [dur - 0.1, 0]]);
        setExpr(tOp, EXPR.titleFlicker, "title flicker");
        var tSc = title.transform.scale;
        keyAll(tSc, [[ti, [175, 175, 175]], [ti + 0.16, [96, 96, 96]], [ti + 0.3, [100, 100, 100]]]);
        ease(tSc, 40, 90);
        var tRy = title.transform.property("ADBE Rotate Y");
        if (tRy) {
            keyAll(tRy, [[ti, 40], [ti + 0.45, 0]]);
            ease(tRy, 60, 90);
        }
        addTracking(title, [[ti, 70], [ti + 0.3, 8], [dur, 24]]);

        var sOp = sub.transform.opacity;
        keyAll(sOp, [[ti + 0.3, 0], [ti + 0.5, 100], [dur - 0.35, 100], [dur - 0.1, 0]]);
        var sPos = sub.transform.position;
        var p0 = sPos.value;
        var pUp = [];
        for (i = 0; i < p0.length; i++) pUp.push(p0[i]);
        pUp[1] += 60;
        keyAll(sPos, [[ti + 0.3, pUp], [ti + 0.65, p0]]);
        ease(sPos, 60, 85);
        addTracking(sub, [[ti + 0.3, 300], [ti + 0.9, 120]]);

        // 5. Эффекты поверх
        var distort = addAdjustment(comp, "FX DISTORT");
        var td = addFx(distort, "ADBE Turbulent Displace", "Turbulent Displace");
        if (td) {
            setVal(td, ["ADBE Turbulent Displace-0003", "Size", 3], 90, "Turbulent Displace Size");
            setExpr(getProp(td, ["ADBE Turbulent Displace-0002", "Amount", 2]), EXPR.distortAmount, "distort amount");
            setExpr(getProp(td, ["ADBE Turbulent Displace-0006", "Evolution", 6]), EXPR.distortEvolution, "distort evolution");
        }

        var vignette = addVignette(comp);

        var grade = addAdjustment(comp, "FX GRADE");
        var bc = addFx(grade, "ADBE Brightness & Contrast 2", "Contrast");
        if (bc) setVal(bc, ["ADBE Brightness & Contrast 2-0002", "Contrast", 2], 18, "Contrast");
        var vib = addFx(grade, "ADBE Vibrance", "Vibrance");
        if (vib) setVal(vib, ["ADBE Vibrance-0001", "Vibrance", 1], 25, "Vibrance");
        var glow = addFx(grade, "ADBE Glo2", "Glow");
        if (glow) {
            setVal(glow, ["ADBE Glo2-0002", "Glow Threshold", 2], 62, "Glow Threshold");
            setVal(glow, ["ADBE Glo2-0003", "Glow Radius", 3], 60, "Glow Radius");
            var gi = setVal(glow, ["ADBE Glo2-0004", "Glow Intensity", 4], 0.7, "Glow Intensity");
            if (gi) setExpr(gi, EXPR.glowPulse, "glow pulse");
        }
        var noise = addFx(grade, "ADBE Noise", "Grain");
        if (noise) {
            setVal(noise, ["ADBE Noise-0001", "Amount of Noise", 1], 3, "Noise Amount");
            setVal(noise, ["ADBE Noise-0002", "Noise Type", 2], 0, "Noise Color");
        }

        var flash = comp.layers.addSolid([1, 1, 1], "FLASH", W, H, 1, dur);
        flash.blendingMode = BlendingMode.ADD;
        setExpr(flash.transform.opacity, EXPR.flash, "flash");

        // 6. Порядок слоёв сверху вниз
        var order = [ctrl, flash, grade, vignette, distort, title, sub, cam];
        for (i = srcLayers.length - 1; i >= 0; i--) order.push(srcLayers[i]);
        order.push(bg);
        for (i = order.length - 1; i >= 0; i--) order[i].moveToBeginning();

        // 7. Камера и velocity: включаются после родителей, чтобы привязка
        //    не «запекла» тряску в позиции слоёв.
        cam.transform.scale.setValue([CFG.overscan * 100, CFG.overscan * 100]);
        setExpr(cam.transform.scale, EXPR.camScale, "punch zoom");
        setExpr(cam.transform.position, EXPR.camPosition, "shake");
        setExpr(cam.transform.rotation, EXPR.camRotation, "shake rotation");

        for (i = 0; i < srcLayers.length; i++) {
            var S = srcLayers[i];
            if (S.name === "SRC R") setExpr(S.transform.position, EXPR.rgbRed, "rgb red");
            if (S.name === "SRC B") setExpr(S.transform.position, EXPR.rgbBlue, "rgb blue");
            try {
                S.timeRemapEnabled = true;
                setExpr(S.property("ADBE Time Remapping"), EXPR.velocity, "velocity");
                S.outPoint = dur;
            } catch (e) {
                warn("velocity: " + e.toString());
            }
        }

        // 8. Звук
        if (audio) {
            var al = comp.layers.add(audio);
            al.name = "MUSIC";
            al.moveToEnd();
        } else if (video && video.hasAudio && !videoIsStill) {
            var va = comp.layers.add(video);
            va.name = "ORIGINAL AUDIO";
            va.enabled = false;
            va.moveToEnd();
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

        var msg = "Готово! Комп «" + comp.name + "» собран.\n\n";
        msg += video ? "Футаж: " + video.name + "\n"
                     : "Своё видео не выбрано, стоит заглушка. Выдели видео в панели Project и запусти скрипт ещё раз.\n";
        if (audio) msg += "Музыка: " + audio.name + "\n";
        msg += "Маркеров-ударов: " + beat.beats.length + ", из них DROP: " + drops.length + "\n\n";
        msg += "Жми пробел для превью. Подгони маркеры на слое BEAT CONTROL под свой трек, " +
               "силу эффектов крути слайдерами на нём же.";
        if (LOG.length) msg += "\n\nЗамечания:\n- " + LOG.join("\n- ");
        alert(msg, "Reel Recreate");
    }

    app.beginUndoGroup("Reel Recreate");
    try {
        main();
    } catch (err) {
        alert("Скрипт остановился с ошибкой:\n" + err.toString() + (err.line ? "\nстрока " + err.line : ""), "Reel Recreate");
    } finally {
        app.endUndoGroup();
    }
})();
