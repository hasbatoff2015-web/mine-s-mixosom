# 2026-09-18 Merge current main into entity-special-visual-fixes

## Goal

Unblock modern saves on `codex/entity-special-visual-fixes` (`Unknown block id: 165`) by synchronizing the feature onto current `origin/main`, without local ID hacks, rebase, force-push, or changing `main`. Keep a semantic union: current main architecture + entity/special visual fixes.

## Result

`--no-ff --no-commit` merge of `origin/main` into the feature resolved as a union. Modern saves with voxel 165 restore as **OakSign**. Generic unknown compatibility remains for `65534`. Feature history was not rewritten. `main` was not changed. The branch is pushed for owner review and is **not** merged into `main`.

## 1. Feature HEAD before merge

`64aa7268f90ba2727f7c0928fba0d60b77ac795d` — `fix: align arrow visuals with projectile trajectory`

Merge-base with main: `e4d43ff3` (snowy biome PR #83).

## 2. Main HEAD

`origin/main` = `6d2c79f63e5587030b00bfd726706efb8fbb3b44` before and after this work. `main` was not checked out for commits and was not pushed.

## 3. Root cause of `Unknown block id: 165`

Confirmed in local code **before** the merge (diagnosis matched; no correction needed):

- Feature `src/blocks/types.ts` ended at `TntDestructive = 163`. It did not define `SugarCane = 164` or `OakSign = 165`.
- Current main already registers `SugarCane = 164` and `OakSign = 165`. Legal IndexedDB/FS saves can contain voxel 165.
- Feature `getBlockDefinition(id)` threw `RangeError(\`Unknown block id: ${id}\`)` when the definition was missing.
- Feature `World.restore()` did `delta.set(Number(index), block as BlockId)` with no `normalizeStorableBlockId`, no unknown-ID placeholders, and no signs.

Rejected non-fixes (not used): `if (id === 165) return stone`, placeholder-only OakSign, deleting 165 from saves, remapping to air, rewriting OakSign’s number.

Correct fix: merge current main so 165 is the real OakSign block and unknown-block compatibility stays generic.

## 4. Merge conflicts

Command: `git merge --no-commit --no-ff origin/main` on `codex/entity-special-visual-fixes`.

No `git checkout --ours` / `--theirs` of whole files.

Conflicted and resolved by semantic union:

| File | Union |
| --- | --- |
| `docs/ARCHITECTURE.md`, `docs/PROJECT_STATE.md`, `docs/ROADMAP.md` | Both histories kept; merge preamble prepended. |
| `server/gameplay.ts` | Current main Anarchy/menu/utility authority + exact `targetPlayerId` from the projectile (no nearest-to-impact fallback). |
| `shared/protocol.ts` | Current main snapshots: `impactVx/Y/Z`, `state: embedded`, menu/book/sign/totem. Feature `visualVx/Y/Z` **not** restored. |
| `src/combat/PlayerArrowManager.ts` | Main `visualDirection` / `impactVelocity` names. Feature flying invariant: `visualDirection.copy(movement)` **before** gravity. Embed copies `embedded.impactVelocity`. Network spawn without a second spread. |
| `src/net/applyEntitySnapshots.ts` | Main ingest: `impactVx/Y/Z` when `state === 'embedded'`. |
| `src/rendering/player/PlayerVisual.ts` | Main bed rest, offhand Totem, special held models, Utility item ids **plus** feature `thirdPersonItemPose` / `THIRD_PERSON_ITEM_POSES`. First-person profiles unchanged. |
| `tests/network-entity-visual-events.test.ts` | Main firework/impact protocol + visualDirection orientation. |
| `tests/player-visual-animation.test.ts` | Feature third-person poses + main bedRest imports. |

Auto-merged and audited (not blindly taken): `src/blocks/types.ts` / `registry.ts` (OakSign 165 + unknown layer), `src/world/World.ts` restore, `src/rendering/specialBlockGeometry.ts` (torch/lantern/rails + bed/sign), `ChunkMesher`, `itemRenderProfiles.ts`, `PlayerVisualAnimator.ts`, `ThreeEntityHost` skeleton bow, `MobManager` targeting, `railPath` / `resolveRailShape`.

Chicken: **did not** port the older feature `faceUvRects` remap. Current main already uses yellow-island UV `[29, 0]` with two grounded opposite-gait legs.

## 5. OakSign = 165

After merge:

- `BlockId.OakSign === 165`
- `BlockId.SugarCane === 164`
- `isKnownBlockId(165) === true`
- `getBlockDefinition(165).key === 'oak_sign'`
- restore of `"165"` or numeric 165 yields `BlockId.OakSign`
- serialize stays `165` (not stone, air, 166, or `unknown_165`)
- sign text restores via `signs` / `sanitizeSignLines` / `signVersion`

## 6. Generic unknown 65534

- `UNKNOWN_BLOCK_MAX_ID = 0xffff`
- `normalizeStorableBlockId()`, `tryGetBlockDefinition()`, runtime placeholders kept
- `getBlockDefinition`: known → real block; unknown valid Uint16 → `unknown_${id}` placeholder; invalid → `RangeError`
- `isKnownBlockId(65534) === false`
- restore succeeds; voxel stays `65534`; save writes `65534`
- 165 is **not** a placeholder

## 7. Entity visual fixes retained

| Scope | After merge |
| --- | --- |
| Torch / redstone torch | Authored side/top/bottom UV; floor + N/S/E/W wall; not one strip stretched over 6 faces. |
| Lantern | Body, cap, hanger, hanging chain with authored UV; not old coarse boxes. |
| Rails | `railRenderQuads(shape)` for all 10 `RailShape` (NS/EW, 4 slopes, 4 curves + `rail_corner`). Collision stays `railLocalBoxes`. Current main minecart / `resolveRailShape` simulation kept. |
| Chicken | Current main `[29, 0]` two-leg rig; both legs visible, grounded, opposite gait. |
| Skeleton bow | One `ItemVisualFactory` bow per visual lifetime, right-arm hand anchor, ranged bow/draw pose. Not recreated every frame. |
| Skeleton targeting | `nearestMobProjectilePlayerHit` swept AABB vs all targetable players; exact `targetPlayerId`; Survival/alive; Creative ignored; wall-before-player; nearest intersection; **no** nearest-player-to-impact fallback. Client owns intent, server owns result. |
| Third-person poses | Feature sword/tool/bow/generic/block table on current main PlayerVisual (bed rest, offhand Totem, Utility, door/farmland/bed/sign). First-person unchanged. |
| Bow aim | `Math.PI / 2 + viewPitch - bodyPitch`. Positive pitch aims up. Sneak body pitch applied once. |

## 8. Arrow visual fix vs current main protocol

Feature commit `64aa726` used `visualVx` / `inGround`. Main since then has `visualDirection` plus embedded `impactVx/Y/Z`.

Adapted semantics, not the old structure:

- **Flying:** `visualDirection` = this tick’s movement segment, copied **before** gravity, so the next-tick gravity drop does not pre-tilt the mesh.
- **Embedded:** velocity may be zero; `visualDirection` keeps impact direction; network snapshot uses `impactVx/Y/Z` and `state: 'embedded'`.
- **Remote:** `applyNetwork` creates the arrow without a second randomized spread.
- Single modern field: `visualDirection`. No parallel `visualVelocity` + `visualDirection`. `visualVx` not restored.

## 9. Focused tests

Save/block first (before visual QA): `block-registry`, `unknown-block-load`, `fs-world-store` — **29/29 PASS**.

Feature + modern arrow:

- `tests/entity-special-block-rendering.test.ts`
- `tests/skeleton-presentation.test.ts`
- `tests/mob-projectile-routing.test.ts`
- `tests/visual-models.test.ts`
- `tests/player-visual-animation.test.ts`
- `tests/server/anarchy-gameplay.test.ts`
- `tests/arrow-visual-orientation.test.ts`
- `tests/network-entity-visual-events.test.ts`

**12 files / 122 tests PASS.**

`tests/rail-path.test.ts` does not exist on current main; rail coverage is special-block rendering + tnt-minecart / block-geometry.

## 10. Typechecks

`npm run typecheck`, `typecheck:sim`, `typecheck:client`, `typecheck:server` — PASS.

`npm run check:boundaries` — PASS.

## 11. Build / size

`npm run build`, `check:size`, `check:archive` — PASS.

Production archive **4.75 MiB / 404 files** (under the Yandex unpacked budget).

## 12. Full suite

`npx vitest run --maxWorkers=2`: **251 passed / 5 failed / 256 files**.

Failed classes match current **origin/main** host baseline, not treated as merge regressions:

- extractor parse
- chat-layout CRLF vs LF `style.css` on this host
- fire-contact-sunlight-minecart timeout
- worldgen timeout
- tick-load-flight >80ms

Isolated: `tnt-minecart`, `import-schematic`, `block-geometry` PASS. `lighting-scheduler` radius-6 can time out under load on this host (same flake class as prior main merge reports).

## 13. Manual visual QA

Vite `http://localhost:4173` in the Cursor browser (lock was unavailable; navigate + CDP + screenshots).

**Lights:** floor torch; wall N/S/E/W; redstone torch; standing lantern; hanging lantern with chain.

**Rails:** straight NS/EW; all 4 slopes (true incline, not stepped collision boxes); all 4 curves with corner texture.

**Chicken:** two yellow feet from the front; two grounded opposite-gait legs from the side.

**Skeleton:** one bow, ranged pose, fires.

**Player third person:** sword, pickaxe, block (stone) + sneak, bow pitch −60 (down) / 0 / +60 (up).

**Arrows:** flying aligned to trajectory; wall embed tip-in-wall.

This Cursor browser IndexedDB had no local worlds (`Сохранённых миров пока нет`). Modern save with 165 is covered by the 29/29 restore suite, not a live IndexedDB file in this browser.

## 14. Two-client skeleton test

**Not executed.** Requires two simultaneous Anarchy clients and owner-controlled positioning. Automated coverage: `mob-projectile-routing` + `anarchy-gameplay` exact `targetPlayerId` (no nearest-to-impact fallback). Still owner-deferred for live health attribution.

## 15. Minecart / rail test

**Live continuous ride not executed.** Geometry of all 10 shapes verified in `/?qaSpecial=1`. Simulation covered by existing tnt-minecart / rail path resolution tests. Break/rebuild + save/load ride remains owner-deferred.

## 16. New feature HEAD

Merge commit on `codex/entity-special-visual-fixes` (see git after this file is committed). Pushed to `origin/codex/entity-special-visual-fixes`. **Not** merged to `main`. No rebase, no force-push.

## 17. Main unchanged

`origin/main` remains `6d2c79f63e5587030b00bfd726706efb8fbb3b44`. This work only advanced the feature branch.

## Changed files (high-signal)

Merge brings all current-main Utility/menu/unknown-block/arrow architecture onto the feature. High-signal union edits:

- `src/blocks/types.ts`, `src/blocks/registry.ts` — OakSign 165 + unknown layer
- `src/world/World.ts` — modern restore + signs
- `src/combat/PlayerArrowManager.ts`, `src/entities/MobManager.ts`, `src/net/applyEntitySnapshots.ts`, `shared/protocol.ts`, `server/gameplay.ts`
- `src/rendering/specialBlockGeometry.ts`, `src/rendering/player/PlayerVisual.ts`, `src/rendering/player/PlayerVisualAnimator.ts`
- `docs/PROJECT_STATE.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, `docs/TESTING.md`, this report

## Architecture decisions

- Compatibility fix is “register real OakSign from main”, not a 165 special-case.
- Arrow protocol stays main (`visualDirection` + `impactVx`). Feature contributes flying = this-tick movement.
- Chicken stays main UV; feature per-face remap was superseded.
- Third-person poses overlay current PlayerVisual; do not replace the whole file from the old feature.

## Deferred / next work

- Owner review of `codex/entity-special-visual-fixes` before any merge to main.
- Live two-client skeleton targeting.
- Live minecart ride through straight/curve/ascend/descend, break/rebuild, save/load.
- Live IndexedDB world that already contains 165 (proven in unit tests).

## Git

- Branch: `codex/entity-special-visual-fixes` only.
- No rebase, no force-push, no `main` commit.
- Push: `origin/codex/entity-special-visual-fixes`.
