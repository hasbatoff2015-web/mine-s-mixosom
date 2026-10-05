# PNG-эмблемы серверов

Дата: 2026-10-05.

## Goal

Заменить inline SVG иконок серверов на три PNG, которые сгенерировал владелец.

## Assets

Файлы взяты из коммита `460e402` ветки `origin/cursor/megacraft-menu-ui-refresh`, каталог `public/ui/server_logos/`. В эту ветку они положены по пути из задачи, без слияния той ветки.

- `public/ui/server-logos/anarchy_logo.png` — 1254×1254 RGBA, 1 507 976 байт
- `public/ui/server-logos/survival_pvp_logo.png` — 1254×1254 RGBA, 859 741 байт
- `public/ui/server-logos/peaceful_logo.png` — 1254×1254 RGBA, 1 114 716 байт

Углы прозрачные. У анархии отдельные пиксели взрыва доходят до края файла, поэтому у плитки padding 2px.

## Implementation

`serverIconSvg()` удалён. Карточка рисует `<img class="server-icon-image">`. Классы `server-icon--anarchy|survival|peaceful` остались. Цветные градиенты плиток и `brightness` у выбранной карточки сняты, чтобы не красить PNG. Плитка 56×56, фон `#121212`, `image-rendering: pixelated`. Имена, подписи, порядок и подключение не менялись.

## Tests

`npx vitest run tests/menu-model.test.ts tests/online-server-menu.test.ts tests/ui-main-integration.test.ts`

PASS: 3 files, 21 tests.

`npm run typecheck:client` PASS. `npm run check:boundaries` PASS. `npm run build` PASS. `git diff --check` PASS.
