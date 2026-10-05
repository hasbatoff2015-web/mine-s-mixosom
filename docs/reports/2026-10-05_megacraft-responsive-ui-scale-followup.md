# Масштаб меню и высота выбора скина

Дата: 2026-10-05.

Продолжение уже принятого меню. PNG серверов, ник, подписи и drag не менялись.

## Mobile scale

Единственный масштаб короткого landscape — `--menu-fit` на `#app`, его читает `zoom`.

- Было 0.50 при `max-height: 520px`. Стало 0.65. Это ровно +30%.
- Было 0.42 при `max-height: 430px`. Стало 0.55. 0.42 × 1.30 = 0.546, взято 0.55.
- `transform: scale` не добавлялся. Числа логотипа, кнопок и canvas до zoom в этом media query оставлены прежними: 72px, 28px, 260px, min-height 52px. Колонки центра тоже зафиксированы на прежних `minmax(300px, 1fr)` и `minmax(260px, 380px)`, чтобы новые desktop-минимумы не вылезали на узком экране.
- Окно: ширина `min(920px, (100vw - 32px) / fit)`, высота не выше `(100dvh - 20px) / fit`.

844×390 и 667×375 попадают в порог 430px, поэтому там действует 0.55, не 0.65.

## Skin selector

Пустота была из-за `max-height: min(560px, calc(100dvh - 220px))` у сетки и `height: min(420px, calc(100dvh - 220px))` у большого canvas. Строка окна уже была `minmax(0, 1fr)`, но содержимое заканчивалось раньше.

В `max-height: 520px` тело селектора занимает эту строку. Превью — `minmax(0, 1fr) auto`: canvas на всю оставшуюся высоту, подсказка снизу. Сетка: `height: 100%`, `max-height: none`, `align-content: start`, прокрутка внутри. Карточки и `minmax(92px, 1fr)` не менялись. Футер по-прежнему третья строка окна.

На 844×390 измерено: 5 карточек в ряд, 25 из 45 видны без прокрутки, зазор сетки до футера 7px, canvas `clientHeight` 457. На десктопе 1366 большое превью остаётся прежним потолком 420px.

## Desktop main menu

Без zoom.

- Логотип: `clamp(64px, 7.8vw, 128px)` и `clamp(26px, 3.2vw, 46px)`. На 1920 это 128px и 46px. На 1366 это 107px и 44px.
- Центр: `min(1180px, calc(100vw - 48px))`, колонки до 420px, gap 32px.
- Кнопки: 70px и 14px. «Выбрать скин»: 64px и 13px.
- Canvas: `clamp(340px, 38vh, 420px)`. На 1920 высота 410px, на 1366 высота 340px. Низ панели на 1366 — 703px из 768. Запас модели около 7% сверху и снизу.

## Tests

`npx vitest run` по `ui-main-integration`, `player-skin-selector`, `mobile-controls-sky-hud`, `online-server-menu`, `menu-model`.

PASS: 5 files, 54 tests.

`npm run typecheck:client` PASS. `npm run typecheck:server` PASS. `npm run check:boundaries` PASS. `npm run build` PASS. `git diff --check` PASS.
