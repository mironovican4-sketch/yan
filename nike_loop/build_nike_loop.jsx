#target aftereffects
/*
 * NIKE  ·  "Find your greatness."  ·  10-секундный бесшовный луп
 * ------------------------------------------------------------------
 * Сборщик проекта для After Effects (ExtendScript, AE CC 2018+).
 *
 * Запуск:  File > Scripts > Run Script File...  ->  build_nike_loop.jsx
 * Скрипт должен лежать рядом с папкой  assets/  (PNG кроссовок).
 *
 * Что строится (всё редактируемое — слои, ключи, контроллеры):
 *   NIKE_LOOP_MAIN          главная композиция 1920x1080, 30 fps, 10 s
 *     CONTROLS              null с Expression Controls (скорость полос, тряска, вспышки...)
 *     CAM_SHAKE             null — общая "камера", её wiggle читают слои мира
 *     01_INTRO              свуш выходит из темноты -> световой блик -> пролёт сквозь свуш
 *     02_STRIPES_BACK       радужные полосы за кроссовками (со всех сторон, loopOut)
 *     03_SNEAKERS           4 кроссовка в одном стиле: вылет, овершут, парение, уход
 *     05_STRIPES_FRONT      крупные полосы перед кроссовками (расфокус + motion blur)
 *     04_ENDCARD            радужная шторка -> "NIKE." -> "Find your greatness."
 *     FX_Vignette / FX_Grain / FADE_TO_BLACK / FX_Flash
 *
 * Кадр 0 и кадр 299 — чёрные, поэтому ролик зацикливается без шва.
 * Все тайминги — в блоке T, все цвета — в PALETTE, полосы — в STRIPES.
 */

(function nikeLoopBuilder() {

    // =====================================================================
    // 1. НАСТРОЙКИ
    // =====================================================================
    var CFG = {
        compName: "NIKE_LOOP_MAIN",
        width: 1920,
        height: 1080,
        fps: 30,
        duration: 10,
        seed: 1987,
        // первый установленный шрифт из списка будет использован (PostScript-имена)
        fonts: ["Futura-CondensedExtraBold", "FuturaPT-CondExtraBold", "FuturaStd-CondensedExtraBd",
                "Futura-ExtraBoldCondensed", "Anton-Regular", "Oswald-Bold", "Impact", "Arial-BoldMT"],
        sneakers: [
            { file: "sneaker_01_dunk.png", word: "DUNK" },
            { file: "sneaker_02_airmax.png", word: "AIR MAX" },
            { file: "sneaker_03_v2k.png", word: "V2K" },
            { file: "sneaker_04_cortez.png", word: "CORTEZ" }
        ],
        brand: "NIKE.",
        tagline: ["Find", "your", "greatness."]
    };

    // Тайминги (секунды). Этот же блок читает превью-рендер tools/render_preview.py
    var T = {
        swooshIn: 0.20,
        swooshSharp: 1.10,
        swooshRest: 1.50,
        sweepStart: 0.70,
        sweepEnd: 1.35,
        zoomStart: 1.50,
        zoomEnd: 1.95,
        worldIn: 1.80,
        burst: 1.93,
        shoeFirst: 1.90,
        shoeStep: 1.40,
        shoeArrive: 0.28,
        shoeSettle: 0.50,
        shoeLeave: 0.24,
        wipe: 7.45,
        wipeStagger: 0.035,
        wipeDur: 0.42,
        worldOut: 8.40,
        brandIn: 7.95,
        brandHit: 8.12,
        brandSettle: 8.25,
        tagIn: 8.20,
        tagStagger: 0.08,
        tagDur: 0.40,
        underline: 8.62,
        fadeStart: 9.25,
        fadeEnd: 9.93
    };

    // Радуга (0-255): red, orange, yellow, green, cyan, blue, violet, magenta
    var PALETTE = [
        [255, 45, 85],
        [255, 122, 0],
        [255, 212, 0],
        [34, 224, 107],
        [0, 212, 255],
        [47, 107, 255],
        [138, 63, 255],
        [255, 43, 214]
    ];

    var SWOOSH_COLOR = [245, 81, 30];

    // Полосы. dirs — направления полёта в градусах (0 = слева направо, 90 = сверху вниз)
    var STRIPES = {
        back: { count: 28, lenMin: 260, lenMax: 1160, thickMin: 8, thickMax: 42, speedMin: 2400, speedMax: 5400, gapMin: 0.25, gapMax: 1.35, blurMax: 0, opacity: 92 },
        front: { count: 6, lenMin: 700, lenMax: 1900, thickMin: 26, thickMax: 64, speedMin: 3600, speedMax: 6600, gapMin: 0.8, gapMax: 2.4, blurMax: 26, opacity: 85 },
        dirs: [0, 180, 90, 270, -18, 162, -18, 162, 18, 198],
        timeOffset: 6
    };

    // Вектор свуша (1000 px в ширину, центр в 0,0). Сверен с логотипом из брифа.
    var SWOOSH = {
        v: [[500, -175.02], [-231.59, 136.48], [-384.42, 175.02], [-485.97, 125.98], [-497.63, 46.06], [-454.47, -57.19],
            [-358.76, -173.86], [-391.42, -96.85], [-359.92, 12.81], [-295.76, 29.15], [-222.26, 18.65]],
        i: [[0, 0], [0, 0], [41.21, 0], [21, 32.71], [-5.42, 32.29], [-23.33, 36.58],
            [-44.38, 48.21], [6.58, -27.29], [-32.67, -23.33], [-27.25, 0], [-27.25, 7]],
        o: [[0, 0], [-60.67, 25.67], [-46.67, 0], [-13.21, -21], [5.42, -32.29], [19.46, -29.58],
            [-15.05, 23.69], [-11.67, 49.79], [15.54, 10.88], [21.75, 0], [0, 0]],
        heel: [-330, 97],   // точка "пролёта" камеры — самая толстая часть свуша
        restScale: 88
    };

    var W = CFG.width, H = CFG.height, CX = W / 2, CY = H / 2;
    var WARN = [];
    var MAIN_NAME = CFG.compName;
    var FONT = null;

    // =====================================================================
    // 2. ХЕЛПЕРЫ
    // =====================================================================
    function warn(msg) { WARN.push(msg); }
    function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
    function rgb(c) { return [c[0] / 255, c[1] / 255, c[2] / 255]; }
    function rgba(c) { return [c[0] / 255, c[1] / 255, c[2] / 255, 1]; }
    function pad4(n) { var s = "000" + n; return s.substr(s.length - 4); }
    function zeros(n) { var a = []; for (var i = 0; i < n; i++) a.push([0, 0]); return a; }
    function fmt(n) { return String(Math.round(n * 1000) / 1000); }

    var TP = { anchor: "ADBE Anchor Point", pos: "ADBE Position", scale: "ADBE Scale", rot: "ADBE Rotate Z", opacity: "ADBE Opacity" };
    function tr(layer, key) { return layer.property("ADBE Transform Group").property(TP[key]); }

    // Ссылки на контроллеры из выражений
    var CTRL_MAIN = 'thisComp.layer("CONTROLS")';
    function ctrlPre() { return 'comp("' + MAIN_NAME + '").layer("CONTROLS")'; }

    function easeDims(prop) {
        var t = prop.propertyValueType;
        if (t === PropertyValueType.TwoD) return 2;
        if (t === PropertyValueType.ThreeD) return 3;
        return 1;
    }

    // Ease у ключа: "L" = linear, [influenceIn, influenceOut] или [in, out, "linIn"|"linOut"]
    function applyEase(prop, k, spec) {
        var KIT = KeyframeInterpolationType;
        if (spec === "L") {
            prop.setInterpolationTypeAtKey(k, KIT.LINEAR, KIT.LINEAR);
            return;
        }
        var n = easeDims(prop), a = [], b = [];
        for (var j = 0; j < n; j++) {
            a.push(new KeyframeEase(0, clamp(spec[0], 0.1, 100)));
            b.push(new KeyframeEase(0, clamp(spec[1], 0.1, 100)));
        }
        prop.setTemporalEaseAtKey(k, a, b);
        if (spec[2] === "linIn") prop.setInterpolationTypeAtKey(k, KIT.LINEAR, KIT.BEZIER);
        if (spec[2] === "linOut") prop.setInterpolationTypeAtKey(k, KIT.BEZIER, KIT.LINEAR);
    }

    // Прямые пути между ключами позиции (без auto-bezier петель)
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

    function span(layer, tIn, tOut) {
        layer.inPoint = Math.max(0, tIn);
        layer.outPoint = Math.min(layer.containingComp.duration, tOut);
    }

    function newComp(name, dur, folder) {
        var c = app.project.items.addComp(name, W, H, 1, dur || CFG.duration, CFG.fps);
        c.parentFolder = folder;
        c.bgColor = [0, 0, 0];
        c.motionBlur = true;
        c.shutterAngle = 180;
        c.shutterPhase = -90;
        return c;
    }

    function solid(comp, name, color) {
        return comp.layers.addSolid(color, name, comp.width, comp.height, 1, comp.duration);
    }

    // ---------- эффекты ----------
    function fx(layer, matchName, name) {
        var e = layer.property("ADBE Effect Parade").addProperty(matchName);
        if (name) e.name = name;
        return e;   // ссылка валидна до добавления следующего эффекта на этот слой
    }
    function fxGet(layer, matchName) { return layer.property("ADBE Effect Parade").property(matchName); }
    function fxParam(effect, n) {
        var p = null;
        try { p = effect.property(effect.matchName + "-" + pad4(n)); } catch (e) { p = null; }
        if (!p) p = effect.property(n);
        return p;
    }
    function safe(label, fn) {
        try { fn(); } catch (e) { warn(label + ": " + e.toString()); }
    }

    function addBlur(layer, amount) {
        var e = fx(layer, "ADBE Gaussian Blur 2");
        fxParam(e, 1).setValue(amount);
    }
    function blurProp(layer) { return fxParam(fxGet(layer, "ADBE Gaussian Blur 2"), 1); }

    function slider(layer, name, v) { var e = fx(layer, "ADBE Slider Control", name); fxParam(e, 1).setValue(v); }
    function colorCtl(layer, name, c) { var e = fx(layer, "ADBE Color Control", name); fxParam(e, 1).setValue(c); }

    // ---------- шейпы (все обращения идут заново от слоя: AE инвалидирует старые ссылки) ----------
    function shapeLayer(comp, name) { var l = comp.layers.addShape(); l.name = name; return l; }
    function root(l) { return l.property("ADBE Root Vectors Group"); }
    function addGroup(l, name) {
        var g = root(l).addProperty("ADBE Vector Group");
        g.name = name;
        return root(l).numProperties;
    }
    function vecs(l, gi) { return root(l).property(gi).property("ADBE Vectors Group"); }
    function gxf(l, gi, mn) { return root(l).property(gi).property("ADBE Vector Transform Group").property(mn); }
    function addRect(l, gi, size, round) {
        var r = vecs(l, gi).addProperty("ADBE Vector Shape - Rect");
        r.property("ADBE Vector Rect Size").setValue(size);
        if (round) r.property("ADBE Vector Rect Roundness").setValue(round);
    }
    function addEllipse(l, gi, size) {
        var r = vecs(l, gi).addProperty("ADBE Vector Shape - Ellipse");
        r.property("ADBE Vector Ellipse Size").setValue(size);
    }
    function makeShape(verts, inT, outT, closed) {
        var s = new Shape();
        s.vertices = verts;
        s.inTangents = inT || zeros(verts.length);
        s.outTangents = outT || zeros(verts.length);
        s.closed = closed;
        return s;
    }
    function addPath(l, gi, shape) {
        var p = vecs(l, gi).addProperty("ADBE Vector Shape - Group");
        p.property("ADBE Vector Shape").setValue(shape);
    }
    function addFill(l, gi, c) {
        var f = vecs(l, gi).addProperty("ADBE Vector Graphic - Fill");
        f.property("ADBE Vector Fill Color").setValue(c);
    }
    function fillColor(l, gi) { return vecs(l, gi).property("ADBE Vector Graphic - Fill").property("ADBE Vector Fill Color"); }
    function addStroke(l, gi, c, w) {
        var s = vecs(l, gi).addProperty("ADBE Vector Graphic - Stroke");
        s.property("ADBE Vector Stroke Color").setValue(c);
        s.property("ADBE Vector Stroke Width").setValue(w);
        s.property("ADBE Vector Stroke Line Cap").setValue(2); // round
    }
    function strokeProp(l, gi, mn) { return vecs(l, gi).property("ADBE Vector Graphic - Stroke").property(mn); }
    function addTrim(l, gi) { vecs(l, gi).addProperty("ADBE Vector Filter - Trim"); }
    function trimProp(l, gi, mn) { return vecs(l, gi).property("ADBE Vector Filter - Trim").property(mn); }
    function addRepeater(l, gi, copies, rot) {
        var r = vecs(l, gi).addProperty("ADBE Vector Filter - Repeater");
        r.property("ADBE Vector Repeater Copies").setValue(copies);
        var t = r.property("ADBE Vector Repeater Transform");
        t.property("ADBE Vector Repeater Position").setValue([0, 0]);
        t.property("ADBE Vector Repeater Rotation").setValue(rot);
    }

    // ---------- маски ----------
    function ellipseShape(cx, cy, rx, ry) {
        var k = 0.5523;
        return makeShape(
            [[cx, cy - ry], [cx + rx, cy], [cx, cy + ry], [cx - rx, cy]],
            [[-rx * k, 0], [0, -ry * k], [rx * k, 0], [0, ry * k]],
            [[rx * k, 0], [0, ry * k], [-rx * k, 0], [0, -ry * k]],
            true);
    }
    function rectShape(x0, y0, x1, y1) { return makeShape([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], null, null, true); }
    function addMask(layer, shape, feather, inverted) {
        var m = layer.property("ADBE Mask Parade").addProperty("ADBE Mask Atom");
        m.property("ADBE Mask Shape").setValue(shape);
        if (feather) m.property("ADBE Mask Feather").setValue(feather);
        if (inverted) m.inverted = true;
    }

    // ---------- текст ----------
    function fontAvailable(ps) {
        try {
            if (app.fonts && app.fonts.getFontsByPostScriptName) {
                var r = app.fonts.getFontsByPostScriptName(ps);
                return !!(r && r.length);
            }
        } catch (e) { }
        var probe = app.project.items.addComp("__font_probe__", 100, 100, 1, 1, 30);
        var ok = false;
        try {
            var l = probe.layers.addText("A");
            var sp = l.property("ADBE Text Properties").property("ADBE Text Document");
            var td = sp.value;
            td.font = ps;
            sp.setValue(td);
            ok = (sp.value.font === ps);
        } catch (e2) { ok = false; }
        probe.remove();
        return ok;
    }
    function pickFont() {
        for (var i = 0; i < CFG.fonts.length; i++) if (fontAvailable(CFG.fonts[i])) return CFG.fonts[i];
        warn("None of the preferred fonts is installed - AE default font is used. Set any bold condensed font on the text layers.");
        return null;
    }

    // opts: { size, just: "L"|"C", fill: [r,g,b] | null, stroke: {color, width}, tracking }
    function makeText(comp, str, opts) {
        var l = comp.layers.addText(str);
        var sp = l.property("ADBE Text Properties").property("ADBE Text Document");
        var td = sp.value;
        try { td.resetCharStyle(); td.resetParagraphStyle(); } catch (e) { }
        if (FONT) td.font = FONT;
        td.fontSize = opts.size;
        td.justification = opts.just === "L" ? ParagraphJustification.LEFT_JUSTIFY : ParagraphJustification.CENTER_JUSTIFY;
        if (opts.fill) {
            td.applyFill = true;
            td.fillColor = opts.fill;
        } else {
            td.applyFill = false;
        }
        if (opts.stroke) {
            td.applyStroke = true;
            td.strokeColor = opts.stroke.color;
            td.strokeWidth = opts.stroke.width;
            td.strokeOverFill = true;
        } else {
            td.applyStroke = false;
        }
        td.tracking = opts.tracking || 0;
        sp.setValue(td);
        return l;
    }
    function centerAnchor(l) {
        var r = l.sourceRectAtTime(0, false);
        tr(l, "anchor").setValue([r.left + r.width / 2, r.top + r.height / 2]);
        return r;
    }

    function setTrackMatte(layer, matte) {
        if (typeof layer.setTrackMatte === "function") {
            layer.setTrackMatte(matte, TrackMatteType.ALPHA);
        } else {
            matte.moveBefore(layer);
            layer.trackMatteType = TrackMatteType.ALPHA;
        }
        matte.enabled = false;
    }

    function parentTo(child, parent, offset) {
        child.parent = parent;
        var a = tr(parent, "anchor").value;
        tr(child, "pos").setValue([a[0] + (offset ? offset[0] : 0), a[1] + (offset ? offset[1] : 0)]);
    }

    // Park-Miller PRNG — тот же генератор в превью, поэтому полосы совпадают
    function Rng(seed) {
        this.s = seed % 2147483647;
        if (this.s <= 0) this.s += 2147483646;
    }
    Rng.prototype.next = function () {
        this.s = (this.s * 16807) % 2147483647;
        return (this.s - 1) / 2147483646;
    };

    function genStripes(rng, P) {
        var out = [], R = Math.sqrt(W * W + H * H) / 2;
        for (var i = 0; i < P.count; i++) {
            var a = STRIPES.dirs[Math.floor(rng.next() * STRIPES.dirs.length)] + (rng.next() - 0.5) * 10;
            var len = P.lenMin + rng.next() * (P.lenMax - P.lenMin);
            var th = P.thickMin + rng.next() * (P.thickMax - P.thickMin);
            var col = PALETTE[Math.floor(rng.next() * PALETTE.length)];
            var speed = P.speedMin + rng.next() * (P.speedMax - P.speedMin);
            var gap = P.gapMin + rng.next() * (P.gapMax - P.gapMin);
            var lat = rng.next() - 0.5;
            var phase = rng.next();
            var blur = rng.next() * P.blurMax;
            var rad = a * Math.PI / 180, dx = Math.cos(rad), dy = Math.sin(rad), nx = -dy, ny = dx;
            var extent = Math.abs(nx) * W / 2 + Math.abs(ny) * H / 2;
            var cx = CX + nx * lat * 1.8 * extent, cy = CY + ny * lat * 1.8 * extent;
            var reach = R + len / 2 + 40;
            var dur = 2 * reach / speed, period = dur + gap;
            out.push({
                angle: a, len: len, thick: th, color: col, blur: blur,
                from: [cx - dx * reach, cy - dy * reach], to: [cx + dx * reach, cy + dy * reach],
                t0: phase * period, dur: dur, period: period
            });
        }
        return out;
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

    // =====================================================================
    // 3. СБОРКА
    // =====================================================================
    function findAssets() {
        var here = new File($.fileName).parent;
        var dir = new Folder(here.fsName + "/assets");
        if (!dir.exists) dir = Folder.selectDialog("Select the nike_loop/assets folder (sneaker PNGs)");
        if (!dir) return null;
        for (var i = 0; i < CFG.sneakers.length; i++) {
            if (!new File(dir.fsName + "/" + CFG.sneakers[i].file).exists) {
                alert("Missing asset: " + CFG.sneakers[i].file + "\nin " + dir.fsName);
                return null;
            }
        }
        return dir;
    }

    function importAssets(dir, folder) {
        var items = [];
        for (var i = 0; i < CFG.sneakers.length; i++) {
            var io = new ImportOptions(new File(dir.fsName + "/" + CFG.sneakers[i].file));
            io.importAs = ImportAsType.FOOTAGE;
            var it = app.project.importFile(io);
            it.parentFolder = folder;
            try { it.mainSource.alphaMode = AlphaMode.STRAIGHT; } catch (e) { }
            items.push(it);
        }
        return items;
    }

    // ---------- CONTROLS ----------
    function buildControls(main) {
        var c = main.layers.addNull(CFG.duration);
        c.name = "CONTROLS";
        c.label = 2;
        slider(c, "Stripe Speed", 1);
        slider(c, "Stripe Opacity", 100);
        slider(c, "Rainbow Speed", 90);          // градусов оттенка в секунду
        slider(c, "Rainbow Saturation", 92);
        slider(c, "Shake Amount", 9);             // px
        slider(c, "Flash Intensity", 100);
        slider(c, "Sneaker Scale", 72);           // % от PNG 1600x1000
        slider(c, "Sneaker Float", 12);           // px, парение
        slider(c, "Shadow Opacity", 45);
        slider(c, "Grain Amount", 5);
        slider(c, "Vignette", 55);
        colorCtl(c, "Swoosh Color", rgba(SWOOSH_COLOR));

        var m = c.property("ADBE Marker");
        var marks = [[0, "INTRO - swoosh from darkness"], [T.zoomStart, "FLY THROUGH"], [T.worldIn, "RAINBOW WORLD"],
                     [T.wipe, "END CARD"], [T.fadeStart, "FADE TO BLACK -> loop"]];
        for (var i = 0; i < CFG.sneakers.length; i++) marks.push([T.shoeFirst + i * T.shoeStep, "SNEAKER " + (i + 1)]);
        for (i = 0; i < marks.length; i++) safe("marker", function () { m.setValueAtTime(marks[i][0], new MarkerValue(marks[i][1])); });
        return c;
    }

    function buildCamShake(main) {
        var s = main.layers.addNull(CFG.duration);
        s.name = "CAM_SHAKE";
        s.label = 2;
        var hits = [];
        for (var i = 1; i < CFG.sneakers.length; i++) hits.push(fmt(T.shoeFirst + i * T.shoeStep));
        tr(s, "pos").expression = [
            "var c = " + CTRL_MAIN + ";",
            "var amp = c.effect(\"Shake Amount\")(1);",
            "var w = wiggle(6, amp);",
            "var on = linear(time, " + fmt(T.worldIn) + ", " + fmt(T.worldIn + 0.15) + ", 0, 1) * linear(time, " + fmt(T.wipe) + ", " + fmt(T.wipe + 0.3) + ", 1, 0);",
            "var hits = [" + fmt(T.burst) + ", " + hits.join(", ") + "];",
            "var punch = 0;",
            "for (var i = 0; i < hits.length; i++) {",
            "  var d = time - hits[i];",
            "  if (d > 0 && d < 0.35) punch += Math.sin(d * 60) * amp * 2.2 * (1 - d / 0.35);",
            "}",
            "[value[0] + (w[0] - value[0]) * on + punch, value[1] + (w[1] - value[1]) * on - punch * 0.5]"
        ].join("\n");
        return s;
    }

    function shakeExpr(factor) {
        return [
            "var s = thisComp.layer(\"CAM_SHAKE\").transform.position;",
            "[value[0] + (s[0] - thisComp.width / 2) * " + factor + ", value[1] + (s[1] - thisComp.height / 2) * " + factor + "]"
        ].join("\n");
    }

    // ---------- 01_INTRO ----------
    function buildIntro(folder) {
        var comp = newComp("01_INTRO", CFG.duration, folder);
        var C = ctrlPre();
        var S0 = 76 / 100, S1 = SWOOSH.restScale / 100;
        var A = SWOOSH.heel;
        var p0 = [CX + A[0] * S0, CY + A[1] * S0];
        var p1 = [CX + A[0] * S1, CY + A[1] * S1];

        // мягкое оранжевое свечение из темноты
        var bg = shapeLayer(comp, "SWOOSH_BACKGLOW");
        var g = addGroup(bg, "Glow");
        addEllipse(bg, g, [1500, 650]);
        addFill(bg, g, rgba(SWOOSH_COLOR));
        fillColor(bg, g).expression = C + ".effect(\"Swoosh Color\")(1)";
        addBlur(bg, 180);
        tr(bg, "pos").setValue([CX, CY + 20]);
        keys(tr(bg, "opacity"), [[T.swooshIn + 0.1, 0], [T.swooshSharp + 0.1, 28], [T.zoomStart, 18], [T.zoomEnd - 0.15, 0]]);
        span(bg, 0, T.zoomEnd);

        // свуш
        var sw = shapeLayer(comp, "SWOOSH");
        g = addGroup(sw, "Swoosh");
        addPath(sw, g, makeShape(SWOOSH.v, SWOOSH.i, SWOOSH.o, true));
        addFill(sw, g, rgba(SWOOSH_COLOR));
        fillColor(sw, g).expression = C + ".effect(\"Swoosh Color\")(1)";
        tr(sw, "anchor").setValue(A);
        keys(tr(sw, "pos"), [[T.swooshIn, p0, [30, 30]], [T.swooshRest, p1, [80, 85]], [T.zoomEnd, [CX, CY], [0.1, 1, "linIn"]]]);
        keys(tr(sw, "scale"), [[T.swooshIn, [76, 76], [30, 30]], [T.swooshRest, [88, 88], [80, 85]], [T.zoomEnd, [4200, 4200], [0.1, 1, "linIn"]]]);
        keys(tr(sw, "rot"), [[T.zoomStart, 0, [30, 85]], [T.zoomEnd, -12, [0.1, 1, "linIn"]]]);
        keys(tr(sw, "opacity"), [[T.swooshIn, 0, [30, 30]], [T.swooshIn + 0.8, 100, [70, 30]]]);
        addBlur(sw, 45);
        keys(blurProp(sw), [[T.swooshIn, 45, [30, 20]], [T.swooshSharp, 0, [80, 30]]]);
        safe("Glow on swoosh", function () {
            var e = fx(sw, "ADBE Glo2");
            fxParam(e, 3).setValue(60);       // Glow Radius
            fxParam(e, 4).setValue(0);        // Glow Intensity
            var gi = fxParam(fxGet(sw, "ADBE Glo2"), 4);
            keys(gi, [[T.swooshIn, 0], [T.swooshSharp, 1.4], [T.zoomStart, 0.5], [T.zoomEnd, 0]]);
        });
        sw.motionBlur = true;
        span(sw, 0, T.zoomEnd + 1 / CFG.fps);

        // световой блик по свушу (матт = копия свуша)
        var sweep = shapeLayer(comp, "SWOOSH_LIGHT_SWEEP");
        g = addGroup(sweep, "Sweep");
        addRect(sweep, g, [160, 1400], 0);
        addFill(sweep, g, [1, 1, 1, 1]);
        tr(sweep, "rot").setValue(20);
        addBlur(sweep, 40);
        keys(tr(sweep, "pos"), [[T.sweepStart, [CX - 760, CY], [50, 50]], [T.sweepEnd, [CX + 760, CY], [50, 50]]]);
        tr(sweep, "opacity").setValue(85);
        sweep.blendingMode = BlendingMode.ADD;
        var matte = sw.duplicate();
        matte.name = "SWOOSH_MATTE";
        safe("remove glow from matte", function () { fxGet(matte, "ADBE Glo2").remove(); });
        matte.moveBefore(sweep);
        setTrackMatte(sweep, matte);
        span(sweep, T.sweepStart - 0.05, T.sweepEnd + 0.05);
        span(matte, T.sweepStart - 0.05, T.sweepEnd + 0.05);

        // взрыв радужных лучей
        for (var k = 0; k < 8; k++) {
            var tb = T.burst + k * 0.015;
            var ray = shapeLayer(comp, "BURST_RAYS_" + (k + 1));
            g = addGroup(ray, "Rays");
            addPath(ray, g, makeShape([[70, 0], [1500, 0]], null, null, false));
            addTrim(ray, g);
            addStroke(ray, g, rgba(PALETTE[k % PALETTE.length]), 10 + (k % 3) * 6);
            addRepeater(ray, g, 5, 72);
            keys(trimProp(ray, g, "ADBE Vector Trim End"), [[tb, 0, [10, 5]], [tb + 0.30, 100, [85, 10]]]);
            keys(trimProp(ray, g, "ADBE Vector Trim Start"), [[tb + 0.10, 0, [10, 20]], [tb + 0.45, 100, [80, 10]]]);
            tr(ray, "rot").setValue(k * 9 + 4);
            ray.motionBlur = true;
            span(ray, T.burst - 0.02, T.burst + 0.7);
        }

        // ударная волна
        var ring = shapeLayer(comp, "BURST_RING");
        g = addGroup(ring, "Ring");
        addEllipse(ring, g, [240, 240]);
        addStroke(ring, g, [1, 1, 1, 1], 40);
        keys(strokeProp(ring, g, "ADBE Vector Stroke Width"), [[T.burst, 40, [10, 10]], [T.burst + 0.5, 0, [80, 10]]]);
        keys(tr(ring, "scale"), [[T.burst, [60, 60], [10, 8]], [T.burst + 0.5, [1100, 1100], [85, 10]]]);
        keys(tr(ring, "opacity"), [[T.burst + 0.2, 100], [T.burst + 0.5, 0]]);
        ring.motionBlur = true;
        span(ring, T.burst - 0.02, T.burst + 0.55);

        return comp;
    }

    // ---------- 02 / 05 STRIPES ----------
    function buildStripes(name, P, seed, folder) {
        var comp = newComp(name, 30, folder);
        var C = ctrlPre();
        var list = genStripes(new Rng(seed), P);
        for (var i = 0; i < list.length; i++) {
            var s = list[i];
            var l = shapeLayer(comp, "STRIPE_" + (i + 1));
            var g = addGroup(l, "Stripe");
            addRect(l, g, [s.len, s.thick], s.thick / 2);
            addFill(l, g, rgba(s.color));
            tr(l, "rot").setValue(s.angle);
            var p = tr(l, "pos");
            keys(p, [[s.t0, s.from, "L"], [s.t0 + s.dur, s.to, "L"], [s.t0 + s.period, s.to, "L"]]);
            p.expression = "loopOut(\"cycle\")";
            tr(l, "opacity").expression = C + ".effect(\"Stripe Opacity\")(1) * " + fmt(P.opacity / 100);
            if (s.blur > 0.5) addBlur(l, s.blur);
            l.motionBlur = true;
            l.label = 11;
        }
        return comp;
    }

    // ---------- 03_SNEAKERS ----------
    function buildSneakers(folder, items) {
        var comp = newComp("03_SNEAKERS", CFG.duration, folder);
        var C = ctrlPre();
        var n = CFG.sneakers.length, i, tin, tout, tl;

        // огромные контурные надписи позади кроссовок
        for (i = 0; i < n; i++) {
            tin = T.shoeFirst + i * T.shoeStep;
            tout = tin + T.shoeStep;
            tl = tout + T.shoeLeave;
            var word = makeText(comp, CFG.sneakers[i].word, { size: Math.round(H * 0.36), just: "C", fill: null, stroke: { color: [1, 1, 1], width: 5 }, tracking: 20 });
            word.name = "S" + (i + 1) + "_WORD";
            centerAnchor(word);
            keys(tr(word, "pos"), [[tin, [CX + W * 0.30, CY + H * 0.02], "L"], [tl, [CX - W * 0.30, CY + H * 0.02], "L"]]);
            keys(tr(word, "opacity"), [[tin, 0], [tin + 0.25, 70], [tout, 70], [tl, 0]]);
            word.motionBlur = true;
            word.label = 14;
            span(word, tin - 0.02, tl + 0.02);
        }

        for (i = 0; i < n; i++) {
            tin = T.shoeFirst + i * T.shoeStep;
            tout = tin + T.shoeStep;
            tl = tout + T.shoeLeave;
            var ta = tin + T.shoeArrive, ts = tin + T.shoeSettle;
            var tag = "S" + (i + 1);
            var phase = fmt(i * 1.7);

            var mv = comp.layers.addNull(CFG.duration);
            mv.name = tag + "_MOVE";
            mv.label = 9;
            keys(tr(mv, "pos"), [
                [tin, [W * 1.47, CY + 30], [10, 8]],
                [ta, [CX - W * 0.03, CY], [75, 40]],
                [ts, [CX + W * 0.008, CY], [60, 30]],
                [tout, [CX - W * 0.012, CY], [40, 60]],
                [tl, [-W * 0.47, CY - 20], [5, 5]]
            ]);
            keys(tr(mv, "rot"), [[tin, -14, [10, 8]], [ta, 3, [70, 40]], [ts, 0, [60, 60]], [tout, 0, [40, 60]], [tl, -12, [5, 5]]]);
            keys(tr(mv, "scale"), [[tin, [88, 88], [10, 8]], [ta, [104, 104], [70, 40]], [ts, [100, 100], [60, 60]], [tout, [103, 103], [40, 60]], [tl, [94, 94], [5, 5]]]);

            // белое свечение — отделяет кроссовок от радужного фона
            var halo = shapeLayer(comp, tag + "_HALO");
            var g = addGroup(halo, "Halo");
            addEllipse(halo, g, [1500, 820]);
            addFill(halo, g, [1, 1, 1, 1]);
            addBlur(halo, 120);
            tr(halo, "opacity").setValue(30);
            parentTo(halo, mv, [0, -10]);

            // контактная тень
            var sh = shapeLayer(comp, tag + "_SHADOW");
            g = addGroup(sh, "Shadow");
            addEllipse(sh, g, [1250, 110]);
            addFill(sh, g, [0, 0, 0, 1]);
            addBlur(sh, 28);
            parentTo(sh, mv, null);
            tr(sh, "pos").expression = "var S = " + C + ".effect(\"Sneaker Scale\")(1) / 100;\n[value[0], value[1] + 300 * S]";
            tr(sh, "scale").expression = "var S = " + C + ".effect(\"Sneaker Scale\")(1);\nvar f = 1 - 0.08 * Math.sin((time - inPoint) * 2.8 + " + phase + ");\n[S * f, S * f]";
            tr(sh, "opacity").expression = C + ".effect(\"Shadow Opacity\")(1) * (0.85 + 0.15 * Math.sin((time - inPoint) * 2.8 + " + phase + "))";

            // кроссовок
            var shoe = comp.layers.add(items[i]);
            shoe.name = tag + "_SHOE";
            shoe.label = 13;
            tr(shoe, "anchor").setValue([800, 600]);   // центр кроссовка в PNG 1600x1000 (пол = y 900)
            parentTo(shoe, mv, null);
            tr(shoe, "scale").expression = "var s = " + C + ".effect(\"Sneaker Scale\")(1);\n[s, s]";
            tr(shoe, "pos").expression = "var a = " + C + ".effect(\"Sneaker Float\")(1);\n[value[0], value[1] - a * Math.sin((time - inPoint) * 2.8 + " + phase + ")]";
            tr(shoe, "rot").expression = "value + 1.2 * Math.sin((time - inPoint) * 1.9 + " + phase + ")";
            safe("Drop Shadow on " + tag, function () {
                var e = fx(shoe, "ADBE Drop Shadow");
                fxParam(e, 1).setValue([0, 0, 0, 1]);   // color
                fxParam(e, 3).setValue(180);            // direction
                fxParam(e, 4).setValue(18);             // distance
                fxParam(e, 5).setValue(40);             // softness
            });
            shoe.motionBlur = true;

            var a = tin - 0.02, b = tl + 0.05;
            span(mv, a, b); span(halo, a, b); span(sh, a, b); span(shoe, a, b);
        }
        return comp;
    }

    // ---------- 04_ENDCARD ----------
    function rainbowColorExpr(C, offset, light) {
        return [
            "var c = " + C + ";",
            "var h = (time * c.effect(\"Rainbow Speed\")(1) / 360 + " + fmt(offset) + ") % 1;",
            "hslToRgb([h, c.effect(\"Rainbow Saturation\")(1) / 100, " + fmt(light) + ", 1])"
        ].join("\n");
    }

    function fourColor(layer, C, pts, light) {
        var e = fx(layer, "ADBE 4ColorGradient");
        for (var k = 0; k < 4; k++) {
            fxParam(e, 1 + k * 2).setValue(pts[k]);
            fxParam(e, 2 + k * 2).expression = rainbowColorExpr(C, k * 0.25, light);
        }
    }

    function buildTagline(folder) {
        var comp = newComp("04b_TAGLINE", CFG.duration, folder);
        var C = ctrlPre();
        var size = Math.round(H * 0.085), base = Math.round(H * 0.645);
        var words = CFG.tagline, layers = [], rects = [], total = 0, gap = size * 0.24, i;
        for (i = 0; i < words.length; i++) {
            var l = makeText(comp, words[i], { size: size, just: "L", fill: [1, 1, 1], tracking: 10 });
            l.name = "TAG_" + (i + 1) + "_" + words[i].replace(/[^A-Za-z]/g, "");
            var r = l.sourceRectAtTime(0, false);
            layers.push(l); rects.push(r);
            total += r.width + (i ? gap : 0);
        }
        var x = CX - total / 2, last = null, lastBox = null;
        for (i = 0; i < words.length; i++) {
            var px = x - rects[i].left, t0 = T.tagIn + i * T.tagStagger;
            keys(tr(layers[i], "pos"), [[t0, [px, base + size * 1.4], [10, 8]], [t0 + T.tagDur, [px, base], [88, 10]]]);
            layers[i].motionBlur = true;
            if (i === words.length - 1) { last = layers[i]; lastBox = [x, base + rects[i].top, x + rects[i].width, base + rects[i].top + rects[i].height]; }
            x += rects[i].width + gap;
        }
        // последнее слово ("greatness.") заливается живой радугой через alpha matte
        var fill = solid(comp, "TAG_RAINBOW_FILL", [1, 1, 1]);
        safe("rainbow fill", function () {
            fourColor(fill, C, [[lastBox[0], lastBox[1]], [lastBox[2], lastBox[1]], [lastBox[0], lastBox[3]], [lastBox[2], lastBox[3]]], 0.6);
        });
        last.name = "TAG_MATTE_" + last.name.substr(4);
        last.moveBefore(fill);
        setTrackMatte(fill, last);
        return { comp: comp, top: base - size * 0.95, bottom: base + size * 0.32, width: total, base: base, size: size };
    }

    function buildEndcard(folder) {
        var comp = newComp("04_ENDCARD", CFG.duration, folder);
        var i;

        // радужная шторка справа налево, последняя полоса — чёрный фон эндкарда
        var bands = [PALETTE[0], PALETTE[1], PALETTE[2], PALETTE[3], PALETTE[4], PALETTE[5], PALETTE[6], [10, 10, 10]];
        for (i = 0; i < bands.length; i++) {
            var t0 = T.wipe + i * T.wipeStagger, isBlack = i === bands.length - 1;
            var b = shapeLayer(comp, isBlack ? "WIPE_BLACK_BG" : "WIPE_BAND_" + (i + 1));
            var g = addGroup(b, "Band");
            addRect(b, g, [2400, 1800], 0);
            addFill(b, g, rgba(bands[i]));
            tr(b, "rot").setValue(15);
            keys(tr(b, "pos"), [[t0, [3400, CY], [10, 6]], [t0 + T.wipeDur, [CX, CY], [90, 10]]]);
            b.motionBlur = true;
            b.label = 10;
            span(b, t0 - 0.01, isBlack ? CFG.duration : T.wipe + 1.2);
        }

        var tag = buildTagline(folder);

        // "NIKE."
        var brand = makeText(comp, CFG.brand, { size: Math.round(H * 0.30), just: "C", fill: [1, 1, 1], tracking: -10 });
        brand.name = "BRAND_NIKE";
        centerAnchor(brand);
        tr(brand, "pos").setValue([CX, H * 0.40]);
        keys(tr(brand, "opacity"), [[T.brandIn, 0, [10, 10]], [T.brandIn + 0.06, 100]]);
        keys(tr(brand, "scale"), [[T.brandIn, [185, 185], [10, 20]], [T.brandHit, [96, 96], [60, 40]], [T.brandSettle, [100, 100], [70, 30]]]);
        addBlur(brand, 35);
        keys(blurProp(brand), [[T.brandIn, 35, [10, 20]], [T.brandHit, 0, [60, 30]]]);
        safe("tracking animator", function () {
            var anims = brand.property("ADBE Text Properties").property("ADBE Text Animators");
            var an = anims.addProperty("ADBE Text Animator");
            an.name = "Breathing Tracking";
            var ai = anims.numProperties;
            anims.property(ai).property("ADBE Text Selectors").addProperty("ADBE Text Selector");
            anims.property(ai).property("ADBE Text Animator Properties").addProperty("ADBE Text Tracking Amount");
            var trk = anims.property(ai).property("ADBE Text Animator Properties").property("ADBE Text Tracking Amount");
            keys(trk, [[T.brandSettle, 0, [30, 40]], [T.fadeEnd, 60, [40, 30]]]);
        });
        brand.motionBlur = true;
        span(brand, T.brandIn - 0.02, CFG.duration);

        // слоган (прекомп с маской-щелью, слова выезжают снизу)
        var tl = comp.layers.add(tag.comp);
        tl.name = "TAGLINE";
        addMask(tl, rectShape(0, tag.top, W, tag.bottom), [0, 6], false);
        span(tl, T.tagIn - 0.02, CFG.duration);

        // радужное подчёркивание
        for (i = 0; i < 6; i++) {
            var u = shapeLayer(comp, "UNDERLINE_" + (i + 1));
            g = addGroup(u, "Line");
            addPath(u, g, makeShape([[-tag.width / 2, 0], [tag.width / 2, 0]], null, null, false));
            addTrim(u, g);
            addStroke(u, g, rgba(PALETTE[i]), 5);
            keys(trimProp(u, g, "ADBE Vector Trim End"), [[T.underline + i * 0.04, 0, [10, 8]], [T.underline + i * 0.04 + 0.35, 100, [85, 10]]]);
            tr(u, "pos").setValue([CX, tag.base + tag.size * 0.40 + i * 9]);
            span(u, T.underline - 0.02, CFG.duration);
        }
        return comp;
    }

    // ---------- MAIN ----------
    function buildMain(main, ctrl, parts) {
        var i;
        var bgBlack = solid(main, "BG_BLACK", [0, 0, 0]);
        bgBlack.label = 0;

        var rainbow = solid(main, "BG_RAINBOW", [1, 1, 1]);
        safe("BG rainbow", function () {
            fourColor(rainbow, CTRL_MAIN, [[W * 0.15, H * 0.2], [W * 0.85, H * 0.2], [W * 0.15, H * 0.8], [W * 0.85, H * 0.8]], 0.55);
            for (var k = 0; k < 4; k++) {
                fxParam(fxGet(rainbow, "ADBE 4ColorGradient"), 1 + k * 2).expression =
                    "var a = time * 0.9 + " + fmt(k * Math.PI / 2) + ";\n[thisComp.width / 2 + Math.cos(a) * thisComp.width * 0.38, thisComp.height / 2 + Math.sin(a) * thisComp.height * 0.36]";
            }
        });
        span(rainbow, T.worldIn, T.worldOut);

        var sun = shapeLayer(main, "BG_SUNBURST");
        var g = addGroup(sun, "Rays");
        addPath(sun, g, makeShape([[0, 0], [1800, -160], [1800, 160]], null, null, true));
        addFill(sun, g, [1, 1, 1, 1]);
        addRepeater(sun, g, 16, 22.5);
        tr(sun, "pos").setValue([CX, CY]);
        tr(sun, "rot").expression = "time * 25";
        tr(sun, "opacity").setValue(10);
        span(sun, T.worldIn, T.worldOut);

        var back = main.layers.add(parts.stripesBack);
        var shoes = main.layers.add(parts.sneakers);
        var front = main.layers.add(parts.stripesFront);
        var stripeLayers = [[back, 0.7], [front, 1.4]];
        for (i = 0; i < stripeLayers.length; i++) {
            var sl = stripeLayers[i][0];
            sl.timeRemapEnabled = true;
            sl.property("ADBE Time Remapping").expression =
                fmt(STRIPES.timeOffset) + " + (time - inPoint) * " + CTRL_MAIN + ".effect(\"Stripe Speed\")(1)";
            tr(sl, "pos").expression = shakeExpr(stripeLayers[i][1]);
            span(sl, T.worldIn, T.worldOut);
            sl.label = 11;
        }
        tr(shoes, "pos").expression = shakeExpr(1);

        var intro = main.layers.add(parts.intro);
        span(intro, 0, T.burst + 0.75);

        var end = main.layers.add(parts.endcard);
        span(end, T.wipe, CFG.duration);
        keys(tr(end, "scale"), [[T.brandIn, [100, 100], [40, 30]], [T.fadeEnd, [106, 106], [30, 40]]]);
        tr(end, "pos").expression = [
            "var amp = " + CTRL_MAIN + ".effect(\"Shake Amount\")(1) * 2.2;",
            "var d = time - " + fmt(T.brandHit) + ", o = 0;",
            "if (d > 0 && d < 0.3) o = Math.sin(d * 95) * amp * (1 - d / 0.3);",
            "[value[0] + o, value[1] - o * 0.4]"
        ].join("\n");

        // вспышки на склейках
        var flash = solid(main, "FX_FLASH", [1, 1, 1]);
        flash.blendingMode = BlendingMode.ADD;
        var fk = [[T.zoomEnd - 0.05, 0], [T.zoomEnd, 70, [40, 8]], [T.zoomEnd + 0.17, 0, [85, 30]]];
        for (i = 1; i < CFG.sneakers.length; i++) {
            var tc = T.shoeFirst + i * T.shoeStep;
            fk.push([tc - 0.034, 0]); fk.push([tc + 0.02, 30, [40, 8]]); fk.push([tc + 0.18, 0, [85, 30]]);
        }
        fk.push([T.brandHit - 0.02, 0]); fk.push([T.brandHit, 12, [40, 8]]); fk.push([T.brandHit + 0.18, 0, [85, 30]]);
        keys(tr(flash, "opacity"), fk);
        tr(flash, "opacity").expression = "value * " + CTRL_MAIN + ".effect(\"Flash Intensity\")(1) / 100";

        // затемнение под зерном и виньеткой: кадр 299 и кадр 0 выглядят одинаково (чёрный + зерно)
        var fade = solid(main, "FADE_TO_BLACK", [0, 0, 0]);
        keys(tr(fade, "opacity"), [[T.fadeStart, 0, [40, 40]], [T.fadeEnd, 100, [70, 40]]]);
        fade.label = 1;

        var grain = solid(main, "FX_GRAIN", [0.5, 0.5, 0.5]);
        grain.adjustmentLayer = true;
        safe("grain", function () {
            var e = fx(grain, "ADBE Noise");
            fxParam(e, 1).expression = CTRL_MAIN + ".effect(\"Grain Amount\")(1)";
            fxParam(fxGet(grain, "ADBE Noise"), 2).setValue(0);   // монохромное зерно
        });

        var vig = solid(main, "FX_VIGNETTE", [0, 0, 0]);
        addMask(vig, ellipseShape(CX, CY, W * 0.62, H * 0.66), [520, 520], true);
        tr(vig, "opacity").expression = CTRL_MAIN + ".effect(\"Vignette\")(1)";

        var shakeNull = main.layer("CAM_SHAKE");
        shakeNull.moveToBeginning();
        ctrl.moveToBeginning();
        for (i = 1; i <= main.numLayers; i++) {
            var L = main.layer(i);
            if (L.source && L.source instanceof CompItem) L.motionBlur = true;
        }
    }

    // =====================================================================
    // 4. ЗАПУСК
    // =====================================================================
    function run() {
        var dir = findAssets();
        if (!dir) return;

        app.beginUndoGroup("Build NIKE loop");
        try {
            MAIN_NAME = uniqueItemName(CFG.compName);
            var top = app.project.items.addFolder(uniqueItemName("NIKE_LOOP"));
            var pre = app.project.items.addFolder("Precomps");
            var assets = app.project.items.addFolder("Assets");
            pre.parentFolder = top;
            assets.parentFolder = top;

            FONT = pickFont();
            var items = importAssets(dir, assets);

            // главная композиция и контроллеры создаются первыми — на них ссылаются выражения
            var main = newComp(MAIN_NAME, CFG.duration, top);
            main.workAreaStart = 0;
            main.workAreaDuration = CFG.duration;
            var ctrl = buildControls(main);
            buildCamShake(main);

            var parts = {
                intro: buildIntro(pre),
                stripesBack: buildStripes("02_STRIPES_BACK", STRIPES.back, CFG.seed, pre),
                sneakers: buildSneakers(pre, items),
                stripesFront: buildStripes("05_STRIPES_FRONT", STRIPES.front, CFG.seed + 1, pre),
                endcard: buildEndcard(pre)
            };
            buildMain(main, ctrl, parts);
            main.openInViewer();
            main.time = 3.5;

            var msg = "NIKE loop built: " + MAIN_NAME + " (" + W + "x" + H + ", " + CFG.fps + " fps, " + CFG.duration + " s)\n" +
                      "Font: " + (FONT || "AE default") + "\n" +
                      "Tweak everything on the CONTROLS layer (Effect Controls panel).";
            if (WARN.length) msg += "\n\nWarnings:\n- " + WARN.join("\n- ");
            alert(msg);
        } catch (e) {
            alert("NIKE loop build failed at line " + e.line + ":\n" + e.toString() +
                  (WARN.length ? "\n\nWarnings:\n- " + WARN.join("\n- ") : ""));
        } finally {
            app.endUndoGroup();
        }
    }

    run();
})();
