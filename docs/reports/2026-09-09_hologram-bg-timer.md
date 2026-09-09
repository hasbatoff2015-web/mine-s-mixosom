# Hologram background, fixed orientation, and timer

## Goal

Extend the existing Anarchy hologram editor (PR #77) with three features, without a second renderer or permission model:

1. Toggleable background as a separate visual layer, with width/height independent of text size.
2. Fully fixed world orientation (no camera-facing / billboard).
3. Cyclic server-authoritative timer holograms, plus `/hologram reset <name>`.

## Result

Done. Legacy holograms still default to normal text, background on, billboard on, historical font/size/style. `HologramRenderer` now uses a Group with a background plane and a text plane (no `THREE.Sprite`). Timer remaining is computed on the client from `timerDuration` + `timerStartedAt` and existing `welcome`/`pong` server wall-clock.

## Implemented

- Editor: type (Обычная / Таймер), timer duration, background checkbox, background width/height, orientation radios. Timer hides the text field. Preview uses a separate background box; timer preview ticks locally. Save sends the patch; Cancel does not.
- Renderer: text canvas no longer bakes `fillRect`. Background mesh `visible=false` when off. Billboard copies camera quaternion; fixed uses stored yaw only.
- Server: `kind`, `timerDuration`, `timerStartedAt`, `background*`, `billboard`, `yaw`. Switching to timer or changing duration sets `timerStartedAt = Date.now()`. Switching to fixed captures the editing player's yaw. `/holograms reset` / `/hologram reset` restarts the cycle for everyone.
- Time sync: `welcome.serverNow` and `pong.serverNow` (existing ping/pong). No per-second timer packets.

## Changed files

- `shared/hologramStyle.ts`, `shared/protocol.ts`
- `server/services/holograms.ts`, `server/builtin-plugins/holograms.ts`, `server/WorldInstance.ts`, `server/AnarchyServer.ts`
- `src/rendering/HologramRenderer.ts`, `src/gameplay/hologramHit.ts`, `src/ui/GameUI.ts`, `src/core/Game.ts`, `src/style.css`
- `tests/hologram-style.test.ts`, `tests/hologram-hit.test.ts`, `tests/hologram-timer.test.ts`, `tests/server/hologram-editor.test.ts`
- `package.json` (`test:sim` includes `hologram-timer.test.ts`)
- `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/TESTING.md`, `docs/PLUGINS.md`

## Architecture decisions

- One `HologramRenderer`. Planes replace Sprite because Sprite cannot disable camera-facing.
- JSON field `kind` (`normal` | `timer`) avoids colliding with protocol message `type`.
- Countdown includes a one-second `00:00` beat: `period = duration + 1`.
- Client cannot set `timerStartedAt` or `yaw`. Extra `hologram_update` keys are dropped.
- Background defaults equal the old sprite size (`2.6 × 0.77` at size 1, one line) so legacy looks unchanged, then those values persist independently of later text-size edits.
- Permission remains `holograms.create` / OP.

## Tests

- `tests/hologram-style.test.ts` — legacy defaults, independent background size, new fields serialize, `timerStartedAt`/`yaw` dropped from client updates.
- `tests/hologram-hit.test.ts` — RMB hologram vs world; larger background AABB; Online use still checks hologram before bow.
- `tests/hologram-timer.test.ts` — countdown wrap, MM:SS / HH:MM:SS, join-mid-cycle remaining, renderer has no Sprite / no camera-facing when fixed, no tick packets, editor controls present.
- `tests/server/hologram-editor.test.ts` — persist/broadcast of background+fixed+timer, no hologram packets across 40 ticks, `/hologram reset` for all players, reset errors, normal↔timer, reconnect.

`npm run test:sim` 63/63. `npm run test:server` 324/324.

## Visual QA

Not run against a live two-client Anarchy session in this cloud pass (needs OP, pointer lock, walking around a fixed hologram). Owner should: RMB hologram, toggle background and size, lock orientation and walk around, convert to a 10s/60s/>1h timer, join mid-cycle, `/hologram reset`, reconnect, RMB hologram next to a chest/door.

## Performance

Unchanged TPS. Timer canvas redraws only when the displayed second changes. One extra plane per hologram.

## Known issues

- Fixed holograms stay upright (yaw only). There is no in-editor rotation gizmo.
- Timer preview in the editor uses local countdown after the user edits duration; saved world state is unchanged until Save.

## Deferred

- Owner live Anarchy QA list above.
- Per-hologram owner field (still not added).

## Next work

Owner visual pass on a running Anarchy process.

## Git

Branch `cursor/hologram-bg-timer-5fe9` from `cursor/hologram-editor-5fe9`.
