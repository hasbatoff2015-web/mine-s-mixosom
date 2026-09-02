# 2026-09-01 — Phase 7 tooling split

## Goal

Formalize compile/import boundaries:

```text
SHARED SIMULATION  — Node-safe
CLIENT             — DOM / Three / Vite / IndexedDB
SERVER             — Node / fs / WebSocket
```

Shared simulation must not depend on DOM, `window`, `document`, Canvas, WebGL, Three.js, IndexedDB, localStorage, WebSocket, Node filesystem, or server runtime. This is tooling/boundary work, not a gameplay rewrite. Do not start Phase 8.

## Result

Shared simulation typechecks with `lib: ES2022` (no DOM) and imports no `three`. Server typechecks without DOM/Three/rendering. Client production build still uses the umbrella `tsc --noEmit` + Vite. Import guards and Node smokes exist. GameplayKernel order, combat, fluids, lighting budget, persistence adapters, and plugin wiring are unchanged.

## Current dependency graph

### Before

- One `tsconfig.json` (`src` + `tests` + `shared` + `server`) with DOM lib.
- `server/gameplay.ts` used `THREE.Vector3`.
- `src/gameplay/useInteraction.ts` had a type dependency on Three.
- `src/entities/index.ts` re-exported `ThreeEntityHost` / `mobModels`, so `import { … } from '../src/entities'` on the server loaded Three + rendering.
- Managers accepted `THREE.Object3D | EntityHost`.
- `RedstoneSystem` took `root?: THREE.Object3D`.

### After

```text
Allowed
  shared  →  shared (Vec3, kernel, world, items, EntityHost headless, WorldStore, protocol types)
  client  →  shared + client-only (rendering, UI, InputManager, IdbWorldStore, Three)
  server  →  shared + server-only (FsWorldStore, ws, fs, PluginManager foundation)

Forbidden
  shared  →  client (rendering, Game, InputManager, IdbWorldStore, Three)
  shared  →  server (fs, ws, AnarchyServer)
  server  →  client (rendering, GameUI, Game, Three, InputManager, Lifecycle DOM)
```

## Shared (Node-safe)

Became / stayed Node-safe:

- `src/math/vec3.ts` (`Vec3` / `Vec3Like`)
- `src/input/MoveInput.ts`
- `src/core/lifecycleTypes.ts`
- `src/gameplay/**` (kernel, useInteraction, random)
- `src/world/**` including `blockGeometry.ts`
- entity managers via `HeadlessEntityHost`
- `src/save/WorldStore.ts` / `snapshot.ts` / `types.ts`
- `src/ui/recipeBook.ts` + `src/ui/containerInteractions.ts` (inventory logic, not GameUI)

`performance.now()`, `structuredClone`, `fetch`, Blob/Web Streams used by world import are typed via `types/sim-globals.d.ts` + Node types — not a DOM lib.

## Client (browser-only)

- `src/core/Game.ts`, `Lifecycle.ts` (document/window)
- `src/input/InputManager.ts`, `pointerLock.ts`
- `src/rendering/**`
- `src/entities/ThreeEntityHost.ts`, `mobModels.ts`, `voxelVisuals.ts`, `LegacyModel.ts`
- `src/save/IdbWorldStore.ts`, `SaveService.ts`
- `src/ui/GameUI` and other DOM UI
- `src/net/RemotePlayerView.ts`, `applyEntitySnapshots.ts` (Three visuals)

## Server (Node-only)

- `server/**` (`AnarchyServer`, `WorldInstance`, `FsWorldStore`, `ws`, plugins foundation)
- `HeadlessEntityHost`
- Must not import rendering / UI / Three / Game / InputManager

## Three.js removal (shared / server)

| Site | Before | After |
| --- | --- | --- |
| `server/gameplay.ts` | `THREE.Vector3` | `Vec3` |
| `useInteraction.ts` | Three types | `Vec3` / `Vec3Like` |
| `World.ts` raycast / VoxelHit | Three vectors | `Vec3` / `Vec3Like` |
| Player / voxel physics / arrows / drops / falling / minecarts / mobs / redstone | `THREE.Vector3` | `Vec3` |
| `RedstoneSystem` | `root?: THREE.Object3D` | `host?: EntityHost` |
| `src/entities/index.ts` | exported ThreeEntityHost | simulation-only barrel |
| `MinecartManager` | imported `minecartGeometry` | local size constants (keep in sync) |
| `MobManager` | unused Three.Ray/Box3 | existing `rayAabbDistance` |

`import type { Vector3 } from 'three'` is also forbidden in shared sim.

## DOM removal

| Site | After |
| --- | --- |
| `PlayerController` | `MoveInput` from `src/input/MoveInput.ts` |
| `gameplayModal.ts` | `MoveInput` + `LifecycleState` types only |
| `onlineSession.ts` (seq helpers used by server) | `lifecycleTypes.ts`, not `Lifecycle.ts` |
| IndexedDB | remains in `IdbWorldStore` (client) |
| `fs` | remains in `FsWorldStore` (server) |

Shared gameplay does not use `KeyboardEvent` / `MouseEvent`. `window` / `document` stay in `Lifecycle` / `InputManager` / `Game`.

## TypeScript configs

| File | Include | Lib |
| --- | --- | --- |
| `tsconfig.json` | src, tests, shared, server | ES2022 + DOM (compatibility) |
| `tsconfig.sim.json` | listed sim modules + `types/sim-globals.d.ts` | ES2022, `types: node` |
| `tsconfig.client.json` | `src/**`, protocol | DOM + `vite/client` |
| `tsconfig.server.json` | `server/**`, protocol, sim-globals | ES2022, `types: node` |

`npm run typecheck` remains `tsc --noEmit` on the umbrella config.

## Test environments

| Category | Where |
| --- | --- |
| SIM | Node. `npm run test:sim` + `tests/tooling-*.test.ts`. No jsdom. |
| SERVER | Node. `npm run test:server`. |
| CLIENT | Node Vitest (unchanged default) with Three imports + `tests/setupClientEntityHost.ts`. |

Files were not mass-moved.

## Import guards

`scripts/check-import-boundaries.mjs` (regex import scan, not an AST compiler).

Shared: no `three`, rendering, IdbWorldStore/SaveService, ThreeEntityHost/mobModels/voxelVisuals/LegacyModel, `ws`, `node:fs`, IndexedDB/localStorage identifiers.

Server: no `three`, rendering, GameUI, Game, InputManager, Lifecycle, IdbWorldStore, SaveService.

`npm run check` runs `check:boundaries` after `typecheck`.

## Build

- `tsc --noEmit` PASS
- `typecheck:sim` / `typecheck:client` / `typecheck:server` PASS
- `check:boundaries` PASS
- `smoke:sim` PASS (Node `--import` loader forbids `three`)
- `smoke:server` PASS
- `npm run build` PASS — **3.65 MiB / 221 files**
- `npm run dev:server` (PORT=2568) printed `Anarchy server ready` (no Three/DOM)

## Architecture decisions

- Do not rename `src/` → `sim/`. Boundaries are configs + imports.
- Reuse `{x,y,z}` via `Vec3` instead of a new physics engine.
- `resolveEntityHost` stays Three-free; tests register a wrapper in Vitest setup only.
- Barrel `src/entities/index.ts` must not export renderer hosts (that was the server Three leak).
- Tiny `types/sim-globals.d.ts` instead of adding DOM to sim tsconfig.
- `recipeBook` / `containerInteractions` stay under `src/ui/` (intentional leftover path).

## Tests

Targeted: `test:sim` **38/38**. Server + entity-host + initial-lighting + death-animation **81/81**. entity-host/hurt-flash/redstone **21/21**. `embedded-arrow-support` **10/10** after `Vec3.equals`.

Full `npx vitest run`:

```text
Before (Phase 6 / PR #32): 1169 passed / 8 failed + 1 RPC
After:                     1180 passed / 9 failed + 1 RPC (first run)
                           then 2 extra failures were Vec3.equals — fixed
Unchanged class:          2 authored ENOENT + 5 minecart 5s timeouts + 1 RPC
```

The first full run had 2 extra failures: `arrow.position.equals is not a function`. THREE.Vector3 had `equals`; Vec3 did not. Added exact `equals` (not a hidden timeout). Tooling tests explain the higher pass count vs Phase 6.

## Visual QA

Owner local QA after this PR (no intended gameplay change):

- Singleplayer: launch, load, move, mobs, fluids, lighting, inventory, crafting
- Anarchy: start server, connect, move, blocks, mobs, fluids, lighting, entities, chest, persist
- Two clients: connect, movement, mobs, entities, blocks, chest, lighting

Cloud agent did not run that browser matrix (tooling-only). `npm run dev` / `npm run dev:server` remain the owner commands.

## Performance

No per-tick wrappers. Changes are types, imports, tsconfig, tests, and host options. `WORLD_LIGHT_BUDGET_MS = 2` unchanged.

## Known issues

Unchanged baseline: authored assets missing in this environment, minecart suite timeouts, Vitest RPC. Not caused by this phase.

## Deferred

- Phase 8 plugins (do not connect PluginManager to kernel events)
- Moving `recipeBook.ts` out of `src/ui/`
- Splitting Vitest into three config files (not needed)
- Mass folder rename

## Other developer compatibility

PR **#22** (UI), **#28** (block-breaking overlay), **#31** (player skins / third person) were not merged, rebased, or edited. They remain client-side and can land on top of this branch: client tsconfig still includes all `src/**`, umbrella `tsc` still typechecks Game/UI/rendering.

PR **#30** / **#32** lighting fixes are the base of this branch (`15cc8d7`). Not closed.

## Next work

**Phase 8 — Plugins only.** Wire existing `PluginManager` / event bus to kernel-adjacent server events. Do not implement in this PR.

## Commands

```bash
npm run typecheck:sim
npm run typecheck:client
npm run typecheck:server
npm run test:sim
npm run test:server
npx vitest run tests/entity-host.test.ts tests/entity-initial-lighting.test.ts tests/mob-hurt-flash.test.ts   # client visual
npx tsc --noEmit
npm run check:boundaries
npm run smoke:sim
npm run smoke:server
npm run check
npm run build
npm run dev
npm run dev:server
```

## Git

- Branch: `cursor/shared-tooling-split-37a2` (requested name `cursor/shared-tooling-split-bbb1`; cloud suffix `-37a2`)
- Base SHA: `15cc8d707c8b81398e97286dff78d3f9091463ff` (`cursor/entity-initial-light-finalize-37a2`)
- Draft PR: **#33**
- Do not merge main. Do not start Phase 8.
