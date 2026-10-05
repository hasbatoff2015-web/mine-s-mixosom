# Логотип «Мегакрафт Онлайн» и лимит ника 13

Дата: 2026-10-05.

Продолжение `docs/reports/2026-10-05_megacraft-menu-ui-polish.md`. Прошлые замечания не переписывались.

## Goal

Сделать логотип главного меню двухстрочным и крупнее собрать текущий блок меню. Ограничить ник 13 символами.

## Main menu

Логотип в `showMainMenu()` — два элемента внутри `.megacraft-logo`: `МЕГАКРАФТ` и `ОНЛАЙН`. Экран загрузки остаётся одной строкой «МЕГАКРАФТ».

- Заголовок: `clamp(56px, 7vw, 112px)`, серебристый `#d8dad6`, тот же Press Start 2P, обводка и слоистая тень.
- Подзаголовок: `clamp(22px, 2.9vw, 42px)`, оливково-золотой `#d2dc62`, по центру, легче тень. Это часть логотипа, не бейдж.
- На 1920 заголовок 112px, подзаголовок 42px, оба по центру 960. На 1366: 96px и 40px.
- Блок поднят за счёт нижнего padding у `.main-menu-layout`. На 1920 верх заголовка около 150px, на 1366 около 46px. К верхнему краю не прилипает.
- Центр: `min(1080px, calc(100vw - 42px))`, колонки `minmax(300px, 1fr)` и `minmax(260px, 380px)`, gap 28px.
- Кнопки корневого меню: min-height 62px, font-size 13px. На 1920 ширина кнопки 672px.
- Панель персонажа: padding 18px, canvas `clamp(320px, 36vh, 380px)`. На 1920 canvas 340×380, на 1366 340×320. Кнопка «Выбрать скин» 58px.
- Камера превью не менялась. Запас кадра около 6.6–7.3% сверху и снизу.
- Короткий landscape по-прежнему масштабируется через `--menu-fit`. Там заголовок 72px и canvas 260px до zoom, чтобы блок не вылезал. Фон `/ui/frontier-menu-background.png` тот же.

## Nickname

Было `MAX_PLAYER_NAME_LENGTH = 20`. Стало 13. Минимум 2. Шаблон `^[A-Za-z0-9]+$`. Пробелы не обрезаются.

Обновлены `shared/config.ts`, текст ошибки в `shared/playerName.ts` (он собирается из констант), `maxlength` инпута (та же константа) и `ONLINE_NICKNAME_HINT`: «2–13 символов · только A–Z и 0–9». `PROTOCOL_VERSION` остаётся 4. Ключ `fc.player.nickname` тот же. Ник длиннее 13 читается как незаданный и не уходит в join.

## Tests

`npx vitest run` по `ui-main-integration`, `menu-model`, `online-server-menu`, `player-nickname`, `server/console-and-nickname`.

PASS: 5 files, 32 tests.

`npm run typecheck:client` PASS. `npm run typecheck:server` PASS. `npm run check:boundaries` PASS. `npm run build` PASS. `git diff --check` PASS.

## Visual QA

Локальный Vite `http://127.0.0.1:4173`.

- 1920×1080 и 1366×768: две строки логотипа, кнопки 62px, панель шире и выше, фон на месте, горизонтального выхода нет.
- 844×390 и 667×375: две строки, side-by-side, overflow 0.
- Ник: helper «2–13…». 13 латинских символов сохраняются. 14-й символ с клавиатуры не вводится (`maxlength` 13). Значение из 14 символов, кириллица, пробел и один символ дают ошибку. `Player13` сохраняется.

Телефон не проверялся. Production не выкладывался. Ветка с `main` не синхронизировалась.

## Git

Та же ветка `cursor/megacraft-menu-ui-refresh-3c91`, PR #117. Не влито.
