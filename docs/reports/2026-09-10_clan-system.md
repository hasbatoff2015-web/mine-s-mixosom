# 2026-09-10 — Clan system

## Goal

Add a full Anarchy clan system on the existing PluginManager / EconomyService / inventory-style GUI, without a second wallet or Auction House regressions.

## Result

Builtin `clan` + `ClanService`. Players create/join/leave/rank clans through `/clans` and `/clan …` inventory chrome. Rank wealth is the live sum of member Megacoin balances.

## Implemented

- One clan per player, max 20 members including owner.
- Create costs 10 000 МК (`EconomyService.withdraw`, reason `CLAN_CREATE`); `canCreateClan` hook (always true; PlaytimeService later).
- Unique case-insensitive names 3–16 (`\p{L}\p{N} _-`); 10 icon ids; no rename/recolor after create.
- Owner-only delete (no refund), add (online invite), makeleader, kick; member leave; accept invitations.
- 24h invitations and join requests, expired on load/open/action (no per-item timers).
- One pending request; replacement confirm when switching clans.
- `/clans` ranking: total desc, member count desc, createdAt asc. Search/refresh/pagination. Compact К/М labels.
- Inventory-style GUI (`src/ui/clanGui.ts` + GameUI): long rows, trophies #1–#3, back ←, two-line create button, owner yellow names, kick on the same card.
- Protocol `clan_action` / `clan`. Client sends intents only.
- Persistence `plugin-data/clans/clans.json`. Player/clan locks for last-slot and duplicate join races.

## Changed files

- `shared/clans.ts`, `shared/megacoins.ts`, `shared/protocol.ts`
- `server/services/clan.ts`, `server/services/economy.ts` (`CLAN_CREATE`), `server/services/permissions.ts`
- `server/builtin-plugins/clan.ts`, `index.ts`, `context.ts`
- `server/WorldInstance.ts`, `server/AnarchyServer.ts`
- `src/ui/clanGui.ts`, `src/ui/GameUI.ts`, `src/style.css`, `src/core/Game.ts`
- `tests/server/clan.test.ts`, `tests/server/clan-plugin.test.ts`, `tests/clan-gui.test.ts`
- `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/PLUGINS.md`, `docs/TESTING.md`

## Architecture decisions

- No stored clan total; ranking reads EconomyService at snapshot time.
- Emoji/Unicode clan badges and CSS trophies instead of heavy PNG packs (archive budget).
- `formatCompactMegacoins` lives in `shared/` so server snapshots and GUI tests share one helper. Existing chat `formatMegacoins` is unchanged.
- Clan GUI is a sibling of Auction House, not a second inventory system; search patch reuses `keepAuctionSearchDraft`.

## Tests

Focused: clan 15/15, clan-plugin 5/5, clan-gui 6/6, auction 24/24, auction-plugin 9/9, auction-gui 6/6, economy 15/15. `test:server` **43 files / 440 tests PASS**. Four typechecks, `check:boundaries`, and `build` PASS. Live browser Anarchy QA was **not** run. Extra coverage: ranking tie-break (member count, then createdAt), invalid icon, invite-already-in-clan, and plugin join-request replace/accept.

## Visual QA

Live browser Anarchy QA was **not** run. Manual scenarios are listed in the report “Next work” / agent final message.

## Performance

No per-tick clan scan. No per-invitation timers. `/clans` sends one page. `/clan add` sends only eligible online players.

## Known issues / Deferred

- Playtime ≥ 10 hours is not enforced; hook is ready.
- Clan rename / icon change are out of scope.
- Live Anarchy GUI QA.

## Git

Branch `cursor/clan-system-a8dc` from `origin/main@750a3b7`. PR: https://github.com/hasbatoff2015-web/mine-s-mixosom/pull/85
