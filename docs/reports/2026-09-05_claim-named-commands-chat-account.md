# Named /claim commands, chat open scroll, account nick input

## Goal

Small UX/bugfix pass on PR #53: name a claim in `/claim` subcommands, open chat at the latest messages, and allow typing a custom Account nickname.

## Result

Done. No new claims/chat/nickname systems.

## Implemented

- Explicit `/claim flag <name> <flag> <true|false>`, `/claim addmember <name> <player>`, `/claim removemember <name> <player>`, `/claim members <name>`. `info`, `priority`, `delete` already took `<name>`.
- Standing syntax kept: `/claim flag <flag> <true|false>`, `/claim addmember <player>`, `/claim members`.
- Parser: if the first token is a known flag and the next is a boolean, that is the standing form (even if a claim is named `pvp`).
- Named commands do not require the player to stand in the claim. Edit rights: owner / `claim.admin` / OP.
- `openChat` reveals faded lines, pins to bottom, then microtask + double `requestAnimationFrame` so layout can catch up.
- Account nickname: `InputManager` only blurs leftover `#chat-input`. Menu inputs keep focus. Field is `type="text"` `autocomplete="off"`.

## Changed files

- `server/services/claimCommands.ts`, `server/builtin-plugins/claims.ts`
- `src/input/gameplayKeys.ts`, `src/input/InputManager.ts`
- `src/chat/chatScroll.ts`, `src/ui/GameUI.ts`, `src/style.css`
- tests: `claim-commands`, `anarchy-plugins`, `chat-scroll`, `console-and-nickname`, `player-nickname`, `network-input-recovery`, `ui-main-integration`

## Tests

Named flag/member parser, owner edits spawn from outside, stranger denied, standing `/claim flag mob-spawn false` still works, chat open pins to bottom, custom nick save/load.

## Known issues

A claim named `pvp` is edited with `/claim flag pvp pvp true`. `/claim flag pvp true` remains “set pvp on the claim under your feet”.
