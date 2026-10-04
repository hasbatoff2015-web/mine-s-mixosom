# 2026-10-04 — Мегакрафт menu UI refresh

## Goal

Rebrand the player-facing menu from Frontier Cubes to one-line «МЕГАКРАФТ», remove the Account screen, edit the nickname on the online-server screen, replace the FC server marks with inline SVG and rotating captions, let the skin-selector preview be dragged, and rewrite the controls help from the current input code. Typography stays on the existing Press Start 2P / Inter pair and is scoped to menu surfaces. The menu background file is unchanged.

## Result

The main menu, loading title, online list, skin picker, settings labels, and controls help use the new menu chrome. Nickname validation is one shared contract: 2–20 characters, `^[A-Za-z0-9]+$`, no trim. Connect still sends the last successfully saved nickname. Production and gameplay systems were not changed.

## Implemented

- Main-menu logo is a single `МЕГАКРАФТ` line. The version footer, «survival alpha», and the Account button are gone.
- Loading title is `МЕГАКРАФТ`. The generic `.brand-mark` stays.
- Online screen has a compact nickname strip between the header and the server list. «Изменить» is disabled when the draft is invalid or unchanged. An invalid submit shows the shared error. A successful save shows «Сохранено» for 1.6s and the existing toast.
- Server rows keep the names and order Анархия PvP, Выживание PvP, Мирный. Each row has three captions and a 56px inline SVG. Captions rotate with CSS only.
- Skin cards no longer show Classic/Slim, and the model toggle is gone. `selectSkin()` still applies `defaultModel`. The large preview accepts pointer yaw drag at 0.012 rad/px and pauses auto-spin only while the pointer is held. The main-menu preview stays auto-only.
- Controls help is Movement, Gameplay, and a full-width mobile section. F3/F7/F8/F9 remain in `Game.ts` and are not listed for players. Ctrl is described only as creative flight acceleration.
- Press Start 2P (weight 400) is applied to primary menu text. Inter stays on helper text, captions, counts, and descriptions. `body`, chat, HUD, and inventory are unchanged.

## Changed files

- `shared/config.ts`, `shared/playerName.ts`
- `src/ui/menuModel.ts`, `src/ui/GameUI.ts`, `src/ui/skinPreviewDrag.ts`
- `src/core/Game.ts`
- `src/rendering/player/PlayerAppearancePreview.ts`
- `src/style.css`, `index.html`
- `tests/player-nickname.test.ts`, `tests/menu-model.test.ts`, `tests/online-server-menu.test.ts`, `tests/ui-main-integration.test.ts`, `tests/player-skin-selector.test.ts`, `tests/skin-preview-drag.test.ts`, `tests/mobile-controls-sky-hud.test.ts`, `tests/server/console-and-nickname.test.ts`
- `docs/ARCHITECTURE.md`, `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`

## Architecture decisions

- Menu UI stays `Game` → `GameUI` HTML strings → `style.css`. `menuModel` owns server captions, icons, and control copy.
- Pointer tracking lives in `skinPreviewDrag.ts`. `PlayerAppearancePreview` only changes yaw. There is still one preview renderer.
- Caption rotation is a 9s CSS animation with `--caption-index * 3s` delay. `prefers-reduced-motion` shows only the first caption.
- `fc.player.nickname` and `/ui/frontier-menu-background.png` stay as persisted/internal identifiers. `PROTOCOL_VERSION` stays 4. Server console names such as `Frontier Cubes Anarchy` stay.

## Tests

`npx vitest run` of the eight files below: 8 files, 68 tests, PASS.

- `tests/player-nickname.test.ts` — 6
- `tests/menu-model.test.ts` — 5
- `tests/online-server-menu.test.ts` — 9
- `tests/ui-main-integration.test.ts` — 6
- `tests/player-skin-selector.test.ts` — 10
- `tests/skin-preview-drag.test.ts` — 4
- `tests/mobile-controls-sky-hud.test.ts` — 22
- `tests/server/console-and-nickname.test.ts` — 6

`npm run typecheck:client` PASS. `npm run typecheck:server` PASS. `npm run check:boundaries` PASS. `git diff --check` PASS (LF/CRLF warning only). `npm run build` PASS (`tsc --noEmit && vite build`, built in 7.18s). The existing `sdk.js` and chunk-size warnings are unchanged.

## Visual QA

Local Vite at `http://localhost:4173/`. Production was not opened.

- 1920×1080: main menu, online list, settings, controls (desktop and scrolled mobile section), skin selector. Logo is one line. No Account, footer, or Frontier text. Nickname save showed «Сохранено» and the existing toast. Server icons are SVG. Skin auto-spin and a 200px drag changed the pose. Drag cursor goes from grab to grabbing. No Classic/Slim UI.
- 1366×768: main menu. Logo box 304–1062 inside the viewport. No page overflow.
- 844×390 and 667×375: main, online, and (844) controls and skin. Existing `--menu-fit` zoom is the only scale. Captions, server names, the nickname button, and control labels do not overflow their boxes. Footer actions stay on screen.
- 390×844 portrait: logo fits (about 87–303px). The character panel is clipped on the right by the existing two-column main-menu grid, which was not changed.

Not captured as a screenshot: the loading screen. Cached boot reaches the main menu before the browser tool returns a frame. A document-start observer did not run, so the loading title was not seen live.

## Performance

Server captions do not use `setInterval` or `requestAnimationFrame`. Skin drag only adds yaw on the existing preview. No new network messages and no new font or icon dependency.

## Known issues

- Portrait main menu still clips the character panel. That grid is the previous landscape layout.
- Short landscape controls keep the mobile section in the scroll area under the two desktop columns.
- `git diff --check` warns that `src/style.css` LF will be checked out as CRLF on this machine. The blob stays LF.

## Deferred

- Physical phone touch QA. Touch drag was checked with synthetic `pointerType: "touch"` events in the desktop browser.
- DEV deployment of this branch. Visual QA used local Vite.

## Next work

Owner can review the draft PR. Do not merge from this task. Production deploy is out of scope.

## Git

Feature branch `cursor/megacraft-menu-ui-refresh` from `origin/main` `620e812fb681ae946780c61ef024fc9ff55aa3e5`. Not merged.
