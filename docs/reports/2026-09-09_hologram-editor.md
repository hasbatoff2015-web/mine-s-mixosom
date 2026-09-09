# Hologram in-game editor

## Goal

Let Anarchy players with hologram permission edit an **existing** hologram from a simple in-game UI (RMB), without a second hologram system, without breaking `/holograms` commands, persistence, or other right-click interactions.

## Result

Done. RMB on a hologram billboard opens GameUI «Редактор голограммы» for that record. Save goes client → server validate/permission → plugin JSON persist → `holograms` broadcast → every client `HologramRenderer` updates. Cancel sends nothing.

## Implemented

- Hologram hit uses the existing look ray plus an AABB around the current sprite scale (`hologramHit.ts`). If that hit is closer than or equal to the block under the crosshair, Online RMB sends `hologram_interact` instead of bow/block `interact`.
- Server re-checks `PLAYER_NET_REACH` to the AABB and `holograms.create` / OP. Denied players get the existing `You do not have permission.` chat/command_result and no editor packet.
- Editor overlay: text (multiline `\n` → `lines[]`), size 0.5–2.5, style Normal/Bold/Italic/Bold Italic, font picker, local preview, Save/Cancel. Pointer lock released on open, restored on close. Overlay is included in `isBlockingOverlay`.
- Appearance stored on the same `HologramRecord`: `font`, `size`, `style`. Editor cannot change position, name, range, enabled, or invent an owner (there is still no owner field).
- `HologramRenderer` canvas uses `hologramCanvasFont` and scales the sprite by `size`. Billboard, range cull, IDs, add/update/remove unchanged.

## Fonts (verified, not guessed)

| Picker id | Family | Asset | Where the game already uses it |
| --- | --- | --- | --- |
| **ui** (Игровой) | **Inter** | `public/fonts/inter/inter-latin-400-700.woff2`, `inter-cyrillic-400-700.woff2` | Main UI: `src/uiTokens.css` `@font-face` + `--font-ui`; `src/style.css` `:root { font-family: var(--font-ui) }` |
| **display** (Пиксельный) | **Press Start 2P** | `public/fonts/press-start-2p/press-start-2p-{latin,cyrillic}-400.woff2` | Titles: `--font-display` in `uiTokens.css` |
| **sans** (Классический) | generic `sans-serif` | no extra file | Historical hologram canvas: `bold 36px sans-serif` |

Wiring: the same `@font-face` rules already load Inter and Press Start for the HUD. `HologramRenderer` calls `document.fonts.load` for `"Inter"` / `"Press Start 2P"` and sets `context.font` via `hologramCanvasFont`. No Google Fonts, no CDN, no second font pipeline.

**Bold:** Inter’s bundled file is weight 400–700, so `ui` + bold is a real 700 face. Press Start is 400-only; bold is canvas synthesis. **Italic:** both families are `font-style: normal` only (`:root { font-synthesis: none }` on HTML). Canvas `italic` is synthesis; the editor preview allows `font-synthesis: weight style` so the preview matches canvas, not a fake extra stroke.

Default for command-created and old records: `sans` + `bold` + `size=1` so existing holograms keep the previous look.

## Data path

1. Client `hologram_update` (name + lines + font + size + style only).
2. `parseClientMessage` rejects unknown font/style, out-of-range size, oversized lines, missing name.
3. `WorldInstance.updateHologramAppearance` checks reach + `holograms.create` / OP.
4. `HologramNetwork.updateAppearance` writes the record, broadcasts `{ type: 'holograms' }`, plugin `setPersist` saves `plugin-data/holograms/holograms.json`.
5. Clients `HologramRenderer.sync`.

## Permissions

Same as `/holograms` mutate commands: `holograms.create` (moderator) or `holograms.*` (admin) or OP. There is no per-hologram owner; this pass does not add one.

## Tests

- `tests/hologram-style.test.ts` — serialization, old records, font/size/line validation, unknown font, malformed update, extra fields dropped.
- `tests/hologram-hit.test.ts` — RMB hologram vs world; Online `sendOnlineUse` checks hologram before bow.
- `tests/server/hologram-editor.test.ts` — successful edit + persist + broadcast, cancel, permission denied, old JSON defaults, malformed packets.

`test:sim` **53/53**. `test:server` **320/320**. Four typechecks + `check:boundaries` PASS.

## Visual QA

Not run against a live Anarchy client in this cloud pass (no two-player walkthrough). Overlay HTML/CSS follows existing `modal-backdrop` / `menu-card` / `game-button`. Owner should RMB a hologram, edit Inter/italic/size, Save, reconnect, and confirm chests/doors still RMB-use when not aiming at a hologram.

## Performance

Unchanged meshing/TPS. One extra AABB ray per Online use against ≤64 holograms.

## Known issues

- Italic (and Press Start bold) is canvas synthesis; there is no italic woff2 in the repo.
- Holograms have no owner: anyone with `holograms.create` can edit every hologram, matching `/holograms line set`.

## Deferred

Placeholders, pages, click-commands, and a third bundled typeface.

## Next work

Owner live Anarchy QA of the editor, denied players, and pointer-lock restore.

## Git

Branch `cursor/hologram-editor-5fe9` from current `main` (`90f1eef`, PR #76).
