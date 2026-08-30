# 2026-08-30 — Phase 4 shared entity host

## Goal

Separate entity **simulation** from entity **rendering** so the Anarchy server can tick drops, falling blocks, mobs, minecarts, and arrows without constructing Three.js Mesh / Geometry / Material. Client keeps the same gameplay entities through one rendering host.

Do not start Phase 5+ (persistence envelopes, RNG, plugins, renderer folder moves, protocol).

## Result

```text
                ENTITY SIMULATION
                       │
             ┌─────────┴─────────┐
             │                   │
          SERVER               CLIENT
             │                   │
        no rendering        EntityHost
                            Three.js
```

- **Sim:** existing managers still own physics, AI, damage, serialize/restore, `THREE.Vector3` pose.
- **Host:** `src/entities/EntityHost.ts` (`HeadlessEntityHost`) and `src/entities/ThreeEntityHost.ts`.
- **Compat:** `resolveEntityHost(scene | host)` so `new MobManager(new THREE.Scene(), world)` tests still attach real meshes.

## Before

`ServerGameplay` constructed `new THREE.Group()` plus `ItemVisualFactory` and passed that dummy scene into every entity manager and `RedstoneSystem({ root })`. `MobManager` always `new VoxelVisualFactory()` / `new ArrowVisualFactory()` and `createMobModel` in `spawn`.

## After

| Runtime | Host | Meshes |
|---|---|---|
| Anarchy `ServerGameplay` | `HeadlessEntityHost` | none (`visual === undefined`) |
| SP `Game` | one `ThreeEntityHost(scene, { itemVisuals, arrowVisuals, owns*: false })` | same factories as before |
| Unit tests wrapping `THREE.Scene()` | auto `ThreeEntityHost` | same as before |

`RedstoneSystem` on the server is constructed without `root`, so primed TNT does not allocate BoxGeometry/Mesh. SP still passes `root: this.scene`.

## Implemented

- `EntityHost` create/update/attach/pose/light/syncMob/disposeVisual.
- Managers: `DroppedItemManager`, `FallingBlockManager`, `MinecartManager`, `MobManager`, `PlayerArrowManager`.
- `Game` session field `entityHost`; disposed after managers on teardown.
- `ServerGameplay.host`; no `ItemVisualFactory`, no entity `THREE.Group`.
- Tests: `tests/entity-host.test.ts` (import boundary + headless spawn/tick + scene wrap identity). Existing entity packs keep wrapping Scene.

## Changed files

- New: `src/entities/EntityHost.ts`, `ThreeEntityHost.ts`, `resolveEntityHost.ts`, `tests/entity-host.test.ts`, this report.
- Managers + `src/core/Game.ts` + `server/gameplay.ts` + `src/entities/index.ts`.
- Small `!` / optional visual typing in entity tests.
- Docs: `PROJECT_STATE.md`, `ROADMAP.md`, `ARCHITECTURE.md`.

## Architecture decisions

- One host interface, not a second MobManager or a gameplay loop.
- Module load of `ThreeEntityHost` from manager `resolveEntityHost` is accepted; **constructing** Mesh is not. Server never constructs `ThreeEntityHost`.
- `THREE.Vector3` stays in simulation (user asked no Mesh/Geometry/Material, not no Vector3).
- `ThreeEntityHost` must not import `MobManager` (hurt tint inlined).
- Lazy item/arrow/voxel/minecart factories on the Three host.
- `ownsHost` only when wrapping a Scene; shared Game/server host is not disposed by managers.

## Intentionally unchanged

- GameplayKernel step order and Phase 2 `useInteraction`.
- Phase 3 `world/blockGeometry.ts`.
- Interpolation buffers, fluids, block-state protocol, respawn/session WASD (#19/#20).
- SP primed-TNT still uses `RedstoneSystem` `root` (not routed through `createPrimedTnt` yet).
- Minecart size constants still imported from `minecartGeometry.ts` (numbers only; no Mesh construct on Headless).

## Tests

- `tsc --noEmit` clean.
- `tests/entity-host.test.ts` **5/5** (import boundary, headless spawn/tick/serialize, Scene wrap still creates Object3D).
- Targeted packs (entities, mob-hurt-flash, mob-polish, hostile-spawn, drops, arrows, creeper, kernel, use-interaction, block-geometry, interpolation, visual-events, input recovery, Anarchy server/gameplay, redstone, classic combat, gameplay-ui, fire-arrow, block-selection, respawn/session, content-pass, lighting-physics, interaction-support, network block-state): **all green** (359 tests across those files; entity-host counted once).
- Production `npm run build` + `check:size` + `check:archive` PASS **3.64 MiB / 221 files**.

Full `npm run check` was not re-run; baseline failures (authored ENOENT `bucket_empty.png`, minecart 5s timeouts, vitest RPC) are pre-existing.

## Visual QA

Not performed here (cloud agent). Owner local QA: SP entities look unchanged; Anarchy server simulates without GPU meshes; WASD contracts from #19/#20 still hold.

## Performance

No new per-tick systems. Server avoids factory/mesh construction. Client still one set of shared factories. Bundle size unchanged at 3.64 MiB / 221 files.

## Known issues

Full `npm run check` baseline: authored ENOENT `bucket_empty.png`, minecart 5s timeouts, vitest RPC — do not “fix” in this PR.

## Deferred

- Route SP primed TNT through `host.createPrimedTnt`.
- Dynamic-import `ThreeEntityHost` so the server module graph never loads rendering factories.
- Phase 5+ persistence / RNG / plugins / renderer moves.

## Next work

Owner local QA of this PR on top of #23. **Do not merge main. Do not start Phase 5+.**

## Git

Branch `cursor/shared-entity-host-bbb1` from Phase 3 `ff5bef0`. Stacked on draft PR **#23**, not `origin/main`.
