# Merge Codex main-menu UI with PR #6

## Goal

Synchronize `cursor/fluids-and-items-pass-935a` with current `origin/main` (Codex menu redesign) without losing PR #6 gameplay/HUD, then merge the combined branch into `main`.

## Result

Ordinary merge of `origin/main` (`03b2e63`) into the feature branch. Two content conflicts, both resolved by combining both sides. Full `npm run check` green. No rebase, no force push, no new features.

## Conflicts

| File | Resolution |
| --- | --- |
| `src/ui/GameUI.ts` | Keep Codex menu/navigation (`menuModel`, Esc-to-back, redesigned screens) **and** Cursor chat handlers, armor/heart/potion HUD imports. Controls screen uses Codex layout; bindings now include chat `T` and `/`. |
| `docs/PROJECT_STATE.md` | Date 2026-08-26; Codex menu description + Cursor HUD (hearts/armor/potions). |

Auto-merged without conflict: `src/core/Game.ts`, `src/style.css`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, `docs/TESTING.md`.

## Combined state

- Codex: main menu, singleplayer, online mock, settings, controls, `frontier-menu-background.png`
- Cursor PR #6: fluids, lava, fire, potions/HUD, armor/hearts HUD, hurt flash, spawn, ores, rails/minecart, targeting, chat, lighting

## Tests

Targeted 12 files / 89 tests PASS. Full check: **61 files, 551 tests**, 123 modules, **3.44 MiB / 187 files** (menu background ~2.3 MiB).
