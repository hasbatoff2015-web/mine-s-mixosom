# 2026-08-29 — Phase 2 shared interaction

## Goal

Unify block/item use and placement so Singleplayer and Online Anarchy share one simulation-level path. Refactor of existing behavior, not a new gameplay pass. Do not start Phase 3+.

## Result

`Game.useTargetOrItem` (SP) and `ServerGameplay.useHeld` / `placeBlock` call `src/gameplay/useInteraction.ts`. Hosts keep local effects (UI/SFX) vs network/event effects. Online clients still send `interact` only.

Browser QA was **not** performed here. Owner local QA after PR #20 (death→respawn WASD, Anarchy→menu→Anarchy, SP, interpolation/fluids) is the freeze baseline; this PR must not regress that.

## Before

Two RMB implementations with the same intended order but different rules:

- SP `Game.useTargetOrItem`: cartCloser gating, lantern/chain support, slab merge, `canUseAsPlacementAnchor` / `canAttachToFace`, rail-only minecarts, extra nearby-cart mount, toasts/audio/swing/inventory UI.
- Server `useHeld` + `placeAt` + `applyPlacementState`: plugin `playerInteract` / `blockPlace`, `player.window`, no support/anchor/slab-merge checks, minecart spawn without a rail check, block interact even when a cart is closer.

Live online RMB was already `interact` only (PR #17). `place_block` remains look-validated for tests/creative coords.

## Shared module

`src/gameplay/useInteraction.ts`:

- `resolveUseIntent` — pure order helper (tests).
- `performUseHeld` — full use simulation.
- `placeFromHit` / `placeBlockAt` — placement + orientation.
- `toggleDoorState` / `doorHalves` / `clearDoorBlocks` / `refreshNeighborRails`.

Canonical order (SP, now both hosts):

```text
empty bucket
→ plugin interact hook if looking at a block (server)
→ use-target block if closer than cart
→ food / bow
→ cartCloser: flint / TNT-cart / mount
→ flint / TNT-cart / minecart-on-rail
→ nearby rideable cart
→ filled bucket
→ placeFromHit
```

```text
              performUseHeld / placeBlockAt
                         │
              ┌──────────┴──────────┐
              │                     │
         Game (SP)            ServerGameplay
              │                     │
     toasts / SFX / UI      events / window / dirty
```

## Hosts

- **Game:** `useTargetOrItem` returns immediately online (`interact`). Offline builds `UseSimulationContext` with session target (not a second raycast). Effects: toast, swing, block/world SFX, `openBlockInventory`, bed save, flint ignite sound.
- **ServerGameplay:** `useHeld` → `performUseHeld` (raycast from look). `placeBlock` keeps reach/look validation then `placeBlockAt`. Effects: `playerInteract` / `blockPlace` cancel, container `window`, `inventoryDirty`, `enterVehicle` plugin path.

## Intentionally unchanged

- GameplayKernel step order.
- Interpolation, live fluids, block-state packets.
- Respawn WASD (#19) and session-transition `lastInputSeq` (#20).
- Protocol (still version 1). `place_block` not removed.
- Combat, mining, plugins architecture, EntityHost, geometry extraction, persistence, RNG, renderer folders.

## Behavior notes (unify, not new features)

Server placement now uses the SP rule set: sturdy anchors, lantern/chain support, slab merge, thin lantern/chain collision, rail-only minecart item, cartCloser before door/chest/lever. Anarchy tests that already looked at stone / cleared door cells still pass.

## Tests

- New `tests/use-interaction.test.ts` (10): intent kinds, `placeFromHit` torch + unsupported lantern, food ticks, online `interact` only.
- Retained: `placement-support` (Game.useTargetOrItem), `glowstone-lantern-chain`, `gameplay-kernel`, `anarchy-gameplay` (27), `anarchy-server`, bucket, network block-state/input, interaction-support-polish.

Focused packs: **115/115** (use+placement+kernel+anarchy) and **120/120** (use+bucket+network+polish+lighting-physics).

`tsc --noEmit` clean. Production build/size/archive PASS **3.64 MiB / 221 files**.

Full `npm run check` not required to be green: authored ENOENT `bucket_empty.png` + minecart 5s timeouts remain the pre-existing class from PR #17/#20.

## Performance

One extra function call per RMB. No extra world scans. Server `useContext` clones eye/look once per use (avoids tmpEye aliasing).

## Visual QA

Not run in this environment (no gameplay browser pass). Owner should confirm SP torch/door/lantern/slab/bucket and Anarchy interact/place, plus the PR #20 input regressions.

## Known issues

None introduced in targeted tests. Full suite baseline failures unchanged (authored asset ENOENT, minecart timeouts, occasional vitest RPC).

## Deferred

- Phase 3 geometry extraction
- Phase 4 EntityHost
- Phase 5 persistence envelopes
- RNG / plugin architecture refactors
- Moving renderer folders
- Removing unused `place_block` if live clients never send it (protocol change — out of scope)

## Next work

Owner local QA of this PR on top of #20. **Do not start Phase 3.** Do not merge main.

## Git

- Branch: `cursor/shared-interaction-bbb1` from PR #20 `05e77a8`, **not** `origin/main`.
- Merge-base with `origin/main`: `a056e6f` (lighting PR #13).
- Implementation HEAD: `3622e20`
- Draft PR stacked on `cursor/online-session-transition-input-fix-bbb1`.
- Status: pushed for owner local QA. Do not merge main.
