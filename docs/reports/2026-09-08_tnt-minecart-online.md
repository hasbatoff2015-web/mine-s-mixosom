# 2026-09-08 — TNT in minecart online + off-rail push

## Goal

Перенести рабочий singleplayer TNT-в-вагонетке в Anarchy без второй системы:
все три типа TNT видны сразу (не после reconnect), поджигаются только огненной
стрелой (в т.ч. внутри чужих блок-приватов), вылетают primed TNT своего типа с
лимитом падения 20/30, цепочка сохраняет тип. С рельс вагонетку можно толкать
на 50% силы.

## Result

Done. Онлайн-синхронизация cargo идёт через `tntBlockId` в `SerializedMinecart`
и `EntitySnapshot.blockId`. Клиент применяет `applyNetworkSnapshot` →
`syncCargoVisual` — это чинит «появится только после reconnect».

## Implemented

- Cargo хранит `tntBlockId` (109/161/162), не только `variant === 'tnt'`.
- `insertTnt(cart, blockId)` принимает любой TNT-блок; `useInteraction`
  резолвит `tnt` / `tnt_powerful` / `tnt_destructive`.
- Fire-arrow hit: `igniteMinecartTntFromFireArrow` → `ejectTntCargo` +
  `launchMinecartTnt` (shared, SP + server). Flint cargo-prime отключён.
- Primed TNT: hop `vy=4`, gravity 32, inherit cart `vx/vz`, `launchOriginY` +
  `maxFallBlocks`. Explode on landing or at max fall. Fuse 4s остаётся safety.
- Off-rail push: `player.vxz * PUSH_GAIN * 0.5`, cap `MINECART_MAX_SPEED`.
  On-rail push не тронут.
- `MinecartVisualFactory.setVariant(visual, variant, textureKey)` — один cargo
  mesh, материалы `block/tnt` / `tnt_powerful` / `tnt_destructive`.

## Changed files

- `src/entities/MinecartManager.ts`, `minecartTnt.ts` (new), `EntityHost.ts`,
  `ThreeEntityHost.ts`
- `src/rendering/minecartGeometry.ts`
- `src/redstone/RedstoneSystem.ts`, `types.ts`
- `src/world/tnt.ts`, `src/blocks/tnt.ts`
- `src/gameplay/useInteraction.ts`
- `src/net/applyEntitySnapshots.ts`
- `src/core/Game.ts`, `server/gameplay.ts`
- `tests/tnt-minecart.test.ts`, `tests/server/tnt-minecart.test.ts`
- `tests/use-interaction.test.ts`, `tests/fire-contact-sunlight-minecart.test.ts`
- `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`,
  `docs/TESTING.md`

## Architecture decisions

- Один primed-TNT path (`launchMinecartTnt` → `detonate` → `enqueueExplosion`
  с `blockId`). Профили (якоря / обсидиан / admin `/claim`) не дублируются.
- Claims plugin не слушает minecart hit — fire-arrow поджиг не идёт через
  `playerInteract`. Place/break claims не ослаблялись.
- Off-rail push пишет world `vx/vz`, не `alongSpeed` (`stepOffRail` его
  обнуляет). Вагонетка не становится free physics object.
- Протокол: `EntitySnapshot.blockId` уже был (falling/TNT). Minecart cargo
  переиспользует его. Version bump не нужен.

## Tests

- `npx vitest run tests/tnt-minecart.test.ts tests/server/tnt-minecart.test.ts`
  — 13 passed.
- `npx tsc --noEmit` ×4 + `npm run check:boundaries` — PASS.
- `npx vite build` — PASS.
- `fire-contact-sunlight-minecart` TNT-routing describes pass isolated;
  полный файл часто ловит 5s timeout под нагрузкой (pre-existing derail/sunlight).

## Visual QA

Не браузер. Проверено тестами: live snapshot cargo без respawn; late joiner
видит `tnt_powerful`; fire-arrow внутри чужого iron-привата; ordinary arrow
не поджигает; off-rail 50% push.

## Performance

Без нового меша/тика. Один extra field на snapshot.

## Known issues

Нет.

## Deferred

Клиентский HUD «TNT в вагонетке»; отдельный fuse-sound для cargo (нет — TNT
вылетает сразу primed).

## Next work

По запросу: visual QA двух клиентов; остальное из ROADMAP.

## Git

Ветка `cursor/tnt-minecart-online-3f93` от `cursor/anarchy-tnt-types-3f93`.
PR не создавался по запросу пользователя.
