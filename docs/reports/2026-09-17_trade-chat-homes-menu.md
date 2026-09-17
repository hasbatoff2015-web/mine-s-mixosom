# Trade coins, chat chrome, homes 3, menu coin

## Goal

Five targeted UX/limit changes on the existing feature branch without rewriting Trade/Friends/Homes/Chat server mechanics:

1. Each trader sees both coin offers (self + partner) from the server snapshot.
2. Open chat message area has no panel background.
3. Open-chat Enter / close / Chat ON-OFF match graphite hover/pressed chrome.
4. Ordinary players may create at most 3 homes; commands and UI share one limit.
5. Main Menu coin icon is fully visible and aligned with «Баланс».

## Result

Done. Server still owns trade money, ready-reset, double Accept, atomic swap, and home creation. Client/GUI only displays the extra partner amount and restyles chat/menu chrome.

## Implemented

- `ServerTradeMessage` adds `partnerMoney` / `partnerMoneyText`. `buildTradeMessage` copies `session.offers[partnerId].money`.
- Trade window: self `Монет:` input under the left board; read-only `Монет: N` under the partner board.
- `#chat.open #chat-log` is transparent (no gradient panel). `.chat-line` chips stay for readability.
- Chat control buttons keep IDs/hotkeys and gain `--mc-btn-hover` / `--mc-btn-pressed` / inset highlight.
- `HOME_MAX_DEFAULT = 3` is the ordinary-player cap used by plugin config, `WorldInstance.maxHomesFor`, `/sethome`, menu create, and GUI fallback `Мои дома (n/3)`.
- `.mc-menu-coin` uses `object-fit: contain` in a 12 logical-px box, vertically centered with the balance label.

## Changed files

- `shared/protocol.ts`, `shared/homes.ts`
- `server/services/gameMenu.ts`, `server/builtin-plugins/home.ts`, `server/WorldInstance.ts`
- `src/ui/tradeGui.ts`, `src/ui/gameMenuGui.ts`, `src/style.css`
- `tests/trade-gui.test.ts`, `tests/chat-layout.test.ts`, `tests/game-menu-gui.test.ts`
- `tests/server/homes.test.ts`, `tests/server/game-menu.test.ts`, `tests/server/anarchy-plugins.test.ts`
- `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/PLUGINS.md`

## Architecture decisions

- Partner money is a snapshot field, not a second money protocol. The client cannot set the partner amount; `set_money` still validates against the sender's live balance.
- Home VIP/premium caps stay `HOME_MAX_VIP` / `HOME_MAX_PREMIUM`. Only the ordinary default moved from 4 to 3.
- Chat line chips (`rgba(0,0,0,0.5)` + text-shadow) remain so text stays readable over the world. Closed chat layout is unchanged.

## Tests

- Trade GUI: both captions, self input, partner `data-trade-partner-money`.
- Game menu integration: Ada 40 / Bob 70 appear as `money` + `partnerMoney` on both snapshots; Ready resets after `set_money`.
- Homes: `HOME_MAX_DEFAULT === 3`; 4th home rejected in `HomeService`, menu, and `/sethome`.
- Chat layout: open log `background: transparent`; control hover/pressed tokens.
- Menu coin: `object-fit: contain`, balance copy still `Баланс: 100 монет`.

## Visual QA

DEV fixtures `?qaUi=menu-root|menu-homes|trade-session|chat-open` (real `GameUI`, no world tick):

- Main Menu coin is a full round disc next to unchanged `Баланс: 5 645 монет` on desktop 1280×720 and landscape 844×390.
- Open chat: message chips over the world, no log-area gradient panel; Enter / X / CHAT ON are graphite beveled buttons.
- Trade session: `Монет:` input 100 on the left and `Монет: 500` on the right.
- Homes: `Мои дома (2/3):`.

## Performance

No tick/mesh/network rate changes. Extra trade snapshot fields are two numbers.

## Known issues

Persisted plugin config `maxHomesDefault` from an older world still overrides the code default if an admin (or a previous `loadConfig` write) stored 4.

## Deferred

No live two-client trade session in this pass. VIP/premium home caps unchanged.

## Next work

If a shipped world still has `maxHomesDefault: 4` on disk, decide whether to migrate that key or leave it as an admin override.

## Git

Branch `cursor/ui-redesign-a8dc`. No merge to `main`.
