#target aftereffects
/*
 * LEGO SQUAD · 5 персонажей · у каждого своя анимация · 1080 x 1350 · 30 fps · 5 s (бесшовный луп)
 * ------------------------------------------------------------------------------------------------
 * Сборщик для After Effects (ExtendScript, CC 2018+).
 * Рядом со скриптом — папка vectors/ с векторными деталями (tools/vectorize_squad.py).
 *
 * Запуск:  File > Scripts > Run Script File...  ->  build_lego_squad.jsx
 * Создаются 5 композиций (по одной на персонажа). Чтобы собрать только одного, впишите его имя в ONLY.
 *
 * Каждый персонаж — 7 шейп-слоёв: LEGS > TORSO > HEAD / ARM_L > HAND_L / ARM_R > HAND_R.
 * Внутри слоя: "Outline" (ровная обводка), цветные группы "Print N" (лицо, волосы, принты), "Base" (заливка).
 * Руки вращаются в плоскости кадра вокруг круглого плечевого шарнира, как у минифигурки; кисти — дети рук.
 * Ничего не масштабируется и не искажается, размытия в движении нет — каждый кадр чёткий.
 * Все движения — обычные ключи с easing; цвета фона и сила дыхания — на слое CONTROLS.
 */

(function legoSquadBuilder() {

    var ONLY = "";   // например "RED_SUIT", чтобы собрать одного персонажа

    var CFG = {
        width: 1080,
        height: 1350,
        fps: 30,
        duration: 5,
        feet: [540, 1250],
        outline: [18, 18, 18],
        breath: 1.0,
        breathPeriod: 2.5
    };

    // Персонажи: векторы vectors/<name>.jsxinc, анимация из ANIMS, масштаб от исходника (%), цвет фона
    var SQUAD = [
        { name: "RED_DREADS", anim: "groove", scale: 68, bg: [246, 226, 230] },
        { name: "ANGRY_CHAIN", anim: "rage", scale: 60, bg: [244, 233, 219] },
        { name: "SMILE_VARSITY", anim: "wave", scale: 70, bg: [236, 231, 246] },
        { name: "ASTRO_BRICK", anim: "jump", scale: 58, bg: [226, 238, 247] },
        { name: "RED_SUIT", anim: "point", scale: 63, bg: [246, 240, 228] }
    ];

    // Ключи анимаций (генерирует tools/anim_design.py): [время, значение, [influence in, influence out]]
    // <ANIMS>
    var ANIMS = {"groove": {"HEAD": {"rot": [[0.0, 0, [25, 80]], [0.312, 4, [55, 55]], [0.625, 0, [25, 80]], [0.938, -4, [55, 55]], [1.25, 0, [25, 80]], [1.562, 4, [55, 55]], [1.875, 0, [25, 80]], [2.188, -4, [55, 55]], [2.5, 0, [25, 80]], [2.812, 4, [55, 55]], [3.125, 0, [25, 80]], [3.438, -4, [55, 55]], [3.75, 0, [25, 80]], [4.062, 4, [55, 55]], [4.375, 0, [25, 80]], [4.688, -4, [55, 55]], [5.0, 0, [25, 80]]], "pos": [[0.0, [0, 0], [25, 80]], [0.312, [0, 14], [55, 55]], [0.625, [0, 0], [25, 80]], [0.938, [0, 14], [55, 55]], [1.25, [0, 0], [25, 80]], [1.562, [0, 14], [55, 55]], [1.875, [0, 0], [25, 80]], [2.188, [0, 14], [55, 55]], [2.5, [0, 0], [25, 80]], [2.812, [0, 14], [55, 55]], [3.125, [0, 0], [25, 80]], [3.438, [0, 14], [55, 55]], [3.75, [0, 0], [25, 80]], [4.062, [0, 14], [55, 55]], [4.375, [0, 0], [25, 80]], [4.688, [0, 14], [55, 55]], [5.0, [0, 0], [25, 80]]]}, "TORSO": {"rot": [[0.0, 0, [55, 55]], [0.625, 3, [55, 55]], [1.25, 0, [55, 55]], [1.875, -3, [55, 55]], [2.5, 0, [55, 55]], [3.125, 3, [55, 55]], [3.75, 0, [55, 55]], [4.375, -3, [55, 55]], [5.0, 0, [55, 55]]]}, "LEGS": {"pos": [[0.0, [0, 0], [25, 80]], [0.312, [0, -12], [55, 55]], [0.625, [0, 0], [25, 80]], [0.938, [0, -12], [55, 55]], [1.25, [0, 0], [25, 80]], [1.562, [0, -12], [55, 55]], [1.875, [0, 0], [25, 80]], [2.188, [0, -12], [55, 55]], [2.5, [0, 0], [25, 80]], [2.812, [0, -12], [55, 55]], [3.125, [0, 0], [25, 80]], [3.438, [0, -12], [55, 55]], [3.75, [0, 0], [25, 80]], [4.062, [0, -12], [55, 55]], [4.375, [0, 0], [25, 80]], [4.688, [0, -12], [55, 55]], [5.0, [0, 0], [25, 80]]]}, "ARM_L": {"rot": [[0.0, 0, [55, 55]], [0.625, 24, [55, 55]], [1.25, 0, [55, 55]], [1.875, -5, [55, 55]], [2.5, 0, [55, 55]], [3.125, 24, [55, 55]], [3.75, 0, [55, 55]], [4.375, -5, [55, 55]], [5.0, 0, [55, 55]]]}, "ARM_R": {"rot": [[0.0, 0, [55, 55]], [0.625, 5, [55, 55]], [1.25, 0, [55, 55]], [1.875, -24, [55, 55]], [2.5, 0, [55, 55]], [3.125, 5, [55, 55]], [3.75, 0, [55, 55]], [4.375, -24, [55, 55]], [5.0, 0, [55, 55]]]}}, "rage": {"ARM_L": {"rot": [[0, 0, [55, 55]], [0.5, 0, [55, 55]], [0.75, -7, [80, 25]], [1.05, 130, [60, 30]], [1.15, 122, [25, 80]], [1.25, 126, [50, 50]], [1.35, 118, [50, 50]], [1.45, 126, [50, 50]], [1.55, 118, [50, 50]], [1.65, 126, [50, 50]], [1.75, 118, [50, 50]], [1.85, 126, [50, 50]], [1.95, 118, [50, 50]], [2.05, 126, [50, 50]], [2.15, 118, [50, 50]], [2.25, 126, [50, 50]], [2.35, 118, [50, 50]], [2.45, 126, [50, 50]], [2.55, 118, [50, 50]], [2.65, 126, [50, 50]], [2.75, 118, [50, 50]], [2.85, 126, [50, 50]], [2.95, 118, [50, 50]], [3.05, 126, [50, 50]], [3.15, 122, [80, 25]], [3.4, -9, [20, 70]], [3.6, 2, [25, 80]], [3.85, 0, [55, 55]], [5.0, 0, [55, 55]]]}, "ARM_R": {"rot": [[0, 0, [55, 55]], [0.55, 0, [55, 55]], [0.8, 7, [80, 25]], [1.1, -130, [60, 30]], [1.2, -122, [25, 80]], [1.3, -126, [50, 50]], [1.4, -118, [50, 50]], [1.5, -126, [50, 50]], [1.6, -118, [50, 50]], [1.7, -126, [50, 50]], [1.8, -118, [50, 50]], [1.9, -126, [50, 50]], [2.0, -118, [50, 50]], [2.1, -126, [50, 50]], [2.2, -118, [50, 50]], [2.3, -126, [50, 50]], [2.4, -118, [50, 50]], [2.5, -126, [50, 50]], [2.6, -118, [50, 50]], [2.7, -126, [50, 50]], [2.8, -118, [50, 50]], [2.9, -126, [50, 50]], [3.0, -118, [50, 50]], [3.15, -122, [80, 25]], [3.42, 9, [20, 70]], [3.62, -2, [25, 80]], [3.87, 0, [55, 55]], [5.0, 0, [55, 55]]]}, "TORSO": {"rot": [[0, 0, [55, 55]], [0.5, 0, [55, 55]], [0.75, -2.5, [80, 25]], [1.1, 1.5, [55, 55]], [1.283, 1.2, [50, 50]], [1.367, -1.2, [50, 50]], [1.45, 1.2, [50, 50]], [1.533, -1.2, [50, 50]], [1.617, 1.2, [50, 50]], [1.7, -1.2, [50, 50]], [1.783, 1.2, [50, 50]], [1.867, -1.2, [50, 50]], [1.95, 1.2, [50, 50]], [2.033, -1.2, [50, 50]], [2.117, 1.2, [50, 50]], [2.2, -1.2, [50, 50]], [2.283, 1.2, [50, 50]], [2.367, -1.2, [50, 50]], [2.45, 1.2, [50, 50]], [2.533, -1.2, [50, 50]], [2.617, 1.2, [50, 50]], [2.7, -1.2, [50, 50]], [2.783, 1.2, [50, 50]], [2.867, -1.2, [50, 50]], [2.95, 1.2, [50, 50]], [3.033, -1.2, [50, 50]], [3.15, 0, [55, 55]], [3.45, 2.5, [25, 80]], [4.0, -1, [55, 55]], [4.5, 0.4, [55, 55]], [5.0, 0, [55, 55]]], "pos": [[0, [0, 0], [55, 55]], [3.35, [0, 0], [55, 55]], [3.48, [0, 8], [25, 80]], [3.9, [0, 0], [55, 55]], [5.0, [0, 0], [55, 55]]]}, "HEAD": {"rot": [[0, 0, [55, 55]], [0.5, 0, [55, 55]], [0.75, 4, [80, 25]], [1.1, -3, [55, 55]], [1.325, 5.0, [50, 50]], [1.45, -5.0, [50, 50]], [1.575, 5.0, [50, 50]], [1.7, -5.0, [50, 50]], [1.825, 5.0, [50, 50]], [1.95, -5.0, [50, 50]], [2.075, 5.0, [50, 50]], [2.2, -5.0, [50, 50]], [2.325, 5.0, [50, 50]], [2.45, -5.0, [50, 50]], [2.575, 5.0, [50, 50]], [2.7, -5.0, [50, 50]], [2.825, 5.0, [50, 50]], [2.95, -5.0, [50, 50]], [3.15, 0, [55, 55]], [3.48, -6, [25, 80]], [4.1, 2, [55, 55]], [4.7, 0, [55, 55]], [5.0, 0, [55, 55]]], "pos": [[0, [0, 0], [55, 55]], [0.5, [0, 0], [55, 55]], [0.75, [0, 8], [55, 55]], [1.1, [0, -6], [55, 55]], [1.4, [0, 0], [55, 55]], [3.4, [0, 0], [55, 55]], [3.52, [0, 10], [25, 80]], [3.9, [0, 0], [55, 55]], [5.0, [0, 0], [55, 55]]]}, "LEGS": {"pos": [[0, [0, 0], [55, 55]], [3.36, [0, 0], [55, 55]], [3.46, [0, -14], [60, 40]], [3.56, [0, 0], [30, 70]], [5.0, [0, 0], [55, 55]]]}}, "wave": {"ARM_R": {"rot": [[0, 0, [55, 55]], [0.35, 0, [55, 55]], [0.55, 6, [80, 25]], [0.95, -138, [60, 30]], [1.1, -128, [25, 80]], [1.308, -114, [50, 50]], [1.517, -142, [50, 50]], [1.725, -114, [50, 50]], [1.933, -142, [50, 50]], [2.142, -114, [50, 50]], [2.35, -142, [50, 50]], [2.558, -114, [50, 50]], [2.767, -142, [50, 50]], [2.975, -114, [50, 50]], [3.183, -142, [50, 50]], [3.392, -114, [50, 50]], [3.55, -128, [55, 55]], [4.15, 0, [70, 40]], [5.0, 0, [55, 55]]]}, "ARM_L": {"rot": [[0, 0, [55, 55]], [0.6, 0, [55, 55]], [1.1, 6, [55, 55]], [2.3, 2, [55, 55]], [3.5, 6, [55, 55]], [4.3, 0, [55, 55]], [5.0, 0, [55, 55]]]}, "HEAD": {"rot": [[0, 0, [55, 55]], [0.5, 0, [55, 55]], [1.1, 6, [25, 80]], [2.3, 3, [55, 55]], [3.5, 6, [55, 55]], [4.2, 0, [55, 55]], [5.0, 0, [55, 55]]]}, "TORSO": {"rot": [[0, 0, [55, 55]], [0.4, 0, [55, 55]], [1.0, 2.5, [25, 80]], [3.5, 2.5, [55, 55]], [4.2, 0, [55, 55]], [5.0, 0, [55, 55]]]}, "LEGS": {"pos": [[0, [0, 0], [55, 55]], [1.2, [0, -9], [55, 55]], [1.51, [0, 0], [55, 55]], [1.82, [0, -9], [55, 55]], [2.13, [0, 0], [55, 55]], [2.44, [0, -9], [55, 55]], [2.75, [0, 0], [55, 55]], [3.06, [0, -9], [55, 55]], [3.37, [0, 0], [55, 55]], [5.0, [0, 0], [55, 55]]]}}, "jump": {"LEGS": {"pos": [[0, [0, 0], [55, 55]], [0.3, [0, 0], [55, 55]], [0.58, [0, 0], [80, 25]], [0.92, [0, -170], [70, 30]], [1.1, [0, -164.9], [40, 40]], [1.42, [0, 0], [20, 80]], [2.3, [0, 0], [55, 55]], [2.58, [0, 0], [80, 25]], [2.92, [0, -270], [70, 30]], [3.1, [0, -261.9], [40, 40]], [3.42, [0, 0], [20, 80]], [5.0, [0, 0], [55, 55]]], "rot": [[0, 0, [55, 55]], [0.58, 0, [55, 55]], [1.0, 0, [55, 55]], [1.35, 0, [55, 55]], [2.58, 0, [55, 55]], [3.0, -6, [55, 55]], [3.35, 0, [55, 55]], [5.0, 0, [55, 55]]]}, "TORSO": {"pos": [[0, [0, 0], [55, 55]], [0.3, [0, 0], [55, 55]], [0.55, [0, 7], [80, 25]], [0.7, [0, 0], [55, 55]], [1.4, [0, 0], [55, 55]], [1.5, [0, 9], [25, 80]], [1.75, [0, 0], [55, 55]], [2.3, [0, 0], [55, 55]], [2.55, [0, 7], [80, 25]], [2.7, [0, 0], [55, 55]], [3.4, [0, 0], [55, 55]], [3.5, [0, 9], [25, 80]], [3.75, [0, 0], [55, 55]], [5.0, [0, 0], [55, 55]]]}, "ARM_L": {"rot": [[0, 0, [55, 55]], [0.3, 0, [55, 55]], [0.58, -10, [80, 25]], [0.92, 118, [70, 30]], [1.15, 110, [55, 55]], [1.45, 0, [30, 70]], [1.6, 4, [25, 80]], [1.8, 0, [55, 55]], [2.3, 0, [55, 55]], [2.58, -10, [80, 25]], [2.92, 136, [70, 30]], [3.15, 128, [55, 55]], [3.45, 0, [30, 70]], [3.6, 4, [25, 80]], [3.8, 0, [55, 55]], [5.0, 0, [55, 55]]]}, "ARM_R": {"rot": [[0, 0, [55, 55]], [0.3, 0, [55, 55]], [0.58, 10, [80, 25]], [0.92, -118, [70, 30]], [1.15, -110, [55, 55]], [1.45, 0, [30, 70]], [1.6, -4, [25, 80]], [1.8, 0, [55, 55]], [2.3, 0, [55, 55]], [2.58, 10, [80, 25]], [2.92, -136, [70, 30]], [3.15, -128, [55, 55]], [3.45, 0, [30, 70]], [3.6, -4, [25, 80]], [3.8, 0, [55, 55]], [5.0, 0, [55, 55]]]}, "HEAD": {"rot": [[0, 0, [55, 55]], [0.3, 0, [55, 55]], [0.58, 0, [80, 25]], [0.92, -4, [70, 30]], [1.42, 0, [55, 55]], [1.55, 3, [25, 80]], [1.8, 0, [55, 55]], [2.3, 0, [55, 55]], [2.58, 0, [80, 25]], [2.92, -4, [70, 30]], [3.42, 0, [55, 55]], [3.55, 3, [25, 80]], [3.8, 0, [55, 55]], [5.0, 0, [55, 55]]], "pos": [[0, [0, 0], [55, 55]], [0.3, [0, 0], [55, 55]], [0.58, [0, 8], [80, 25]], [0.92, [0, -8], [70, 30]], [1.42, [0, 0], [55, 55]], [1.55, [0, 10], [25, 80]], [1.8, [0, 0], [55, 55]], [2.3, [0, 0], [55, 55]], [2.58, [0, 8], [80, 25]], [2.92, [0, -8], [70, 30]], [3.42, [0, 0], [55, 55]], [3.55, [0, 10], [25, 80]], [3.8, [0, 0], [55, 55]], [5.0, [0, 0], [55, 55]]]}}, "point": {"ARM_L": {"rot": [[0, 0, [55, 55]], [0.55, 0, [55, 55]], [0.75, -6, [80, 25]], [1.05, 92, [60, 30]], [1.18, 84, [25, 80]], [1.3, 90, [55, 55]], [1.51, 80, [55, 55]], [1.72, 90, [55, 55]], [1.93, 80, [55, 55]], [2.14, 90, [55, 55]], [2.35, 80, [55, 55]], [2.56, 90, [55, 55]], [2.77, 80, [55, 55]], [2.98, 84, [55, 55]], [3.25, 128, [60, 30]], [3.42, 118, [55, 55]], [3.63, 128, [55, 55]], [3.84, 118, [55, 55]], [4.05, 128, [55, 55]], [4.35, 0, [60, 40]], [4.5, -4, [25, 80]], [4.7, 0, [55, 55]], [5.0, 0, [55, 55]]]}, "ARM_R": {"rot": [[0, 0, [55, 55]], [0.7, 0, [55, 55]], [1.2, -8, [25, 80]], [2.98, -8, [55, 55]], [3.25, -128, [60, 30]], [3.42, -118, [55, 55]], [3.63, -128, [55, 55]], [3.84, -118, [55, 55]], [4.05, -128, [55, 55]], [4.38, 0, [60, 40]], [4.53, 4, [25, 80]], [4.73, 0, [55, 55]], [5.0, 0, [55, 55]]]}, "HEAD": {"rot": [[0, 0, [55, 55]], [0.25, -3, [55, 55]], [0.5, 0, [55, 55]], [1.1, -5, [25, 80]], [1.3, -5, [55, 55]], [1.51, -2, [55, 55]], [1.72, -5, [55, 55]], [1.93, -2, [55, 55]], [2.14, -5, [55, 55]], [2.35, -2, [55, 55]], [2.56, -5, [55, 55]], [2.77, -2, [55, 55]], [2.98, -5, [55, 55]], [3.25, 0, [55, 55]], [3.42, 0, [55, 55]], [3.63, 0.5, [55, 55]], [3.84, 0, [55, 55]], [4.05, 0.5, [55, 55]], [4.4, 0, [55, 55]], [5.0, 0, [55, 55]]], "pos": [[0, [0, 0], [55, 55]], [0.25, [0, 10], [55, 55]], [0.5, [0, 0], [55, 55]], [1.3, [0, 0], [55, 55]], [1.51, [0, 9], [55, 55]], [1.72, [0, 0], [55, 55]], [1.93, [0, 9], [55, 55]], [2.14, [0, 0], [55, 55]], [2.35, [0, 9], [55, 55]], [2.56, [0, 0], [55, 55]], [2.77, [0, 9], [55, 55]], [2.98, [0, 0], [55, 55]], [3.19, [0, 9], [55, 55]], [3.4, [0, 0], [55, 55]], [3.61, [0, 9], [55, 55]], [3.86, [0, 0], [55, 55]], [5.0, [0, 0], [55, 55]]]}, "TORSO": {"rot": [[0, 0, [55, 55]], [0.6, 0, [55, 55]], [1.15, -3, [25, 80]], [2.98, -3, [55, 55]], [3.3, 0, [55, 55]], [5.0, 0, [55, 55]]]}, "LEGS": {"pos": [[0, [0, 0], [55, 55]], [3.25, [0, 0], [55, 55]], [3.42, [0, -10], [55, 55]], [3.63, [0, 0], [55, 55]], [3.84, [0, -10], [55, 55]], [4.05, [0, 0], [55, 55]], [5.0, [0, 0], [55, 55]]]}}};
    // </ANIMS>

    var ORDER = ["LEGS", "HEAD", "TORSO", "ARM_R", "HAND_R", "ARM_L", "HAND_L"];   // снизу вверх
    var PARENT = { LEGS: "", TORSO: "LEGS", HEAD: "TORSO", ARM_L: "TORSO", ARM_R: "TORSO", HAND_L: "ARM_L", HAND_R: "ARM_R" };
    var CTRL = 'thisComp.layer("CONTROLS")';
    var W = CFG.width, H = CFG.height;
    var VEC = null;

    // =====================================================================
    // ХЕЛПЕРЫ
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
    function keys(prop, list, map) {
        var i;
        for (i = 0; i < list.length; i++) prop.setValueAtTime(list[i][0], map ? map(list[i][1]) : list[i][1]);
        for (i = 0; i < list.length; i++) applyEase(prop, prop.nearestKeyIndex(list[i][0]), list[i][2] || [55, 55]);
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
    function loadVectors(name) {
        var here = new File($.fileName).parent;
        var f = new File(here.fsName + "/vectors/" + name + ".jsxinc");
        if (!f.exists) return null;
        return $.evalFile(f);
    }

    // ---------- шейпы ----------
    function makeShape(p) {
        var s = new Shape();
        s.vertices = p.v;
        s.inTangents = p.i;
        s.outTangents = p.o;
        s.closed = true;
        return s;
    }
    function addPathsGroup(l, name, paths) {
        var root = function () { return l.property("ADBE Root Vectors Group"); };
        var g = root().addProperty("ADBE Vector Group");
        g.name = name;
        var gi = root().numProperties;
        for (var i = 0; i < paths.length; i++) {
            var p = root().property(gi).property("ADBE Vectors Group").addProperty("ADBE Vector Shape - Group");
            p.property("ADBE Vector Shape").setValue(makeShape(paths[i]));
        }
        return gi;
    }
    function groupVecs(l, gi) { return l.property("ADBE Root Vectors Group").property(gi).property("ADBE Vectors Group"); }
    function addFill(vecs, color) {
        var f = vecs.addProperty("ADBE Vector Graphic - Fill");
        f.property("ADBE Vector Fill Color").setValue(rgba(color));
    }
    function addStroke(vecs) {
        var s = vecs.addProperty("ADBE Vector Graphic - Stroke");
        s.property("ADBE Vector Stroke Color").setValue(rgba(CFG.outline));
        s.property("ADBE Vector Stroke Width").setValue(VEC.lineWidth);
        s.property("ADBE Vector Stroke Line Cap").setValue(2);
        s.property("ADBE Vector Stroke Line Join").setValue(2);
    }

    function buildPart(comp, name) {
        var part = VEC.parts[name], pv = VEC.pivots[name], i, gi;
        var l = comp.layers.addShape();
        l.name = name;
        l.label = PARENT[name] ? 13 : 9;
        // сверху вниз: обводка, принты, заливка
        gi = addPathsGroup(l, "Outline", part.base.paths);
        addStroke(groupVecs(l, gi));
        for (i = 0; i < part.prints.length; i++) {
            gi = addPathsGroup(l, "Print " + (i + 1), part.prints[i].paths);
            addFill(groupVecs(l, gi), part.prints[i].color);
        }
        gi = addPathsGroup(l, "Base", part.base.paths);
        addFill(groupVecs(l, gi), part.base.color);
        tr(l, "anchor").setValue(pv);
        return l;
    }

    function simpleShape(comp, name, kind, size, color) {
        var l = comp.layers.addShape();
        l.name = name;
        var g = l.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group");
        g.name = name;
        var v = function () { return l.property("ADBE Root Vectors Group").property(1).property("ADBE Vectors Group"); };
        if (kind === "rect") v().addProperty("ADBE Vector Shape - Rect").property("ADBE Vector Rect Size").setValue(size);
        else v().addProperty("ADBE Vector Shape - Ellipse").property("ADBE Vector Ellipse Size").setValue(size);
        addFill(v(), color);
        return l;
    }

    function buildCharacter(ch, folder) {
        VEC = loadVectors(ch.name);
        if (!VEC) { alert("Missing vectors/" + ch.name + ".jsxinc"); return null; }
        var comp = app.project.items.addComp(uniqueItemName("LEGO_" + ch.name), W, H, 1, CFG.duration, CFG.fps);
        comp.parentFolder = folder;
        comp.bgColor = rgb(ch.bg);
        comp.motionBlur = false;   // без размытия: каждый кадр чёткий

        var c = comp.layers.addNull(CFG.duration);
        c.name = "CONTROLS";
        c.label = 2;
        var e = c.property("ADBE Effect Parade").addProperty("ADBE Color Control");
        e.name = "Background";
        e.property(1).setValue(rgba(ch.bg));
        e = c.property("ADBE Effect Parade").addProperty("ADBE Slider Control");
        e.name = "Breath";
        e.property(1).setValue(CFG.breath);

        var bg = simpleShape(comp, "BG", "rect", [W + 20, H + 20], ch.bg);
        bg.property("ADBE Root Vectors Group").property(1).property("ADBE Vectors Group").property("ADBE Vector Graphic - Fill")
            .property("ADBE Vector Fill Color").expression = CTRL + ".effect(\"Background\")(1)";
        var sh = simpleShape(comp, "FLOOR_SHADOW", "ellipse", [520, 44], [0, 0, 0]);
        tr(sh, "pos").setValue([CFG.feet[0], CFG.feet[1] + 6]);
        sh.property("ADBE Effect Parade").addProperty("ADBE Gaussian Blur 2").property(1).setValue(22);

        var layers = {}, i, name;
        for (i = 0; i < ORDER.length; i++) layers[ORDER[i]] = buildPart(comp, ORDER[i]);
        for (i = 0; i < ORDER.length; i++) {
            name = ORDER[i];
            var L = layers[name], pv = VEC.pivots[name];
            if (PARENT[name]) {
                L.parent = layers[PARENT[name]];
                tr(L, "pos").setValue(pv);
            } else {
                tr(L, "pos").setValue(CFG.feet);
                tr(L, "scale").setValue([ch.scale, ch.scale]);
            }
        }
        // анимация
        var A = ANIMS[ch.anim];
        for (name in A) {
            if (!A.hasOwnProperty(name)) continue;
            var P = A[name], lay = layers[name], base = VEC.pivots[name];
            if (P.rot) keys(tr(lay, "rot"), P.rot);
            if (P.scale) keys(tr(lay, "scale"), P.scale);
            if (P.pos) {
                var origin = PARENT[name] ? base : CFG.feet;
                keys(tr(lay, "pos"), P.pos, function (v) { return [origin[0] + v[0], origin[1] + v[1]]; });
            }
        }
        // дыхание (период делит 5 s нацело) и тень, которая уменьшается при прыжке
        tr(layers.TORSO, "scale").expression =
            "var a = " + CTRL + ".effect(\"Breath\")(1);\nvar s = a * Math.sin(time * 2 * Math.PI / " + CFG.breathPeriod + ");\n" +
            "[value[0] - s * 0.3, value[1] + s]";
        var lift = "Math.max(0, " + CFG.feet[1] + " - thisComp.layer(\"LEGS\").transform.position[1])";
        tr(sh, "scale").expression = "var k = 1 - Math.min(" + lift + " / 500, 0.55);\n[100 * k, 100 * k]";
        tr(sh, "opacity").expression = "18 * (1 - Math.min(" + lift + " / 400, 0.7))";
        c.moveToBeginning();
        return comp;
    }

    function run() {
        app.beginUndoGroup("Build LEGO squad");
        try {
            var folder = app.project.items.addFolder(uniqueItemName("LEGO_SQUAD"));
            var built = [], last = null;
            for (var i = 0; i < SQUAD.length; i++) {
                if (ONLY && SQUAD[i].name !== ONLY) continue;
                var c = buildCharacter(SQUAD[i], folder);
                if (c) { built.push(c.name + "  (" + SQUAD[i].anim + ")"); last = c; }
            }
            if (last) last.openInViewer();
            alert("LEGO squad built (" + W + "x" + H + ", " + CFG.fps + " fps, " + CFG.duration + " s loops):\n- " + built.join("\n- "));
        } catch (e) {
            alert("LEGO squad build failed at line " + e.line + ":\n" + e.toString());
        } finally {
            app.endUndoGroup();
        }
    }

    run();
})();
