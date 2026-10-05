# Полировка меню «Мегакрафт»

Дата: 2026-10-05.

Продолжение `docs/reports/2026-10-04_megacraft-menu-ui-refresh.md`. Прошлый отчёт не переписывался: перечисленные там замечания были реальными и закрываются здесь.

## Goal

Исправить шесть замечаний владельца после ручной проверки PR #117: значок и размер загрузки, пустая композиция главного меню, обрезка модели, дёрганье drag, мелкие подписи настроек, слабые иконки серверов, двойной процент загрузки мира.

## Owner QA findings

1. На загрузке над «МЕГАКРАФТ» стоял декоративный `.brand-mark`, а заголовок был мелким.
2. После удаления Account и footer сетка `1fr auto 1fr` оставляла пустую нижнюю строку. Модель в превью была слишком крупной и резалась.
3. Подписи серверов крутились правильно, но inline SVG выглядели как тонкие пиктограммы.
4. Названия настроек на Press Start 2P были 9px.
5. Быстрый плавный drag дёргал модель. Голова и корпус расходились.
6. Процент загрузки мира рисовался дважды.

## Root causes and fixes

- Значок: `showLoading()` вставлял `<div class="brand-mark">`. Других production callers не было. Разметка и CSS `.brand-mark` удалены. Заголовок загрузки: `#loading-screen .brand h1` `clamp(34px, 4.8vw, 46px)`. На коротком landscape: `clamp(26px, 4.6vw, 34px)`. Общий `.brand h1` не увеличен.
- Пустое меню: `.main-menu-layout` теперь `grid-template-rows: auto auto` и `align-content: center`. Зазор между логотипом и центром — `row-gap`. Кнопки главного меню 56px и 13px. Большой тёмной плиты нет. `--menu-fit` для короткого landscape сохранён.
- Обрезка: одна камера у `PlayerAppearancePreview`. При `z = 3.6` измерение кадра дало около 1% сверху и 0% снизу: вертикальный FOV 28° на этой дистанции почти равен росту модели. Итоговая камера `position (1.35, 1.15, 4.2)`, `lookAt (0, 0.9, 0)`. Геометрия игрока и размер canvas не менялись. Повторный замер canvas на 1920, 1366, 844, 667 и portrait: запас 6.8–7.1% сверху и снизу.
- Дёрганье: preview yaw уходил в `PlayerVisual.update` как `viewYaw`. `PlayerVisualAnimator` ограничивает голову 72° и догоняет корпус через `dampAngle`. Теперь yaw пишется в `turntable.rotation.y`, а аниматор получает `viewYaw: 0` и `viewPitch: 0`. Скорости 0.35 рад/с и 0.012 рад/px те же. Инерции нет.
- Настройки: `.setting-row > span strong` — 11px, на обычной ширине `nowrap`. На 1366×768 «Чувствительность мыши» в одну строку и не пересекает `0.0022`. Уже 720px перенос разрешён, потому что сетка там в одну колонку.
- Двойной процент: `worldLoadView()` клал `63%` в `detail`, а `data-loading-percent` рисовал то же число под полосой. Обычные фазы и `ready` теперь дают `detail = ''`. Ошибка по-прежнему отдаёт текст ошибки. Стартовый вызов больше не передаёт «Подготовка мира…». Строка `data-loading-detail` остаётся для endpoint и других загрузок.
- Иконки: те же три смысла, но залитые блочные фигуры, `shape-rendering="crispEdges"`, `viewBox="0 0 48 48"`, в плитке SVG 48px. Новых файлов нет.

## Changed files

- `src/ui/GameUI.ts`
- `src/ui/menuModel.ts`
- `src/style.css`
- `src/core/Game.ts`
- `src/core/worldLoading.ts`
- `src/rendering/player/PlayerAppearancePreview.ts`
- `tests/ui-main-integration.test.ts`
- `tests/menu-model.test.ts`
- `tests/player-skin-selector.test.ts`
- `tests/world-loading.test.ts`
- `docs/PROJECT_STATE.md`
- `docs/ROADMAP.md`

## Tests

`npx vitest run` по восьми файлам: `ui-main-integration`, `menu-model`, `online-server-menu`, `player-skin-selector`, `world-loading`, `mobile-controls-sky-hud`, `player-nickname`, `server/console-and-nickname`.

PASS: 8 files, 70 tests.

`npm run typecheck:client` PASS. `npm run typecheck:server` PASS. `npm run check:boundaries` PASS. `npm run build` PASS. `git diff --check` PASS.

## Visual QA

Локальный Vite `http://127.0.0.1:4173`.

- 1920×1080, 1366×768, 844×390, 667×375 и 390×844: логотип и кнопки один блок, без пустого footer-ряда, кнопки 56px / 13px, горизонтального выхода нет, «Аккаунт» нет.
- Загрузка текстур: нет значка, заголовок 46px, одна полоса.
- Загрузка мира: фаза «Генерируем чанки», один процент под полосой, detail скрыт.
- Настройки 1366: подписи 11px, «Чувствительность мыши» в одну строку и не пересекает `0.0022`.
- Превью после камеры `z = 4.2`: на всех пяти размерах запас кадра 6.8–7.1% сверху и снизу. Drag поворачивает всю модель, лицо и корпус смотрят в одну сторону.
- Иконки: щит и меч, дом и лист, сломанный щит с оранжевым ударом. Букв FC нет.

DEV и production не выкладывались. Ветка не синхронизировалась с уехавшим `main`.

## Known issues

- `z = 4.2` дальше диапазона 3.55–3.70. В том диапазоне модель всё ещё упиралась в край canvas. Запас кадра около 7%, чуть ниже ориентира 7–10%.
- Анархия читается как сломанный щит. Звезда взрыва видна по краям, не как отдельный крупный символ.
- Телефон владельца этим проходом не проверялся.

## Git

Та же ветка `cursor/megacraft-menu-ui-refresh-3c91`, PR #117. Не влито.
