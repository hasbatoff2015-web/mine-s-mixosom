# 2026-09-08 — Placed TNT fall distance; minecart TNT without 20/30 flight

## Goal

Исправить ошибочную постановку `cursor/tnt-minecart-fall-distance-3f93`:
лимит падения 20/30 относится к **поставленному** TNT, не к TNT в вагонетке.
Платформу TNT-в-вагонетке (типы, snapshot, fire-arrow only, chain, off-rail
push) не откатывать.

## Result

Done. `primeTnt` задаёт `launchOriginY` + `maxFallBlocks`. `launchMinecartTnt`
больше их не ставит. Noclip `MINECART_TNT_PLATFORM_CLEARANCE` удалён.

## Diagnosis

`git diff` ветки fall-distance vs online: 20/30, `launchOriginY`, platform
clearance и `shouldDetonateMinecartLaunch` были повешены на
`launchMinecartTnt`. Поставленный TNT шёл через `primeTnt` без этих полей.

Правильное ТЗ: fall cap только у placed TNT. Minecart — hop `vy=4` + fuse 4s
как до fall-distance fix (без принудительного полёта вниз).

## Implemented

- `tntMaxFall` / `tntFallDistance`: ordinary 20, powerful/destructive 30.
- `primeTnt`: `{ originY: y, maxFallBlocks: tntMaxFall(resolved) }`.
- `updatePrimedTnt`: всегда `moveVoxelBody`; `shouldDetonatePlacedFall` no-op
  без launch-полей (minecart).
- `launchMinecartTnt`: hop + fuse + `blockId` only.

## Changed files

- `src/world/tnt.ts`, `src/redstone/RedstoneSystem.ts`, `src/redstone/types.ts`
- `tests/tnt-placed-fall.test.ts` (new), `tests/tnt-minecart.test.ts`,
  `tests/server/tnt-minecart.test.ts`, `tests/redstone.test.ts`,
  `tests/lighting-physics-interaction.test.ts`
- `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`,
  `docs/TESTING.md`

## Architecture decisions

Один primed-TNT путь. Fall fields — маркер «это поставленный блок», не
отдельная система. Minecart не использует этот маркер, поэтому hop-return на
рельс не взрывает по fall-логике и не запускает 20/30 полёт.

## Tests

- `npx vitest run tests/tnt-placed-fall.test.ts tests/tnt-minecart.test.ts tests/server/tnt-minecart.test.ts tests/redstone.test.ts tests/lighting-physics-interaction.test.ts tests/tnt-profiles.test.ts tests/use-interaction.test.ts tests/content-pass.test.ts --maxWorkers=2` — 61 passed.
- `npm run test:sim` — 42/42.
- four typechecks + boundaries + `npx vite build` — PASS.

## Visual QA

Симуляция, не браузер: placed void 20/30, floor collision, minecart не
улетает вниз после fire-arrow.

## Performance

Без новых allocations в hot path; убран noclip-branch.

## Known issues

Нет.

## Deferred

Owner live QA: flint placed TNT над пропастью vs fire-arrow TNT cart.

## Next work

Не добавлять homes/TPA/economy/kits.

## Git

Ветка `cursor/tnt-placed-fall-distance-3f93` от
`cursor/tnt-minecart-fall-distance-3f93`.
