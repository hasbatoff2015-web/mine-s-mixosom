# AGENTS.md

Постоянные правила для любого AI-агента. Это не история проекта и не feature list.

Перед работой читай `docs/PROJECT_STATE.md` и самый свежий файл в `docs/reports/`. Источник истины — **текущий код** и свежая документация. Старый report, который им противоречит, устарел.

## Что это

**Frontier Cubes** — браузерная voxel survival alpha на TypeScript и Three.js. Цель публикации — Яндекс Игры.

Minecraft Java Edition 1.9 — **reference** для чисел и особенно PvP. Не цель полной копии, не копировать код/название/branded assets Minecraft.

## Scope

Входит: compact world (`16×16×80`, ~50 блоков до bedrock), Plains/Forest/Desert, Coal/Iron/Gold/Redstone/Diamond, Java 1.9-style combat, basic redstone, Survival + Creative, desktop + landscape mobile.

Не входит и не добавлять самостоятельно: Lapis, farming, XP/enchanting/potions, Nether/End, villagers/trading, advanced redstone, weather.

**Multiplayer:** local authoritative Anarchy (`npm run dev:server`, `Играть онлайн → Анархия PvP`) is in scope as already implemented. Do not add accounts, Colyseus, Survival PvP matchmaking, or a second protocol. Shared simulation must stay Node-safe (no Three/DOM/IndexedDB/fs). PluginManager is the Anarchy plugin platform (Phase 8). Do not add homes/TPA/economy/kits unless that is the task.

Не расширяй scope без явной задачи. Наличие текстуры в `assets/` не означает разрешение на feature.

## Симуляция и кадр

- Gameplay — fixed **20 TPS** (`FIXED_DT = 0.05`). Render — `requestAnimationFrame`.
- Не привязывай gameplay, физику, combat, mining и world tick к FPS.
- Live camera look (`applyImmediateRenderLook`) обновляется каждый кадр из input. Не квантизуй обзор по 20 TPS. Физика и сериализуемый view остаются на fixed tick.

## Не создавать параллельные системы

Расширяй существующее. Не заводи вторую реализацию той же подсистемы.

Канонические точки расширения:

- `ChunkMesher` / `WorldRenderer` / `TextureAtlas`
- `LegacyModel` + `mobModels.ts`
- `ItemVisualFactory` / `GeneratedItemGeometry` / `FirstPersonRenderer`
- `ArrowPhysics` / `ArrowVisualFactory`
- `CombatSystem`

Плохо: `NewChunkMesher2`, `BetterMobRenderer`, `OldInventory` + `NewInventory`.

Сохраняй уже сделанные оптимизации: budgeted meshing, generation/mesh не в одном tick, column cache, mip-safe atlas, HUD/F3 throttling, shared visual caches, bounded caps. Worker/greedy meshing — только если задача это явно требует после профилирования.

## Платформа

Desktop: mouse + keyboard, pointer lock, без context menu на canvas.

Mobile: landscape gameplay, portrait rotate overlay, safe areas, без overlapping controls, без browser scroll во время игры.

Яндекс Игры: pause/audio lifecycle, IndexedDB save, `YandexGamesService` abstraction, `index.html` в корне production, пути без кириллицы и пробелов, unpacked archive **< 100 MB** (внутренний budget значительно ниже 20 MiB). Не ломай SDK path `/sdk.js` и local no-op fallback.

## Документация между агентами

После большой задачи обнови:

- `docs/PROJECT_STATE.md`
- `docs/ROADMAP.md`
- `docs/ARCHITECTURE.md`
- связанные reference-файлы, если изменилась архитектура

И создай `docs/reports/YYYY-MM-DD_<task-name>.md` (Goal, Result, Implemented, Changed files, Architecture decisions, Tests, Visual QA, Performance, Known issues, Deferred, Next work, Git).

Другой агент должен понять состояние после `git pull` без прошлого чата.

## Git

Перед изменениями: `git status`, текущая ветка, последние commits.

Запрещено: `git reset --hard`, удаление чужих незакоммиченных файлов, rebase поверх чужой истории, **force push**.

Не коммить, пока пользователь явно не попросил. Не меняй `git config`.
