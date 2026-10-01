# LEGO SQUAD · 7 персонажей · 7 разных анимаций · 5 с, луп

Те же правила, что и в `lego_motion`: каждый персонаж целиком векторный, каждая деталь — шейп-слой After Effects с ровной заливкой и одинаковой обводкой 9 px. Края чёткие при любом масштабе, кривых срезов нет.

Руки двигаются как у минифигурки, вид спереди: они только вращаются в плоскости кадра вокруг круглого плечевого шарнира, а кисти жёстко едут вместе с руками. Руки лежат под торсом: шарнир прячется под краем корпуса, и рука выходит из плеча без среза. Ничего не масштабируется и не искажается. Поднятые руки не заходят на лицо, размытия в движении нет, поэтому каждый кадр чёткий.

Скрипт создаёт 7 композиций 1080×1350, 30 fps, 5 с. Каждая зациклена без шва: кадр 5.00 совпадает с кадром 0.00.

| Композиция | Анимация | Превью |
|---|---|---|
| `LEGO_RED_DREADS` | **groove**: качает головой в бит (96 BPM, 8 долей за 5 с), пружинит, корпус и руки покачиваются из стороны в сторону | [mp4](preview/red_dreads.mp4) · [раскадровка](preview/red_dreads_storyboard.jpg) |
| `LEGO_ANGRY_CHAIN` | **rage**: замах, вскидывает обе руки вверх, трясётся от злости, резко бросает руки вниз и подпрыгивает-топает, тяжело дышит | [mp4](preview/angry_chain.mp4) · [раскадровка](preview/angry_chain_storyboard.jpg) |
| `LEGO_SMILE_VARSITY` | **wave**: поднимает руку высоко в сторону и машет, наклоняет к ней голову, слегка подпрыгивает | [mp4](preview/smile_varsity.mp4) · [раскадровка](preview/smile_varsity_storyboard.jpg) |
| `LEGO_ASTRO_BRICK` | **jump**: руки назад, прыжок с руками вверх, приземление с амортизацией, затем второй, более высокий прыжок «йей» с наклоном; тень на полу сжимается и бледнеет в воздухе | [mp4](preview/astro_brick.mp4) · [раскадровка](preview/astro_brick_storyboard.jpg) |
| `LEGO_RED_SUIT` | **point**: кивает, вытягивает руку в сторону и качает ею в такт, затем «raise the roof» обеими руками и возвращается | [mp4](preview/red_suit.mp4) · [раскадровка](preview/red_suit_storyboard.jpg) |
| `LEGO_BRICK_BRAIDS` | **shrug**: два медленных «крутых» кивка, большое пожатие плечами «ну и что» с наклоном головы, сбрасывает руки, откидывается | [mp4](preview/brick_braids.mp4) · [раскадровка](preview/brick_braids_storyboard.jpg) |
| `LEGO_VARSITY_BEAR` | **disco**: диско-поза — одна рука вверх по диагонали, другая вниз, смена в бит, покачивание бёдрами и головой | [mp4](preview/varsity_bear.mp4) · [раскадровка](preview/varsity_bear_storyboard.jpg) |

![RED_DREADS](preview/red_dreads_storyboard.jpg)
![ANGRY_CHAIN](preview/angry_chain_storyboard.jpg)
![SMILE_VARSITY](preview/smile_varsity_storyboard.jpg)
![ASTRO_BRICK](preview/astro_brick_storyboard.jpg)
![RED_SUIT](preview/red_suit_storyboard.jpg)
![BRICK_BRAIDS](preview/brick_braids_storyboard.jpg)
![VARSITY_BEAR](preview/varsity_bear_storyboard.jpg)

## Как собрать в After Effects

1. Подойдёт After Effects CC 2018 или новее.
2. Папка `vectors/` должна лежать рядом со скриптом. В ней контуры деталей каждого персонажа.
3. `File → Scripts → Run Script File…` → `build_lego_squad.jsx`.
4. В проекте появится папка `LEGO_SQUAD` с семью композициями. Откроется последняя.

Чтобы собрать одного персонажа, впишите его имя в `var ONLY = "";` в начале скрипта, например `"RED_SUIT"`.

## Слои (в каждой композиции)

Каждая деталь — отдельный шейп-слой. Внутри: группа `Outline` (обводка, сверху), группы `Print N` (принты: лицо, волосы, одежда, цепь и т. п.) и группа `Base` (заливка детали). Контуры лежат в координатах исходной картинки 1497×2000, поэтому Anchor Point каждой детали стоит в её суставе.

| Слой | Родитель | Что делает |
|---|---|---|
| `LEGS` | — | ноги; масштаб и место персонажа в кадре, прыжки — Position |
| `TORSO` | LEGS | корпус; дыхание — выражение на Scale |
| `HEAD` | TORSO | голова с волосами/причёской; повороты и кивки |
| `ARM_L`, `ARM_R` | TORSO | руки с круглым плечевым шарниром (слои под `TORSO`); Anchor Point в центре шарнира. Вся анимация рук — Rotation: у `ARM_L` плюс поднимает руку, у `ARM_R` минус |
| `HAND_L`, `HAND_R` | ARM_L / ARM_R | кисти, Anchor Point в запястье; едут вместе с рукой |
| `CONTROLS` | — | `Background` (цвет фона), `Breath` (сила дыхания) |
| `FLOOR_SHADOW`, `BG` | — | тень под ногами (реагирует на прыжки) и фон |

Анимация — обычные ключи Rotation и Position с плавным easing. Их можно двигать в таймлайне как обычно. Motion Blur в композициях выключен.

## Частые правки

- **Размер и место в кадре:** `scale` у персонажа в массиве `SQUAD` и `feet` в `CFG`, или Scale/Position у `LEGS`.
- **Цвет фона:** `bg` в `SQUAD` или `CONTROLS → Background`.
- **Поменять анимации местами:** в `SQUAD` замените `anim` (доступны `groove`, `rage`, `wave`, `jump`, `point`, `shrug`, `disco`). Позы рассчитаны на пропорции минифигурки, поэтому подходят любому персонажу.
- **Сделать спокойнее:** уменьшите `Breath` или удалите часть ключей у `HEAD`.

## Инструменты

```bash
pip install numpy opencv-python-headless pillow imageio-ffmpeg potracer
python3 tools/vectorize_squad.py <папка_с_картинками> vectors        # 10–14.webp, 20–21.webp -> vectors/*.jsxinc
python3 tools/anim_design.py                                           # ключи -> блок ANIMS в build_lego_squad.jsx
python3 tools/render_preview.py all --out-dir preview                  # превью mp4 + раскадровки
npm i acorn && node ../nike_loop/tools/ae_mock_check.js build_lego_squad.jsx
```

`vectorize_squad.py` режет персонажа на детали по швам минифигурки (плечи, пояс, манжеты), добавляет руке круглый плечевой шарнир (его цвет продолжает рукав), трассирует заливку детали до середины чёрного контура и цветные принты внутри неё; всё сглаживается кривыми Безье. `render_preview.py` строит превью из тех же контуров, рига и ключей, что и скрипт.

> Скрипт проверен на имитации API After Effects (7 композиций, 70 слоёв, 571 ключ, ошибок нет): настоящего AE в среде сборки нет. Если при запуске что-то пойдёт не так, текст ошибки будет в итоговом окне.
