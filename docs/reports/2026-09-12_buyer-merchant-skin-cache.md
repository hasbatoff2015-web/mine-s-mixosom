# 2026-09-12 — Buyer merchant skin: runtime still showed the old PNG

## Goal

Diagnose why Buyer NPC still rendered the retired green-black merchant after `public/textures/player/skins/buyer_merchant.png` was replaced, then fix the actual load-chain cause without a second skin system.

## Result

The new PNG was already the file in `public`. The NPC was **not** falling back to `frontier_explorer`. Runtime `TextureLoader` requested a **stable unhashed URL**. Vite `define` of `__PLAYER_SKIN_CONTENT_HASHES__` did **not** appear in the DEV transform of `TextureAtlas.ts`, so `?v=` was empty in the browser even after the first cache-bust attempt. Hashes now come from virtual module `virtual:player-skin-content-hashes`, which Vite inlines in both DEV and build.

## Diagnosis

1. **Public PNG.** `public/textures/player/skins/buyer_merchant.png` exists, 64×64, indexed PNG (colorType 3), 1502 bytes, sha256 `69f4018a158b79b5ab6760b3a0609ff2e3cc080adb089ef885ffc0ad4796e850`. Git HEAD still had the old RGBA 2400-byte file `81a1c375498a9a33ad0f43cf8a1e7626d70b94f391058c64cfc9dad23e197f65` (black body ~`(8,13,12)`, green arms ~`(32,63,40)`). The working-tree file was **not** that old merchant. The PNG was **not** overwritten in this pass.
2. **Call sites.** One id: `BUYER_NPC_SKIN_ID = 'buyer_merchant'`. Descriptor `texturePath: 'player/skins/buyer_merchant'`. `BuyerNpcView` and `Game.syncBuyers` both use that id. No second PNG path.
3. **Fallback ruled out.** `frontier_explorer` has brown arms ~`(112,83,69)`, not green. Old merchant has green arms ~`(32,63,40)`. Silent `acquire()` fallback to explorer would not look like the retired merchant. `createPlayerAppearance` does not remap `buyer_merchant`. First `acquire('buyer_merchant')` is `PlayerVisual` constructor inside `Game.syncBuyers` (after `itemVisuals` exists); `BuyerNpcView` then `setAppearance` (cache HIT).
4. **Vite DEV transform (live `:4173`).** `GET /src/rendering/TextureAtlas.ts` still contained unbound `__PLAYER_SKIN_CONTENT_HASHES__` and **zero** `69f4018a158b79b5`. `playerSkinCacheQuery` therefore returned `''`. TextureLoader URL stayed `/textures/player/skins/buyer_merchant.png` with no query.
5. **HTTP bytes on that unhashed URL.** The same DEV server already returned the **new** PNG (1502 bytes, sha256 `69f4018a…`, `Cache-Control: no-cache`). So if the browser still showed green-black arms, it was serving **cached old bytes** for that stable URL (or a GitHub/preview build of committed HEAD, which still has `81a1c375…`). `MinecraftSkinRegistry` also keeps one decoded `THREE.Texture` per skin id until full reload.
6. **HMR.** Replacing the PNG during an open tab does not recreate `Game.playerSkins`. Full page reload is required unless the registry sees a new URL. Public PNG change now triggers Vite `full-reload` plus hash module invalidation.

## Implemented

- `vite.config.ts` plugin serves `virtual:player-skin-content-hashes` from current `public/textures/player/skins/*.png` (replaces the DEV-broken `define` global).
- `TextureAtlas.url` appends `?v=<16 hex>` only for keys starting with `player/skins/`. Block/item/entity URLs unchanged.
- `MinecraftSkinRegistry` stores the load URL; if it changes, reloads image into the same `THREE.Texture`. DEV-only console: skinId, path, URL, cache HIT/MISS/RELOAD, image size/src, sha256 of fetched bytes.
- Tests: reject retired sha256; virtual module hash matches file; `acquire('buyer_merchant')` calls `TextureLoader` with hashed merchant URL and does not resolve to `frontier_explorer`.
- `Game.tryInteractBuyer` uses `this.ui?.isHologramEditorOpen()` like `tryInteractHologram`.

Not changed: Buyer System, PlayerAppearance, PlayerVisual architecture, skin id `buyer_merchant`, player skin PNGs, PNG bytes of the current merchant.

## Changed files

- `vite.config.ts`
- `src/rendering/TextureAtlas.ts`
- `src/rendering/player/MinecraftSkin.ts`
- `src/core/Game.ts` (`tryInteractBuyer` optional `ui`)
- `tests/player-skin-texture-url.test.ts`
- `tests/player-skin-assets.test.mjs`
- `tests/player-skin-selector.test.ts`
- `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`
- `docs/reports/2026-09-12_buyer-merchant-skin-cache.md`

`public/textures/player/skins/buyer_merchant.png` is the already-replaced new asset; this pass did not write it.

## Architecture decisions

- Cache-bust at the existing URL helper, not a Buyer-only path and not hashed filenames (Yandex/static `public/` copy stays `textures/player/skins/<id>.png`).
- Virtual module instead of Vite `define`: DEV transform did not replace the global, so query never reached TextureLoader in the browser.
- Same query for all player skins so a later PNG swap cannot stick in HTTP cache; ordinary selector thumbs (`GameUI.paintSkinThumbs`) already call `TextureAtlas.url`.
- Do not glob-import `public/` as `?url`: Vite would emit `/public/textures/...` in dev, which is the wrong path.
- DEV skin logs are gated on `import.meta.env.DEV` plus `http(s)` `location`; production stays quiet.

## Tests

- `tests/player-skin-texture-url.test.ts` 8/8: virtual module hash matches current public PNG; TextureLoader for `buyer_merchant` gets `...?v=69f4018a158b79b5`; acquire does not resolve to `frontier_explorer`.
- `tests/player-skin-assets.test.mjs` 3/3 including retired-hash guard.
- `tests/player-skin-selector.test.ts` 8/8.
- Four typechecks PASS. `test:server` **45 files / 470 tests PASS**. `check:boundaries` PASS. `build` PASS.

Fresh Vite DEV (`:4175`) serves PNG sha256 `69f4018a…` and inlines `"player/skins/buyer_merchant":"69f4018a158b79b5"` from `virtual:player-skin-content-hashes`. Production `dist` PNG matches public. Bundle uses `` textures/${key}.png${query} `` without leftover `__PLAYER_SKIN_CONTENT_HASHES__`.

## Visual QA

Not re-run in a live Anarchy session in this pass. Proof that runtime *requests* the new PNG: virtual module + `TextureAtlas.url` include `?v=` of the current public sha256, `MinecraftSkinRegistry` `TextureLoader.load` uses that URL, and the built `dist` PNG matches public.

After this change a hard reload is required so the browser does not keep a previously cached unhashed PNG / decoded texture. DEV console should show `sha256=69f4018a…` on buyer acquire.

## Performance

47 short hex strings imported once via the virtual module. One extra query parameter on skin image requests. DEV-only extra `fetch` of the same PNG for sha256 logging.

## Known issues / Deferred

- Git HEAD still has the old PNG until the working-tree replacement is committed by the owner. A preview of committed HEAD will still look like the green-black merchant.
- In-session HMR without full reload can keep a decoded texture until the registry sees a new URL or the page reloads.

## Next work

Owner: restart Vite if it was started before this plugin, hard-reload Anarchy, confirm console `[player-skin] buyer_merchant` URL has `?v=69f4018a158b79b5` and sha256 matches the new file.

## Git

No commit/push in this pass (explicit owner request).
