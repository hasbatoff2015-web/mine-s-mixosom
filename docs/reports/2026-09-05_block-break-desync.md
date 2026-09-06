# Anarchy block-break desync (animation without break)

## Goal

Find why survival block-break outside claims sometimes plays the crack overlay then leaves the block, with no `This land is claimed.` message.

## Result

Root cause is client/server mining timing, not claims. Placement is a single packet so it was unaffected.

## Cause

1. Client `updateTargetAndActions` (20 TPS) reaches `miningProgress >= 1` and sends `block_break_finish`. Overlay hides because it only draws `0 < progress < 1`.
2. Server `breakBlock` required `miningProgress >= 0.95`. Mining starts on the tick *after* `beginMining`, so the client is typically **one tick ahead**. Dirt (hardness 0.5) is 15 ticks: server has `14/15 ≈ 0.933` when finish arrives → `{ ok: false, reason: 'mining' }`. Stone (1.5) is 45 ticks: `44/45 ≥ 0.95` usually succeeds. Spawn schematic is mostly stone; wilderness is dirt/grass — matches the report.
3. Player releases LMB when the overlay finishes. `pollOnlineActionEdges` sent `block_break_abort`, and the next `input` had `mining: false`. Server `tickConnectedPlayers` then cleared `miningTarget`. The almost-complete mine is gone. Next attempt works.

`protectionSources([])` is empty. Claims never cancelled these breaks.

## Fix

- After finish: do not abort that target; keep sending `mining: true` until air/`block_update` or a hard reject.
- Do not treat `reason: mining` as `rejectedBlockKey`.
- Keep overlay at stage 9 until the server removes the block.
- Server finish: matching `miningTarget` and `progress > 0` is enough (not 0.95). Instant start+finish with progress 0 still rejected.

## Tests

- `tests/online-mining.test.ts` — abort/hold/retarget helpers
- `tests/server/player-actions.test.ts` — dirt finish below 0.95; mining:false before finish still cancels
- `tests/server/claims.test.ts` — no protection source outside claims

## Git

Branch `cursor/claims-chat-holograms-3f93`.
