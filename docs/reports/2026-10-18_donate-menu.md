# Donate menu and command fixes — 2026-10-18

## Goal

Make the timed donate ranks usable: `/ranktest` and `/nickcolor` had to work for real, and the main menu needed a «Донат» tab that calls the same server checks as the commands.

## Result

`/ranktest` is on the donate plugin. It stays registered everywhere and refuses everyone, including OP, unless `FC_RANK_TEST` is `1` or `true`. The DEV scripts set that flag. `start:server` does not.

`/nickcolor` no longer dies in the command registry with a generic permission line. The handler checks `nick.color` or OP and tells a normal player that PREMIUM is required. A saved color stops coloring the name when the rank expires.

Coordinate teleport is the existing `/tp`. `/tpa` is only a player request again. TITAN gets one successful `/tp` per 24 hours. A failed move does not spend it. OP is not on that cooldown.

The root menu has a tenth tile, «Донат», using the supplied crown image at `public/ui/menu/icon_donate.png`. The window is filled from `DonationRankService.status()`. Buttons dispatch `/nickcolor`, `/an`, `/invsee`, `/invseeop`, `/back`, `/tp`, `/ec`, and `/kit`. There is no shop.

## Implemented

- DEV `/ranktest set|clear|status` through `DonationRankService`, with an explicit duration suffix.
- `FC_RANK_TEST=1` on `dev:server`, `dev:server:anarchy|survival|peaceful`, and `dev:anarchy`.
- `/nickcolor` permission `player`, server-side `nick.color` check, PREMIUM message.
- `tp.coords` on TITAN. `/tp` and the menu form share `attemptCoordinateTeleport`.
- Cooldown reservation is persisted before the action. A failed reservation skips the action. A failed rollback leaves the stamp.
- Donate screens: overview, color, announcement, invsee, death back, coordinates. Kits and limits are cards or buttons. `invseeop` is sent only for OP.
- If the rank file cannot be read, the menu shows the error and a retry. It does not invent a rank.

## Changed files

- `shared/donationRanks.ts`, `shared/gameMenu.ts`, `shared/protocol.ts`
- `server/services/donationRanks.ts`, `coordinateTeleport.ts`, `donateMenuView.ts`, `gameMenu.ts`, `gameMenuActions.ts`
- `server/builtin-plugins/donate.ts`, `tpa.ts`
- `server/WorldInstance.ts`, `server/config.ts`, `server/builtin-plugins/context.ts`
- `src/ui/donateMenuGui.ts`, `gameMenuGui.ts`, `GameUI.ts`, `containerTheme.ts`, `src/style.css`
- `public/ui/menu/icon_donate.png`
- `package.json`, `scripts/dev-server-mode.mjs`, `scripts/dev-anarchy.mjs`
- tests and the project docs

## Architecture decisions

The menu does not grant ranks or clear cooldowns. It builds a command string and runs it through the same `CommandRegistry` path as chat. A disabled button is not the permission check.

Death return in the menu calls `/back` only when the last teleport history reason is `death`. Other `/back` uses stay on the command.

The icon file is the supplied PNG. Compression was reduced without changing pixels. The tile CSS scales it to the other menu icons. The source is larger than those icons and has a transparent background.

## Tests

`tsc --noEmit` passed. `vite build` wrote `dist/assets/index-BTEV6dYI.css` and `dist/assets/index-BTNEcPSm.js`. `build:server` wrote `dist/server/index.mjs`.

`npm run test:server`: 852 passed, 1 skipped, 4 failed. The failures are the ones already present on `origin/main`: God Sword mob spend, two pet `entity_use` timing tests, and bow-draw FIFO. Donation, menu, anarchy `/tp`, and chat-command tests passed.

## Visual QA

Menu HTML tests check the tenth tile, the icon URL, the disabled TITAN line, and that OP-only invsee is absent from a default payload. A browser session was not started in this run.

## Performance

The donate icon is about 800 KiB. It is one public file, not a second atlas. No meshing or tick work was added.

## Known issues

Remote DEV at `dev.megacraft.agariobrainrot.ru` does not pick this up until that host is updated from this branch and its unit env sets `FC_RANK_TEST=1`. Production units must not get that variable.

## Deferred

No payment shop. No merge to `main`.

## Next work

Deploy this branch to the DEV host only, set `FC_RANK_TEST` on that unit, restart only that unit, then `/ranktest` as OP.

## Follow-up the same day

Death points were missing because `/kill`, lava, hunger and drowning never emitted `entityDeath`, while a mob kill wrote the killer's position into the same slot. Deaths now go to `plugin-data/back/deaths.json` from the corpse position. `/back` uses that point while it is still the latest location. The donate window is wider, actions are cards, kits are a nested screen, and the scrollbar is hidden. An operator without a donate rank gets a nick color that does not recolor `[ADMIN]` or the message text.

`npm run test:server` after this pass: 852 passed, 1 skipped, 4 failed. The four failures are the same ones on `origin/main`.

## Git

Branch `cursor/donation-ranks-fb58`. Draft PR #131. Not merged.
