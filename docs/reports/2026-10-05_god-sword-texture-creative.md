# Текстура Меча бога и Creative catalog

Дата: 2026-10-05.

## Goal

Перекрасить `god_sword` внутри той же alpha-маски и показать его в Creative catalog. Боевую механику не менять.

## Result

Спрайт остаётся 32×32 RGBA с точной маской `assets/minecraft/textures/items/iron_sword.png`. Рукоять больше не деревянная. Кромка имеет authored яркость, а не повтор `index % 5`. Creative берёт один список `creativeCatalogItems()`. `obtainableItems()` по-прежнему не содержит меч. `forceLethal`, Totem и одноразовость в Survival не менялись.

## Texture

Источник: `assets/minecraft/textures/items/iron_sword.png`. Генератор: `generate_god_sword()` в `scripts/generate-tier-assets.py`. Пиксели вне маски не добавляются.

Металл:

- `#080A0E`, `#0E141B` — только короткий задний край клинка, 5 и 4 пикселя
- `#18232D` — тёмная поверхность и остальной контур
- `#263542` — более светлая грань исходного спрайта
- `#384B5B` и `#52697A` — 7 пикселей ломаного внутреннего ridge

Рукоять: `#090C11`, `#111720`, `#1B242E`, `#2C3945` по luminance исходной деревянной рукояти.

Красный: `#4B0711`, `#700B19`, `#A61127`, `#D91E37`, `#FF3F4C`, `#FF776D`.

- кромка: 18 пикселей, порядок от острия к гарде задан списком, без `index % N`
- отражение на металле: 2 пикселя, `#700B19` и `#4B0711`
- верхняя fissure: 3 пикселя
- нижняя fissure: 2 пикселя
- ядро гарды: 3 пикселя, один из них `#FF776D`
- уникальных красных: 28
- `#D91E37` или ярче: 6
- `#FF776D`: 1

Средняя luminance металла God Sword около 51% металла Titanium Sword на тех же координатах, внутри 50–70%. Шесть разных цветов металла. Ruby и Titanium PNG генератор не переписывает, если пиксели не изменились.

## Creative

Раньше `GameUI` и `applyInventoryUiAction` брали `obtainableItems()`, а у меча стояло `hiddenFromGameplay: true`, поэтому каталог его не показывал.

Теперь `creativeCatalogItems()` включает обычные предметы и hidden-предметы с `creativeCatalog: true`. Отрисовка слотов и клик `creative-${index}` идут через этот список и `creativeCatalogGrant`. `maxStack` 1, поэтому и левый, и правый клик дают один меч. Крафт, плавка и лут не затронуты.

В Creative расход прочности не добавлялся: текущие правила Creative уже не тратят durability.

## Gameplay

`server/gameplay.ts` и ветка `forceLethal` в `SurvivalSystem.damage` не менялись.

## Changed files

- `scripts/generate-tier-assets.py`
- `public/textures/item/god_sword.png`
- `src/items/types.ts`
- `src/items/registry.ts`
- `src/ui/GameUI.ts`
- `src/inventory/inventoryUiAction.ts`
- `tests/god-sword.test.ts`
- `tests/god-sword-texture.test.mjs`
- `docs/PROJECT_STATE.md`
- `docs/ROADMAP.md`
- `docs/ARCHITECTURE.md`
- `docs/reports/2026-10-05_god-sword-texture-creative.md`

Средняя luminance металла God Sword на тех же координатах: 43.60 против 85.25 у Titanium Sword, отношение 0.511. Это внутри обязательного коридора 0.50–0.70. Поднять среднее к 0.55 можно было бы, только перекрасив серую полосу исходного меча (luminance 68) в тот же `#263542`, что и светлая грань. Тогда тёмный и средний металл перестали бы различаться. Оставлены оба.

## Tests

Локально. Каталога `.github` нет, GitHub Actions нет.

`npx vitest run tests/god-sword.test.ts tests/god-sword-texture.test.mjs tests/server/god-sword.test.ts tests/item-rendering.test.ts tests/third-person-held-item.test.ts tests/sword-blocking-visual.test.ts tests/inventory.test.ts tests/server/utility-items-authority.test.ts tests/combat.test.ts tests/survival-death-invariant.test.ts tests/utility-items.test.ts tests/held-item-vanilla-transform.test.ts tests/totem-burst.test.ts tests/ruby-titanium-equipment.test.ts tests/crafting-catalog.test.ts tests/content-pass.test.ts`

16 files, 240 passed.

`npx vitest run tests/server/melee-lag-compensation.test.ts tests/classic-combat-integration.test.ts`

29 passed, 2 failed. Оба падения в `tests/classic-combat-integration.test.ts`: `mobileSneakAfterFlight` читает незаданный `state.mode`. Тот же файл падает так на `main` `1bf929c`. Melee lag compensation в этом прогоне зелёный.

`npx tsc --noEmit` PASS. `npm run build` PASS. `npm run check:boundaries` PASS.

## Visual QA

Dev-сервер `npm run dev`, Chrome headless.

- `/?qaUi=creative`: каталог открыт, слот `creative-185` содержит `textures/item/god_sword.png`. Рядом обычные мечи того же размера. Клик по слоту записал в `#cursor-stack` ту же текстуру.
- `/?qaItem=god_sword&qaView=held`, и те же URL для titanium и ruby: position `0.67, -0.29, -0.7`, rotation pitch 1 / yaw -90 / roll 34, scale `0.6`, texture 32×32, opaque 253, depth 0.0625. У трёх мечей эти числа совпали.
- `/?qaPlayer=1`: third-person back, orbit 70°, статус `held god_sword`. Клинок обычного размера, тёмный, с красной кромкой. First-person того же harness показывает тот же спрайт в стандартной руке.

Не проверялось в живой сессии двух игроков: удар Survival, спасение Тотемом и поломка блока. Это покрыто `tests/server/god-sword.test.ts`. Расход прочности в Creative специально не менялся.
