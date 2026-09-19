# 2026-09-19 — Clan invitations tab + leader announcement

## Goal

Continue draft PR #96: fix ranking coin glyphs, add a Кланы **Приглашения** tab with accept/reject, change invite chat text, and add a Leader-only clan announcement with a persisted 3-hour cooldown. Do not merge.

## Result

Ranking money rows reuse `public/ui/menu/icon_coin.png` (same asset as the menu balance). Clan invitations stay on `ClanService` with the existing 24h TTL. The menu Кланы hub always exposes **Приглашения**. Only the current Leader can open/send **Объявление соклановцам**; online members of that clan receive a turquoise system line. Cooldown is stored on the clan record.

## Implemented

- Ranking `valueLabel` is a formatted number only. GUI prepends `.mc-menu-coin` / `icon_coin.png`.
- Invite chat: `Игрок <ник> пригласил вас в клан <название>. Примите приглашение в меню` (recipient only).
- `menu_action` `clans_invitations` opens the existing accept screen even if the player is already in a clan. Rows show clan, inviter nick, remaining TTL, **Принять** / **Отклонить**.
- `reject_invitation` and `confirm_accept` re-check ownership, expiry, membership, clan existence and capacity on the server. Client `playerId` is ignored.
- Leader-only `open_announce` / `set_announce_text` / `send_announcement`. Text uses `MAX_CHAT_LENGTH` (128) and `CHAT_TOO_LONG_ERROR`. Empty text is rejected. Online members at send time get `[ОБЪЯВЛЕНИЕ ОТ ГЛАВЫ КЛАНА] "<text>"` with `channel: clan` and `style: announcement` (`#4ecfdc`).
- Per-clan `announcementCooldownUntil` in `clans.json`. Missing field = no cooldown. Transfer keeps the clan cooldown; delete drops it with the clan. New Leader may send only after that cooldown.

## Changed files

- `shared/clans.ts`, `shared/chat.ts`, `shared/protocol.ts`
- `server/services/clan.ts`, `gameMenu.ts`, `gameMenuActions.ts`, `server/WorldInstance.ts`
- `src/ui/GameUI.ts`, `clanGui.ts`, `gameMenuGui.ts`, `src/style.css`, `src/chat/ChatLog.ts`, `src/core/Game.ts`, `src/dev/UiQaHarness.ts`
- `tests/server/clan-invites-announce.test.ts` (new), `clan.test.ts` (compat), `clan-roles-ranking.test.ts`, `clan-gui.test.ts`, `game-menu-gui.test.ts`
- `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/PLUGINS.md`, `docs/TESTING.md`

## Protocol / actions added

- `clan_action`: `reject_invitation`, `open_announce`, `set_announce_text`, `send_announcement` (+ optional `text`, max 128)
- `menu_action`: `clans_invitations`
- `clan` screen: `announce`
- `chat`: optional `style: "announcement"`

## Cooldown / persistence

- Field: `ClanRecord.announcementCooldownUntil` (epoch ms), file `plugin-data/clans/clans.json`.
- Parse: missing/invalid → no cooldown. Invitations/roles/members unchanged.
- Authoritative on the clan, not the browser. Reload/reconnect/restart keep it.

## Invitations

- Same `invitations` map + 24h TTL + Leader/Veteran `/clan add` / `invite_by_name`.
- Menu list is `openAccept({ allowInClan: true })`. `/clan accept` still refuses if already in a clan.

## Announcement chat

- `ClanRuntime.sendMessage(..., { channel: 'clan', style: 'announcement' })` through the existing chat packet. Recipients = current `memberIds` who are online. No offline history.

## Leader / Veteran / Member

- Leader: sees the announcement button, may send (subject to cooldown).
- Veteran: no button; `send_announcement` → `CLAN_OWNER_ONLY_ERROR`. May still invite/kick members.
- Member: no button; same reject. May accept/reject their own invites.
- After transfer, new Leader gains the button; old Leader (now Veteran) loses it.

## Tests

- `npm run typecheck` / `typecheck:client` / `typecheck:server` / `typecheck:sim` PASS
- `npm run check:boundaries` PASS
- Focused vitest 8 files / **90/90** PASS: `clan-invites-announce`, `clan-roles-ranking`, `clan`, `economy`, `game-menu`, `friends`, `clan-gui`, `game-menu-gui`
- `npm run build` PASS (`dist/assets/index-CNt0E0yE.css` 98.73 kB)

New/updated coverage includes: invite inbox, accept/reject, expired/full/other-clan, new invite chat text, Leader-only announcement, `MAX_CHAT_LENGTH` 128, 3h per-clan cooldown surviving reload, transfer permission change, GUI invitations + announce button visibility, ranking `icon_coin.png` (no 🪙).

## Architecture decisions

- No second invite/announcement store or chat renderer. Style is an extra class on the existing `.chat-line`.
- Announcement `text` is a typed `clan_action` field, not `name` (name is capped at 32).
- Menu invitations reuse the clan accept screen rather than a new GameMenu screen.

## Known issues

- Offline members do not receive announcements (no chat history).
- Second announcement during cooldown is rejected even after leadership transfer (cooldown is per clan).

## Live QA (Anarchy `ws://127.0.0.1:2567`, Vite 4173)

First pass used a **stale** `vite-node` process started before this commit, so invite chat still said «Используйте /clan accept…» and **Приглашения** did not list the invite. After restarting `npm run dev:server` on current HEAD:

**A — invitations.** Leader bot `Player-1ef8` created clan LiveQA and invited browser **Invitee**. Chat (recipient only): `Игрок Player-1ef8 пригласил вас в клан LiveQA. Примите приглашение в меню`. Кланы hub **Приглашения** listed LiveQA / Player-1ef8 / TTL `23 ч 56 мин` with **Принять** / **Отклонить**. Accept joined as Участник. **Объявление соклановцам** hidden. Overlay stayed; E/X close worked. No `/clan accept` workaround.

**B — announcement.** Leader `send_announcement` delivered `[ОБЪЯВЛЕНИЕ ОТ ГЛАВЫ КЛАНА] "Сегодня в 20:00 идём фармить данжи"` with `channel: clan`, `style: announcement` to online members. GUI: Invitee as Member — no button. After transfer, Invitee as Глава sees **Объявление соклановцам**. Screen: «Напишите объявление клану», input, **Отправить**.

**C — cooldown.** Immediate second send disabled. Label `Повторная отправка через 2 ч 43 мин` after a full server restart. `announcementCooldownUntil` present on `clan-3` in `clans.json`. Reopening the menu did not reset it. Veteran protocol send → `Это действие доступно только владельцу клана.`

**D — transfer.** Promote Invitee → veteran, `confirm_transfer_leader`. New Leader sees the button; old Leader (`Player-1ef8`) `canAnnounce=false`.

**E — ranking.** All four live modes. Money rows use `icon_coin.png` (gold coin image), amounts like `15 100` / `15 100` with spaces, no □. Clan list money uses existing `.mc-clan-coin` gold disc (not Unicode). Overlay stayed; X closed cleanly. Yellow highlight on own row.

**Regressions found:** none after server restart. Spawn PvP/environment death loop on a fresh survival Invitee made HUD-only clicks necessary (creative + Y=140 for the cooldown/rating pass). Chat has no offline history, so the announcement line is gone after reconnect (by design).

## Visual QA

- Invite chat + invitations list + accept: `/opt/cursor/artifacts/clan_invite_chat_and_accept.mp4`
- Leader button / cooldown / live rating coins: screenshots `leader_announce_button_visible.webp`, `announce_cooldown_send_disabled.webp`, `live_rating_players_money.webp`, `live_rating_clans_money.webp`

## Git

Branch `cursor/clan-roles-rating-d1a5`. Draft PR #96. Do not merge.
