# 2026-09-06 — Armor overlay, crouch hierarchy, air swing, multiplayer hurt flash

## Goal

Show worn armor as a separate visual shell on the player rig; keep the upper body connected while crouching; play a hand swing on every attack click including air misses; replicate the existing singleplayer red hurt flash to Anarchy remotes through authoritative presentation.

## Result

Implemented on `cursor/armor-crouch-swing-flash-3f93` from `main` after PR #63. No second player model, animator, protocol, or flash system. `PROTOCOL_VERSION` stays 3; `presentation.armor` and `presentation.hurtSeq` are additive optional fields.

## Implemented

1. **Crouch hierarchy.** `PlayerVisual` now parents head/body/arms (and therefore held item + armor) under `upperBody`. Sneak pitch/offset applies to that waist pivot. Legs stay on `bodyYawRoot`. Idle/walk/attack/mining/bow/food poses are unchanged in `PlayerVisualAnimator`.
2. **Armor overlay.** `PlayerArmorOverlay` inflates cuboids on head / torso+arms / legs / boots and parents them to the same pivots. Runtime pack has item icons only (`public/textures/item/{leather,iron,gold,diamond}_{helmet,chestplate,leggings,boots}.png`); no `models/armor/*_layer_*.png` sheets. Equipment ids come from `Inventory.armor` locally and from `presentation.armor` for remotes.
3. **Air swing.** Each discrete `consumeAttackPresses()` click sends `{ type: 'attack' }` while online. `ServerGameplay.attack()` already called `presentSwing()` before raycasts, including misses. Hold-mining still does not emit a swing per frame.
4. **Hurt flash.** `SurvivalSystem.addDamageListener` → `ServerPlayer.presentHurt()` on `fullHurt`. `hurtSeq` is join-baselined like `swingSeq`. `RemotePlayerView` calls `PlayerVisual.triggerHurtFlash()`, which reuses `hurtFlashAlpha` from `HurtFeedback` (220 ms). Local HUD/camera flash is unchanged.

## Changed files

- `shared/playerPresentation.ts` — `armor`, `hurtSeq`, helpers
- `server/WorldInstance.ts` — publish armor ids / hurtSeq; `presentHurt`
- `src/survival/SurvivalSystem.ts` — damage listeners
- `src/rendering/player/PlayerVisual.ts` — `upperBody`, `setArmor`, `triggerHurtFlash`
- `src/rendering/player/playerArmor.ts` — overlay meshes
- `src/rendering/hurtFeedback.ts` — shared `hurtFlashAlpha`
- `src/net/RemotePlayerView.ts` — apply armor + hurtSeq
- `src/core/Game.ts` — always send attack on press; sync local armor
- Tests: `player-visual-animation`, `remote-action-presentation`, `server/remote-presentation`

## Architecture decisions

- Armor is a child of the existing rig, not a second player mesh or texture swap on skin.
- Missing armor UV sheets are not invented; item PNGs are mapped onto inflated boxes with material tints.
- Hurt is an event counter, not a streamed boolean, so two fullHurts still flash even if coalesced visually like swing.
- I-frame chips (`fullHurt: false`) do not increment `hurtSeq`.
- Equipment is not a continuous action: stale 1500 ms timeout does not strip armor (same as held item, which is applied on snapshot, not on the stale-idle action frame).

## Tests

- `typecheck` / `typecheck:client` / `typecheck:server` / `typecheck:sim` PASS
- `check:boundaries` PASS
- Directed 35/35: `player-visual-animation`, `player-skins`, `remote-action-presentation`, `remote-player-view`, `server/remote-presentation`, `fire-overlay-hurt`
- `test:sim` 42/42 PASS
- `test:server` 231/232 — the only failure is pre-existing `tick-load-flight` wall-clock (`setView` max 118–157 ms vs `< 80` on this VM). Not weakened.
- `build` PASS (1.26 MB main chunk)

## Visual QA

Automated hierarchy/parenting and overlay attach/detach. Live two-client Anarchy armor/crouch/air-swing/flash checklist remains owner QA (SwiftShader ~4 FPS in this environment).

## Performance

Bounded overlays: at most a handful of extra cuboids per visible player. Texture cache per visual instance, 16 armor icons max. No extra network messages; fields ride existing `player_state`.

## Known issues

- Armor uses item-icon faces, not vanilla armor UV unwrap, because those sheets are not in `public/textures`.
- Coalesced `hurtSeq` 0→2 still shows one flash (same contract as `swingSeq`).

## Deferred

- First-person helmet overlay
- Importing `models/armor/*_layer_*.png` if the pack later ships them
- Owner two-client visual acceptance

## Next work

Owner live QA both directions (A↔B): armor on/off, crouch+walk+attack, air swing, damage flash.

## Git

Branch `cursor/armor-crouch-swing-flash-3f93` from `main` @ `bb203ae` (PR #63).
