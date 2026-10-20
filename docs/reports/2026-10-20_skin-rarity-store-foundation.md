# Каталог редкости скинов, сортировка и UI

## Goal

Экран «Выбор скина» должен показать 64 игровых скина в четырёх категориях редкости, не ломая автоматическую регистрацию PNG. Превью остаётся доступным всем. Надеть заблокированный скин через кнопку нельзя. Реклама и платежи на этом этапе не вызываются и не имитируют выдачу.

## Result

Каталог редкости живёт отдельно от PNG. В нём ровно 40 обычных, 14 редких, 8 эпических и 2 легендарных id. `frontier_explorer` первый и бесплатный. Остальные обычные помечены как реклама на каждую новую смену. Редкие и эпические имеют внутренние SKU и целевые цены. Легендарные не продаются и не открываются ником.

Кнопка подтверждения берёт состояние из `resolveSkinActionState`. Живая игра передаёт пустой снимок доступа. Обычный ненадетый скин даёт «Реклама скоро», редкий и эпический — «Покупки скоро» и целевую цену, легендарный — «Недоступно». Нажатие не вызывает `setPlayerAppearance`. Сервер по-прежнему принимает любой зарегистрированный `skinId`. Это не защита покупок.

## Implemented

- `src/player/appearance/skinStoreCatalog.ts` — редкость, способ получения, порядок, SKU и наборы. Без DOM, Three.js, Vite и SDK.
- `src/player/appearance/skinActionState.ts` — чистое состояние кнопки. Сломанный снимок доступа ничего не открывает.
- `src/player/appearance/skinEntitlementPolicy.ts` — будущая серверная проверка `evaluateServerSkinEquip`. `WorldInstance.setAppearance` её не вызывает.
- `src/player/appearance/skinMonetizationContracts.ts` — типы будущего rewarded-просмотра и покупки. Игровой код их не вызывает.
- Генератор PNG по-прежнему пишет текстуры. Если у игрового PNG нет редкости, `skins:check` и production build падают с `Skin <id> has no rarity metadata.`
- Селектор сортирует карточки, рисует заголовки на всю ширину сетки, цветные рамки и два набора: 99 ₽ и 299 ₽. Один большой 3D-превью. Миниатюры остаются 2D.

## Changed files

- `src/player/appearance/skinStoreCatalog.ts`
- `src/player/appearance/skinActionState.ts`
- `src/player/appearance/skinEntitlementPolicy.ts`
- `src/player/appearance/skinMonetizationContracts.ts`
- `src/player/appearance/PlayerSkinSelector.ts`
- `src/ui/GameUI.ts`
- `src/core/Game.ts`
- `src/style.css`
- `server/WorldInstance.ts` — только комментарий у `setAppearance`. Поведение whitelist не менялось.
- `scripts/generate-player-skins.mjs`, `scripts/generate-player-skins.d.mts`
- `tests/skin-store-catalog.test.ts`
- `tests/player-skin-selector-menu.test.ts`
- `tests/player-skin-selector.test.ts`
- `docs/SKIN_STORE.md`, `docs/ARCHITECTURE.md`, `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`

## Architecture decisions

Три вопроса не смешиваются.

| Вопрос | Где ответ |
| --- | --- |
| Как выглядит скин? | PNG и `generatedPlayerSkins.ts` |
| Насколько он редкий и как его получить? | `skinStoreCatalog.ts` |
| Можно ли этому игроку его надеть? | Будущий `evaluateServerSkinEquip` |

Порядок меню фиксирован списками id, не именем файла и не алфавитом. Внутри категории порядок совпадает с утверждённым списком. `frontier_explorer` стоит первым среди обычных.

Реклама на обычный скин не создаёт постоянное право. Будущий сервер должен принять один `rewardedSkinId` и стереть его до применения, иначе один callback откроет второй скин. Покупка набора даёт все id своей категории. Покупка одного id не открывает соседние. Легендарный id проходит только если сервер явно положил этот id в `adminLegendarySkinIds`. Ника, OP и клиентского `isAdmin` в контракте нет.

Пока enforcement выключен, функция описывает сегодняшний whitelist. Включать отказ нельзя, пока не решена миграция старых сохранений: «скин был надет» не равно «право доказано». Старые сохранения этот этап не стирает и не превращает в покупку.

Клиентский `accessSnapshot` — только отражение будущего ответа сервера. Живая кнопка его не придумывает из localStorage. Серверная функция снимок браузера не принимает.

Новая база не нужна: редкость — статические данные в репозитории, права появятся в серверном состоянии следующего этапа.

## Classification

| Категория | Количество | Получение |
| --- | --- | --- |
| common | 40 | `frontier_explorer` — default. Остальные 39 — `rewarded_ad` |
| rare | 14 | покупка, цель 29 ₽, набор `skin_pack_all_rare` 99 ₽ |
| epic | 8 | покупка, цель 149 ₽, набор `skin_pack_all_epic` 299 ₽ |
| legendary | 2 | `admin_only`, без SKU и без рекламы |
| total | 64 | |

Легендарные id: `ae1fddb72664eaf2`, `e126128225dccc51`. Конкретных id аккаунтов ещё нет, поэтому UI обоих не подтверждает.

`buyer_merchant`, `player_uv_test` и удалённый `10126ef69e2cdfdf` в магазин не входят.

## Tests

Новые и затронутые тесты прошли:

- `tests/skin-store-catalog.test.ts` — 12
- `tests/player-skin-selector.test.ts` — 15
- `tests/player-skin-selector-menu.test.ts` — 11
- `tests/player-skin-catalog.test.mjs` — 10
- `tests/player-skin-assets.test.mjs` — 3
- `tests/player-skins.test.ts` — 14
- `tests/server/player-appearance.test.ts` — 6

Команды:

| Команда | Результат |
| --- | --- |
| `npm run skins:check` | PASS |
| `npm run assets:validate-player-skins` | PASS |
| `npm run typecheck` | PASS |
| `npm run typecheck:client` | PASS |
| `npm run typecheck:server` | PASS |
| `npm run check:boundaries` | PASS |
| целевые skin/appearance тесты | PASS, 71 тест |
| `npm run build` | PASS |
| `npm run build:server` | PASS |
| `npm run check:size` | PASS, 11.73 MiB |
| `npm run check:archive` | PASS |
| `npm test` | 3429 passed, 36 failed, 1 skipped |
| `npm run test:server` | 837 passed, 5 failed, 1 skipped |

Сравнение с `origin/main` `8dc3301` в этой же среде: те же файлы, которые упали в полном прогоне, на main дают те же классы ошибок (God Sword, лук, pet hit, оверлеи ломания, SFX, PIL, тайминги). Дополнительные падения полного прогона — `automine`, четыре теста mega-zombie, `pets-performance` и `anarchy-server` — при отдельном запуске на этой ветке проходят. Таймаут `never fuses a mini creeper` воспроизводится и на `origin/main`. `tick-load-flight` падает и на main. Ни один skin-тест в FAIL не входит.

## Visual QA

Проверено в браузере на `http://localhost:5173/`.

- 1920×1080 и 1366×768: пять колонок, футер внутри окна, горизонтальной прокрутки нет, 64 карточки, первый id `frontier_explorer` и он выбран.
- Жёлтый outline выбора (`#ffe65a`) остаётся вместе с рамкой редкости: серая `#8d8d8d`, синяя `#439bef`, фиолетовая `#aa65e8`, золотая `#e9b345`.
- Наборы читаются: «Все редкие скины» 99 ₽ и «Все эпические скины» 299 ₽. Кнопки наборов disabled.
- Обычный ненадетый скин: «Реклама скоро», кнопка disabled, меню не закрывается.
- Редкий: «Покупки скоро» и «Целевая цена: 29 ₽». Эпический: 149 ₽. Легендарный: «Недоступно» и текст про администратора. Клик по disabled не закрывает экран.
- Смена карточек не сбрасывает `scrollTop`. Один preview canvas и 64 плоских миниатюры.
- Телефон 844×390, landscape: футер на экране, сетка без горизонтального скролла, колонок больше пяти из-за короткого зума меню.
- Телефон 390×844, coarse pointer: поверх игры оверлей «Поверните устройство». Это прежнее поведение, не новое меню.

3D-превью на десктопе меняет модель при выборе карточки, в том числе легендарную. Вращение превью видно на отдельном проходе: модель показывает спину, карточка остаётся выбранной.

## Performance

Клиентский JS относительно `origin/main`: 1 743.91 KiB → 1 752.23 KiB, gzip 498.81 → 501.92 KiB. CSS 121.26 → 125.26 KiB. В граф клиента добавились каталог и резолвер кнопки. Каталог не скачивается отдельно и не опрашивает сервер. На каждую карточку нет своего WebGL. Дополнительных npm-зависимостей нет. Сборка остаётся 11.73 MiB, внутри лимита архива.

В DOM к прежним 64 карточкам добавлены 4 заголовка, 2 строки наборов и маленькие замки на редких, эпических и легендарных карточках. Список не пересоздаётся при клике.

## Known issues

Прямой пакет `appearance` по-прежнему надевает редкий, эпический или легендарный скин, если id зарегистрирован. UI это не закрывает. Цены на экране — целевые суммы владельца, не ответ Яндекс Игр. Реклама и покупки не подключены. Два легендарных скина никому не выданы, потому что серверных id администраторов ещё нет.

## Deferred

- Этап 2: авторитетная проверка после идентификации из PR #129. Отдельное решение, что делать со старыми надетыми платными и легендарными скинами. Не записывать их как покупку.
- Этап 3: добровольная rewarded-реклама, пауза игры и звука, один `onRewarded` на одну смену, отмена без смены скина.
- Этап 4: каталог Яндекса, настоящие SKU, проверка покупки, восстановление и наборы.

## Next work

Владелец смотрит селектор на своём ПК и телефоне. Merge не делался. PR #129 не менялся.

## Git

Ветка `cursor/skin-rarity-store-foundation`. База `origin/main` `8dc33012eaf506775384bcede488ababe0ce6099`. Draft PR #135: https://github.com/hasbatoff2015-web/mine-s-mixosom/pull/135. В main не влито.
