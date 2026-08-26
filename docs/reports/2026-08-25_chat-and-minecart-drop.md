# Chat commands and minecart drop polish

Date: 2026-08-25  
Branch: `cursor/fluids-and-items-pass-935a`  
Draft PR: https://github.com/hasbatoff2015-web/mine-s-mixosom/pull/6  
Base: `main`  
**main was not merged.** **No force push.** Code is frozen pending local visual QA.

Previous HEAD: `76f1f500130b61bda05e49b2e798285d8657c91b`.  
This pass: `047760ede5916d8ea6b8febcc405e6832cd83cfd`.

## Goal

Finish Survival minecart LMB drops via the canonical item-drop path, and add a local Minecraft-like chat with a first command set.

## Already done before the disconnect

Worktree already had (uncommitted):

- `src/chat/` registry (`parseChatLine`, `dispatchChatLine`, `ChatLog`, death messages)
- `GameUI` bottom-left chat HUD, T/`/` in `InputManager`, Esc closes chat instead of pause
- `Game` command context: gamemode, time, give, tp, seed, clear, kill
- `dropsForBrokenMinecart` + Survival-only spawn through `DroppedItemManager`
- Overlay blocking (chat like inventory) so world tick continues

## Finished after restore

- Kill/give result cleanup; unused `resetChatInput` removed
- Esc while the chat field is focused no longer opens pause (typing owns Escape; `stopPropagation`)
- Up/Down history: Down is a no-op until Up has started browsing
- Tests: `tests/chat-commands.test.ts` + Creative vs Survival loot helper + history/Esc helpers
- Docs (`PROJECT_STATE`, `ARCHITECTURE`, `ROADMAP`, `TESTING`, this report)

## Chat controls

- **T** — open chat
- **/** — open chat with `/`
- **Enter** — send
- **Esc** — close (does not pause while chat is open)
- **Up/Down** — typed-line history
- Closed: recent lines fade after 8 s + 2 s fade
- Open: history stays fully visible; input at the bottom

## Commands

`/help`, `/gamemode survival|creative|s|c|0|1`, `/time day|noon|night|midnight`, `/give <item> [count]`, `/tp <x> <y> <z>`, `/seed`, `/clear`, `/kill`

Unknown commands and usage errors print in chat. Free text is shown locally as `<Player> …`. Death uses `deathMessage(source)` (lava, TNT, fall, …).

## Minecart drop

- Survival LMB: entity removed, world `ItemDrop` Minecart; unprimed TNT cart also drops TNT
- Creative: entity removed, no drop
- Ridden cart ignored
- Primed TNT cart not broken/defused
- Pickup through existing `DroppedItemManager`

## Tests / Git

```text
tsc --noEmit: PASS
Vitest:       53 files, 495 tests, 495 passed
production:   116 modules, 1.15 MiB / 180 files
Main JS: 934.02 kB / 259.29 kB gzip; CSS: 27.02 kB / 6.28 kB gzip
```

WebGL/browser screenshot replay was **not** available in this environment.

Commit: `047760ede5916d8ea6b8febcc405e6832cd83cfd` (`feat: local chat commands and survival minecart item drops`).
