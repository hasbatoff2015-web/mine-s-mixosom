# 2026-09-19 — Clan roles + Rating menu

## Goal

Extend the existing Anarchy clan system (no parallel ClanService) with Глава / Ветеран / Участник, nickname invites, member cards, persistent PvP kills, and a main-menu **Рейтинг** tab (four independent rankings, top 50 / 10 per page).

## Result

Roles live on `ClanRecord.roles` with `ownerId` still the leader. Veterans can invite and kick members. Leadership transfers only to a veteran; the old leader becomes veteran. PvP kills persist on `EconomyService` (`balances.json.kills`) independently of the 5-minute economy cooldown. Clan kills are the live sum of **current** members. Main menu is an 8-button 4+4 grid with `public/ui/menu/icon_rating.png`. Rating is a nested `menu` screen, not a second overlay.

## Implemented

- Roles: `leader` / `veteran` / `member`. Server-authoritative `canClanInvite` / `canClanKick` / `canClanManageVeterans` / `canClanTransferLeader`. Unlimited veterans.
- Migration: missing `roles` → owner=`leader`, everyone else=`member`. Missing `kills` → 0.
- Requests tab: nickname invite with inline errors (`Игрок не найден`, this/other clan, duplicate, empty nick, full, sent). TTL remains 24h. `/clan add` picker still requires online.
- Member list: role after nick (`#2f2f2f`), online dots snapshot on card open (no polling), leader always first, sort money/kills.
- Player card: nick, online, role, coins, kills, friends add/already/outgoing+cancel, self «Это вы», kick/promote/demote/transfer by rights.
- Transfer confirm: old leader becomes veteran. `/clan makeleader` list is veterans only.
- Persistent PvP kills via `recordPvpKill` before `rewardPlayerKill`. Mob deaths never increment kills.
- Clan search sort: money keeps members then `createdAt`; kills uses name ASC tie-break.
- Menu **Рейтинг**: players money/kills, clans money/kills; page 10, cap 50, max 5 pages; yellow personal row; personal place even if >50; no-clan text «Вы не состоите в клане».

## Changed files

- `shared/clans.ts`, `shared/ranking.ts` (new), `shared/friends.ts`, `shared/gameMenu.ts`, `shared/protocol.ts`
- `server/services/clan.ts`, `economy.ts`, `friends.ts`, `gameMenu.ts`, `gameMenuActions.ts`
- `server/builtin-plugins/economy.ts`, `server/WorldInstance.ts`
- `src/ui/GameUI.ts`, `clanGui.ts`, `gameMenuGui.ts`, `containerTheme.ts`, `src/style.css`
- `public/ui/menu/icon_rating.png`
- `tests/server/clan-roles-ranking.test.ts` (new), `clan.test.ts`, `clan-plugin.test.ts`, `economy.test.ts`, `friends.test.ts`, `game-menu.test.ts`, `tests/clan-gui.test.ts`, `tests/game-menu-gui.test.ts`
- `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/PLUGINS.md`, `docs/TESTING.md`

## Architecture decisions

- No second clan, kill, or ranking store. Kills sit on `EconomyBalanceRecord` next to balance.
- Ranking snapshot is built in `buildRankingSnapshot` on the existing `menu` message. Clan GUI remains `clan` / `clan_action`.
- Online status is computed once in `memberRows` / `playerCardPayload` when the message is built.
- Nickname invite uses `findPlayerIdentity` (online + stored offline). The add-picker still uses `allowOffline: false`.
- Duplicate invite is now an error (`Игрок уже получил приглашение`), not a silent ok.

## Tests

Focused (80/80 PASS):

```text
npx vitest run tests/server/clan.test.ts tests/server/clan-plugin.test.ts tests/server/clan-roles-ranking.test.ts tests/clan-gui.test.ts tests/server/economy.test.ts tests/server/friends.test.ts tests/game-menu-gui.test.ts tests/server/game-menu.test.ts --maxWorkers=2
```

- clan 20/20, clan-plugin 7/7, clan-roles-ranking 12/12, clan-gui 8/8
- economy 16/16, friends 4/4, game-menu-gui 6/6, game-menu 7/7

`typecheck`, `typecheck:client`, `typecheck:server`, `typecheck:sim`, `check:boundaries` PASS.

`npm run test:server` **56 files / 548 tests PASS**. `npm run test:sim` **12 files / 66 tests PASS**. `npm run build`, `check:size`, `check:archive` PASS. Production **4.78 MiB / 405 files** (`icon_rating.png` 19.9 KiB).

## Visual QA

Automated HTML contracts cover the 4+4 grid, `icon_rating.png`, rating kinds/pagination/personal highlight, clan sort toggles, muted kills color, member-card back. Live Anarchy browser QA of the menu Rating tab, clan card, nickname invite, transfer, and kill increment was **not** run in this cloud pass (no interactive Anarchy clients).

## Performance

No polling of online status. Ranking is built on menu open / `rating_set` / `rating_page`, not every tick. Clan totals/kills remain snapshot-time sums. Kill counter reuses `balances.json` (no extra file). Icon downsampled to 128×128 (~20 KB).

## Known issues

- Members who try to invite still see the owner-only error string (veterans are allowed; members are not).
- `/baltop` still lists money only; kills live in the Rating tab.
- Live two-client Anarchy QA not run.

## Deferred

- Homes / TPA / economy kits / accounts (out of scope).
- Playtime gate on clan create (hook still always ok).
- Clan rename / icon change.

## Next work

Owner live Anarchy: menu Rating four modes + pagination; clan card roles/dots/sort; nickname invite errors; veteran invite/kick; leader promote/demote/transfer; PvP kill increment without waiting 5 minutes.

## Git

Branch `cursor/clan-roles-rating-d1a5` from `origin/main@5521d46`. Do not merge until the owner reviews.
