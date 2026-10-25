# Mobile touch, menu chrome, auction back — 2026-10-25

## Goal

Fix six confirmed play problems in one branch: hold-to-break interactive blocks, creative-catalog scrolling, buyer NPC taps, the emote button, game-menu geometry, and auction Back.

## Result

Each fix stays on the existing input, inventory, emote, menu, and auction paths. No second input stack and no new UI framework. `origin/main` was `c8da9fc` before and after this work. The anti-dupe branch and PR #129 were not touched.

## Implemented

- Tap on a crafting table, furnace, chest, or other use-target still opens it. Hold mines it when `breakable !== false` and hardness is at least 0. Bedrock and liquids stay unbreakable.
- A coarse vertical swipe on a creative catalog slot scrolls that catalog and does not send an inventory action. A short tap still sends one click. Ordinary slot drags are unchanged.
- A buyer along the finger ray sets the existing use intent. `sendOnlineUse` still calls `tryInteractBuyer`. A closer block, mob, cart, or player blocks the NPC. Reach stays `PLAYER_REACH`.
- `#hud-emote` is a button. A short press opens the current four-sector wheel. A press on a sector starts that emote through `EmoteSession`. Z and pointer-lock aiming are unchanged.
- Back and close sit in one header row inside the menu and trade panels. Resize uses `menuLogicalWidth`, including donate screens. The panel scrolls inside the visual viewport.
- Opening the auction from the menu marks `openedFromMenu` before the first flush. One packet carries `source: 'menu'`. Nested screens have one Back control. X still closes.

## Changed files

- `src/input/mobileTouch.ts`
- `src/core/Game.ts`
- `src/net/buyerInteract.ts`
- `src/ui/inventoryPointerGesture.ts`
- `src/ui/GameUI.ts`
- `src/ui/emotePointer.ts`
- `src/ui/auctionGui.ts`
- `src/ui/gameMenuGui.ts`
- `src/ui/containerTheme.ts`
- `src/style.css`
- `server/WorldInstance.ts`
- tests listed below
- this report and the state docs

## Architecture decisions

Usable and breakable are two facts. Reordering the old `if (interactive) return 'use'` was not enough, because `classifyWorldTouch` also forced `breakableBlock` false for every use target.

Catalog scrolling is a phase of the existing gesture, not a second drag system. Pointer capture stays on the modal. The handler writes `scrollTop` so a captured finger still scrolls. `touch-action: pan-y` is set on the catalog slots themselves, ahead of the global `touch-action: none` slot rule.

Buyer selection is one function shared by desktop use and the mobile classifier. The mobile aim is the finger look already stored in `interactionAim`, then sampled by `sampleLocalAim` before `sendOnlineUse`.

The emote button does not invent a second playback path and does not dispatch a keyboard event.

Menu geometry puts the controls inside the panel so the scale math describes the whole window. Auction origin is server state, fixed before the first snapshot, and the client rebuilds the back row when that flag changes on the same screen.

## Tests

- `tests/mobile-controls-ui-auction.test.ts`
- `tests/emotes.test.ts`
- `tests/game-menu-gui.test.ts`
- `tests/server/game-menu.test.ts`
- `tests/server/auction-plugin.test.ts`
- `tests/mobile-layout-rects.test.ts` menu rects at 844×390, 932×430, 740×360, 390×844, 1280×720, and 1920×1080 for homes, trade, and root

## Visual QA

Headless Chrome measured real rects: back and close stay inside the panel, neither overlaps the heading or the text field, and the panel stays inside the viewport without horizontal overflow. A physical phone was not available.

## Performance

Buyer rays run on a tap, a hold start, or a use edge. They are not on the 20 TPS tick. Catalog scroll updates one element's `scrollTop` during the pointer move. No new SQL and no global listener without the existing cleanup.

## Known issues

`tests/game-menu-gui.test.ts` still fails in this environment on `icon_rating.png` because Python has no `PIL`. That check was already in the file and does not depend on this change.

## Deferred

Physical-device confirmation of finger mining, catalog fling, and the emote wheel. No production deploy.

## Next work

Owner QA on a phone and on desktop, then an independent review before merge.

## Git

Branch `cursor/mobile-controls-ui-auction-fixes-7178` from `c8da9fc`. Draft PR #139 to `main`. No merge.

## Follow-up after the audit

- Catalog scroll is native only. Coarse presses on catalog slots do not call `preventDefault` or `setPointerCapture`, and the gesture does not write `scrollTop`.
- `relayoutOpenOverlays()` updates `--mc-ui-scale` on the open stage. A repeated viewport size is ignored. An actual size change cancels an inventory drag without an action.
- `menuUiScale()` never returns below 1. Donate width shrinks to the viewport so the panel still fits, and the body scrolls.
- A focused draft field on the same screen is kept when a server menu, auction, clan, or buyer snapshot arrives.
- The joystick and the jump button ignore a second pointer. `lostpointercapture` releases that control.
- An empty world hold becomes a camera swipe after the swipe threshold. Mining, bow, and food holds do not.
- The boss bar stops before the corner buttons. Text fields are exempt from the global context-menu block.
- Emote `lostpointercapture` and a hidden document abort the wheel gesture without a second emote start.
