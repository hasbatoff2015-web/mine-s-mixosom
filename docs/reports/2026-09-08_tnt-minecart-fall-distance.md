# 2026-09-08 — TNT minecart fall distance 20/30

**Superseded 2026-09-08.** The 20/30 fall cap belongs to **placed** TNT, not minecart cargo. See `2026-09-08_tnt-placed-fall-distance.md`. This report is historical.

## Goal

Почему в реальной игре дальность падения TNT из вагонетки не стала 20/30,
хотя поле `maxFallBlocks` уже было. Исправить так, чтобы считалось
`startY - currentY` от точки выброса.

## Result

Done. Причина — не «поле не тикалось», а **ранний взрыв на блоке под рельсом**.

## Diagnosis

Путь: fire arrow → `igniteMinecartTntFromFireArrow` → `ejectTntCargo` →
`launchMinecartTnt` (hop `vy=4`, gravity 32, `launchOriginY`, `maxFallBlocks`).
Каждый tick: `RedstoneSystem.updatePrimedTnt` → `moveVoxelBody` →
`shouldDetonateMinecartLaunch`.

Старое условие: `landed && falling` **или** `originY - y >= maxFall`.

Рельс всегда лежит на солидном блоке. TNT AABB ~1 высокий, spawn на Y рельса.
Hop поднимает на ~0.25 и на 4-м тике (`falling=true`, drop=0) `supportedFromBelow`
видит камень → взрыв на платформе. 20/30 не достигались.

Void-тесты без пола это не ловили: там не было support, лимит работал.

`blockId` не терялся. Fuse 4s не был причиной (20 блоков ≈ 1.25s).
Мировая Y=20 не использовалась.

## Implemented

- Пока `startY - y < 2` (`MINECART_TNT_PLATFORM_CLEARANCE`) TNT не коллизится
  с платформой вагонетки и не взрывается от hop-return.
- Дальше: пол раньше лимита → взрыв на столкновении; иначе воздух при
  `startY - y >= 20` (ordinary) / `>= 30` (powerful, destructive).
- `vy=4`, gravity 32, радиусы 4/6/4 без изменений.

Debug table from simulation (startY → explosionY, deltaY), default 4s fuse:

| type | startY | ~deltaY |
| --- | --- | --- |
| ordinary 109 | 80 / 100 / 55 | ~20 |
| powerful 161 | 90 | ~30 |
| destructive 162 | 90 | ~30 |
| rail+stone over void | 80 | ~20 (not 0) |
| floor at 60, start 68 | 68 | ~8 |

## Changed files

- `src/redstone/RedstoneSystem.ts`, `src/world/tnt.ts`
- `tests/tnt-minecart.test.ts`, `tests/server/tnt-minecart.test.ts`
- `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`,
  `docs/TESTING.md`

## Tests

- `npx vitest run tests/tnt-minecart.test.ts tests/server/tnt-minecart.test.ts`
  — 18 passed (13 + 5).
- `npm run test:sim` — 42/42.
- four typechecks + boundaries + `npx vite build` — PASS.

## Visual QA

Не браузер. Контракт закрыт симуляцией полёта по Y, включая server tick
rail-over-void.

## Git

Ветка `cursor/tnt-minecart-fall-distance-3f93` от `cursor/tnt-minecart-online-3f93`.
PR не создавался по запросу пользователя.
