# Vanilla-style visual armor for local and remote players — 2026-09-07

## Goal

Implement Minecraft-like visible armor for local and remote players without adding a second player rig, changing armor gameplay, or rebuilding render resources per network snapshot.

## Base

- Branch: `codex/player-armor-visuals`
- Starting HEAD: `bcc35df7a736b14b95e8d7507431a7cc57620554`
- `origin/main` after fetch: `bcc35df7a736b14b95e8d7507431a7cc57620554`
- No commit, push or merge was performed.

## Result

Local third-person, first-person right sleeve, and remote players now render independently equipped helmet/chest/legs/feet armor with vanilla-style shells and atlas selection. Exact equipment comes from authoritative inventory state. Existing player animation, lighting, invisibility, interpolation and gameplay armor calculations remain canonical.

## Current player model

The existing hierarchy remains `root → bodyYawRoot → head/body/rightArm/leftArm/rightLeg/leftLeg`; the held item remains a child of `rightArm`. Armor shells attach to those same pivots. The 1.8-block, 32-model-pixel proportions and the existing textured-cuboid UV helper are reused rather than introducing a second skeleton or UV system.

## Implemented

- Added distinct cuboid shells for helmet, chest torso/arms, leggings waist/legs and boots.
- Mapped helmet/chest/boots to `*_layer_1.png` and leggings to `*_layer_2.png`.
- Used 1 px outer inflation and 0.5 px inner leggings inflation in model-pixel scale.
- Preserved independent left/right attachment and animation through parent pivots; Slim keeps its shoulder pivot with vanilla-width 4 px armor sleeves.
- Supported mixed material sets and independent equip/unequip per slot.
- Implemented leather tinted base plus untinted overlay and chainmail alpha cutout.
- Used sRGB + nearest filtering, no mipmaps, clamp-to-edge, depth-writing alpha test.
- Added shared geometry, texture and material-template caches; per-view material clones keep entity lighting isolated. Meshes are constructed once and only visibility/material binding changes.
- Asset load failures are reported and do not silently fall back to iron.

## Local player

`playerEquipmentFromInventory` maps the canonical local `Inventory.armor` stacks to exact item IDs. `Game.updatePlayerPresentation` sends the result to the local third-person `PlayerVisual` and the first-person renderer. The first-person armor implementation is only a right-arm chestplate sleeve and never creates helmet/torso/leg shells near the camera.

## Remote players

The Node-safe protocol now has optional `PlayerEquipmentState` on both `RemotePlayerInfo` and `PlayerSnapshot`. `WorldInstance` derives the four exact item IDs from each authoritative server inventory. `RemotePlayerView` applies changed equipment to its existing `PlayerVisual` without reconnect, and clears all slots on death/reset. Optional absence maps to empty equipment for compatibility with existing fixtures/older packets; `PROTOCOL_VERSION` stays 3.

## Material support

- Leather: gameplay item + tinted base and overlay visual.
- Gold: gameplay item + layer 1/layer 2 visual.
- Iron: gameplay item + layer 1/layer 2 visual.
- Diamond: gameplay item + layer 1/layer 2 visual.
- Chainmail: transparent visual assets/resolver/QA are supported for conventional exact IDs, but the current authoritative item registry deliberately has no chainmail gameplay items. This task does not add Creative entries, recipes, saves, armor points or damage behavior.

## Changed files

- `shared/protocol.ts`: optional exact equipment snapshot contract.
- `src/inventory/equipment.ts`, `src/inventory/index.ts`: canonical inventory-to-presentation mapping/export.
- `server/WorldInstance.ts`: authoritative equipment in join and tick snapshots.
- `src/rendering/player/PlayerArmorVisual.ts`: shells, UV mapping, material/texture/geometry caches and first-person sleeve.
- `src/rendering/player/PlayerVisual.ts`: armor lifecycle and visibility integration.
- `src/rendering/FirstPersonRenderer.ts`: right sleeve integration.
- `src/core/Game.ts`: shared resources and local/remote equipment wiring.
- `src/net/RemotePlayerView.ts`: initial/live/death equipment application.
- `src/dev/PlayerQaHarness.ts`: deterministic per-slot material QA controls.
- `tests/player-armor-visual.test.ts`, `tests/player-armor-network.test.ts`: new regressions.
- `tests/remote-action-presentation.test.ts`: existing view mock updated for the extended visual contract.
- `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`: current state and architecture handoff.

## Tests

- `npm run typecheck`: PASS.
- `npm run typecheck:client`: PASS.
- `npm run typecheck:server`: PASS.
- `npm run typecheck:sim`: PASS.
- `npm run check:boundaries`: PASS.
- Final armor/player-focused five-file run: 26/26 PASS.
- Related 12-file player/inventory/network/render run: 117/117 PASS.
- `npm run build`: PASS; 243 modules, JS 1,282.42 kB / 370.20 kB gzip, CSS 48.44 kB / 11.00 kB gzip. Existing `/sdk.js` resolution and large-chunk warnings remain.
- `git diff --check`: PASS; Git only reports repository CRLF conversion advisories.
- Full `npm test -- --maxWorkers=2`: 1791 PASS, 14 FAIL, 1 failed suite, 1 unhandled worker timeout across 183 files / 1805 collected tests. All armor tests passed. Failures are outside changed code: existing 5 s CPU-sensitive timeouts in worldgen and fire-contact/minecart tests, repeated `tick-load-flight` >80 ms, and the unchanged `minecraft-reference-extractor.test.mjs` parse failure. The previous main report already recorded the same failure classes under full-suite load.

## Manual visual QA

WebGL QA used the real `PlayerVisual` through `?qaPlayer=1`:

- Full iron set in idle/sprint/eat/block poses.
- Mixed iron helmet, diamond chest, gold leggings and leather boots while walking.
- Chest-only sneak, leggings-only jump, boots-only mining.
- Full chainmail attack: transparent holes, no visible sorting artifacts.
- Full leather bow: tinted base plus untinted overlay.
- Classic and Slim arm/pivot alignment.
- First-person with chest equipped: sleeve only; helmet/legs/boots did not enter the camera.
- First-person chest unequipped while other slots remained: bare arm and no near-plane armor.
- Browser console warning/error lists were empty.
- Two real Online clients joined the same local authoritative server with distinct player/session IDs. Client B saw client A's iron helmet + diamond chest + gold leggings + leather boots, then saw the diamond chest disappear without reconnect while the other pieces remained. Client A then saw client B's iron chestplate.
- Client B switched to Survival and ran `/kill`; the server dropped the chestplate, respawned B with empty inventory, and client A rendered the respawned player without ghost armor. Closing B removed the remote immediately (`Remote (none)`). Rejoin/reset equipment replacement is asserted in the network integration test.

## Performance

Armor geometry and texture/material templates are shared application-wide. Each player view creates a bounded fixed mesh set once. Identical equipment signatures short-circuit; network snapshots never rebuild geometry or reload textures. The server transmits four optional item IDs inside existing metadata/snapshot packets and adds no second update protocol or tick loop.

## Regressions

No changes were made to armor points, durability, damage reduction, inventory validation, combat timing, movement, interpolation or fixed 20 TPS simulation. Shared simulation remains free of Three/DOM/filesystem dependencies, and server code does not import rendering.

## Known issues

- Chainmail remains presentation/QA-only because the current gameplay registry explicitly excludes it.
- Full-suite baseline remains load-sensitive as listed under Tests; the armor-focused and related suites are green.

## Deferred

- Any gameplay addition of chainmail requires a separate explicit task covering registry, recipes, saves, UI and combat values.

## Next work

If chainmail gameplay is later requested, add it as a separately reviewed registry/recipe/save/combat change; the visual resolver and transparent atlas path are already ready.

## Git

Working tree intentionally remains uncommitted. No commit, push, merge, rebase or Git configuration change was performed.
