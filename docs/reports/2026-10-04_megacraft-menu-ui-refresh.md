# Мегакрафт — обновление меню

Дата: 2026-10-04.

## Goal

Обновить главное меню и связанные экраны: бренд «МЕГАКРАФТ», ник на экране онлайн-серверов, карточки трёх серверов, ручной поворот превью скина, справка по фактическому управлению, общий пиксельный шрифт на основных подписях меню. Фон меню и gameplay/network не менять.

## Result

Игрок видит одну строку «МЕГАКРАФТ». Вкладки «Аккаунт» нет. Ник 2–20 символов, только латиница и цифры, сохраняется на экране «Играть онлайн» и уходит в существующий join. Три сервера остались с теми же именами и порядком; у каждого своя inline-SVG иконка и три сменяющиеся подписи на CSS. Classic/Slim больше не показываются. Большой preview скина крутится мышью и касанием. Справка по управлению совпадает с текущим input и не показывает F3/F7/F8/F9.

## Implemented

- Логотип и экран загрузки: одна строка «МЕГАКРАФТ». Footer «playable alpha» удалён. `index.html` title — «Мегакрафт».
- `MIN_PLAYER_NAME_LENGTH = 2`, `MAX_PLAYER_NAME_LENGTH = 20`, `PLAYER_NICKNAME_PATTERN = /^[A-Za-z0-9]+$/`. `sanitizePlayerName` не обрезает пробелы. Ключ `fc.player.nickname` сохранён. Невалидное старое значение читается как незаданное.
- Полоса ника между заголовком и списком серверов. «Подключиться» читает последний успешно сохранённый ник, а не черновик.
- Иконки survival / peaceful / anarchy — inline SVG 48×48 в плитке 56px. Подписи крутятся CSS-анимацией 9s, первая видна сразу. `prefers-reduced-motion` оставляет первую.
- `PlayerSkinSelectorSession.selectSkin` по-прежнему ставит `descriptor.defaultModel`. UI-переключатель модели и подписи Classic/Slim сняты. `setModel` остаётся внутренним.
- `PreviewRotation` крутит yaw на 0.35 рад/с и ставит паузу только на время drag. Чувствительность 0.012 рад/px. Главное меню по-прежнему только автокрутка.
- Справка: «Движение», «Игровой процесс», «Мобильное управление». Секции «Диагностика» в справке нет. Обработчики F3/F7/F8/F9 в `Game.ts` не удалялись.
- Press Start 2P (`--font-display`, weight 400) на основных подписях меню. Inter остаётся у подсказок, счётчиков, URL и подписей серверов. `body`, чат и HUD не переводились.

## Changed files

- `index.html`
- `shared/config.ts`
- `shared/playerName.ts`
- `src/core/Game.ts`
- `src/rendering/player/PlayerAppearancePreview.ts`
- `src/style.css`
- `src/ui/GameUI.ts`
- `src/ui/menuModel.ts`
- `src/ui/skinPreviewDrag.ts`
- `tests/menu-model.test.ts`
- `tests/mobile-controls-sky-hud.test.ts`
- `tests/online-server-menu.test.ts`
- `tests/player-nickname.test.ts`
- `tests/player-skin-selector.test.ts`
- `tests/server/console-and-nickname.test.ts`
- `tests/ui-main-integration.test.ts`
- `docs/PROJECT_STATE.md`
- `docs/ARCHITECTURE.md`
- `docs/ROADMAP.md`

## Architecture decisions

- Валидация ника одна, в `shared/playerName.ts`. Клиент, join и `parseClientMessage` не расходятся.
- Жест pointer остаётся в `GameUI` / `SkinPreviewDragTracker`. Yaw остаётся в `PlayerAppearancePreview`.
- Подписи серверов не используют `setInterval`.
- Короткий landscape по-прежнему масштабируется только `--menu-fit`. Узкий высокий portrait складывает две колонки главного меню в одну и не добавляет второй zoom.
- `#app.controls-suppressed canvas` глушит клики по игровому canvas. Большой preview скина явно получает `pointer-events: auto`, иначе drag не доходит до элемента.

## Tests

`npx vitest run` по семи файлам: 7 files, 65 tests, PASS.

`npm run typecheck:client`, `npm run typecheck:server`, `npm run check:boundaries`, `npm run build`, `git diff --check` — PASS.

## Visual QA

Локальный Vite `http://127.0.0.1:4173`, Chrome headless.

- 1920×1080, 1366×768, 844×390, 667×375: одна строка «МЕГАКРАФТ», три кнопки рядом с панелью персонажа, без футера и без «Аккаунт».
- 390×844: логотип внутри viewport, меню в одну колонку, панель персонажа целиком.
- Онлайн: полоса ника, три SVG, без «FC», первая подпись видна, «Подключиться» не зависит от черновика.
- Скин: нет Classic/Slim, hint есть, ЛКМ и touch ставят `.is-dragging`, правая кнопка нет, страница не скроллится.
- Управление: «Использовать / поставить блок» целиком; мобильная секция видна после прокрутки; F7 в тексте справки нет.
- Настройки: «Чувствительность мыши» в одну строку, без обрезки.

DEV `https://dev.megacraft.agariobrainrot.ru` не открывался. Production не менялся.

## Performance

Подписи серверов — одна CSS-анимация. Отдельного renderer и сетевых сообщений для ника нет.

## Known issues

- На 1366×768 последняя строка desktop-справки и блок «Мобильное управление» начинаются ниже первого экрана окна. Они в том же scroll.
- Голова превью по-прежнему близко к верхнему краю canvas. Камера не менялась.
- `readPixels` у preview пустой: у renderer нет `preserveDrawingBuffer`. Поворот проверялся состоянием drag и `PreviewRotation`, не сравнением пикселей кадра.

## Deferred

- Телефонный QA владельца.
- Выкладка на DEV и production.

## Next work

Не мержить, пока владелец не посмотрит Draft PR.

## Git

Ветка `cursor/megacraft-menu-ui-refresh-3c91` от `origin/main` `620e812fb681ae946780c61ef024fc9ff55aa3e5`. Суффикс `-3c91` обязателен для этой среды. Не влито.
