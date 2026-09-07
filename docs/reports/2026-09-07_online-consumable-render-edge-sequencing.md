# Online consumable render-edge sequencing follow-up

## Goal

Fix only the Online food/potion race where the RMB render edge occurs between fixed input commands N and N+1. Preserve all other gameplay fixes, protocol 3, authoritative inventory, bow release/captured aim, Networking V2, prediction, mining and targeted block validation.

## Base

- Branch: `codex/fix-gameplay-bugs-2026-09-07`.
- Starting HEAD: `868206de5a095b67f9255f8ae7305090de7333ec` (`fix: resolve gameplay and online interaction bugs`).
- Branch matched `origin/codex/fix-gameplay-bugs-2026-09-07` and the worktree was clean.
- No commit or push performed by this follow-up.

## Reproduction

The real client can send input N with `use=false, selectedSlot=0`, then switch to slot 3 and press RMB during a render frame before `tickOnline` sends N+1. `sendOnlineUse` consequently sends `interact { commandSeq:N, selectedSlot:3 }`.

Two pre-fix failures were captured test-first:

- same-slot Apple action was accepted, but the sticky/equal pre-use command N immediately reset `foodUseTicks` from 1 to 0;
- immediate switch to server inventory slot 3 was rejected as `reason='slot'` because slot 3 was compared to the old command N slot 0.

The initial realistic-order run failed 2/4 server cases exactly at those assertions. The N+1 release and N+1 slot-change cancellation cases already cancelled, but are retained as boundary-contract regressions.

## Result

An Online consumable action now has an explicit command boundary. Pre-use state through N cannot cancel the action. The first strictly newer command either confirms continued use on the captured slot or cancels it. Immediate slot switch is supported without trusting an item id, relaxing target validation or allowing an old command to select a different slot.

## Server semantics

- `resolveActionSlot` validates the slot as an integer in the hotbar range.
- `commandSeq` must still resolve through pending/applied command state or action pose history.
- A slot differing from boundary command N is accepted only when N equals the newest received `lastInputSeq`; a mismatch attached to an older command remains `reason='slot'`.
- The actual Apple/GoldenApple/Potion stack is read from the captured slot in server `Inventory`.
- The server records whether command N already contained matching `use=true + slot`.
- For normal render-edge order, food state at `commandSeq <= N` is ignored. For alternate order where N already confirms use, N may advance it. Bow uses its existing comparison and release action unchanged.
- At the first command `> N`, `use=false`, another selected slot or another stack cancels without consumption. Matching `use=true + slot + item` advances to completion.
- Existing death, reconnect, item replacement, inventory sync, bottle return and bottle overflow cleanup remain in the same authoritative path.

## Client presentation

`shouldClearLocalFoodUseFromSnapshot` encodes the same boundary rule. A delayed local player snapshot for N with authoritative progress 0 is pre-use state and does not clear the immediate animation. A strictly newer snapshot with progress 0 may cancel it; positive progress keeps it. The client still never consumes an item or applies potion effects.

## Targeted interaction safety

The follow-up does not accept a client item id. A dedicated regression proves:

- invalid hotbar index is rejected;
- slot mismatch attached to an older command is rejected;
- stale `targetBlockId` is still rejected by canonical block intent validation;
- rejected actions do not place a block or decrement server inventory.

Face, reach, pose history, action sequence, block ID and plugin validation were not loosened.

## Changed files

- `server/WorldInstance.ts`
- `server/gameplay.ts`
- `src/core/Game.ts`
- `src/net/onlineConsumableUse.ts`
- `tests/online-consumable-use.test.ts`
- `tests/server/player-actions.test.ts`
- `tests/server/anarchy-server.test.ts`
- `docs/PROJECT_STATE.md`
- `docs/ROADMAP.md`
- `docs/ARCHITECTURE.md`
- this report

## Tests

- Red phase: realistic render-edge subset failed 2/4, reproducing equal-N cancellation and immediate-slot `reason='slot'`.
- `tests/online-consumable-use.test.ts` + full `tests/server/player-actions.test.ts`: 34/34 PASS.
- Food/potion/bow/presentation gate: 12 files, 130/130 PASS.
- Networking V2/mining gate: 14 files, 182/182 PASS.
- Targeted render-edge security case: PASS.
- `npm run typecheck`: PASS after separating pose history from actual command state.
- `npm run typecheck:client`: PASS.
- `npm run typecheck:server`: PASS.
- `npm run typecheck:sim`: PASS.
- `npm run check:boundaries`: PASS.
- targeted reconnect cleanup regression: PASS.
- `npm run build`: PASS; 229 modules, only the existing `/sdk.js` and large-chunk warnings.
- `git diff --check`: PASS; only Git's advisory LF→CRLF messages.

## Visual QA

Manual two-client/browser QA was not performed. Automated checks cover the authoritative command order and local snapshot-boundary decision but are not represented as visual acceptance.

## Performance

The change adds constant-time boundary/slot comparisons per consumable hold and no new packets, queues, scans, world work or simulation ticks.

## Known issues

- Live owner QA remains for immediate number-key/scroll switch + RMB and the first delayed snapshot animation.
- Previously documented unrelated repository-wide timeout/transform failures were not addressed in this focused follow-up.

## Deferred

- Any protocol bump, client item id, bow/mining rewrite or changes to the other five gameplay fixes.

## Next work

Owner live QA, then commit/push only if explicitly requested.

## Git

- Branch: `codex/fix-gameplay-bugs-2026-09-07`.
- Starting HEAD: `868206de5a095b67f9255f8ae7305090de7333ec`.
- Commit: none in this follow-up.
- Push/PR: none in this follow-up.
