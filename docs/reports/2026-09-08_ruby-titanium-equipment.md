# Ruby / Titanium equipment integration

## Goal

Полностью встроить два endgame tier выше Diamond через существующие item, crafting, furnace, mining, worldgen, armor rendering, Creative и authoritative networking paths:

```text
diamond -> ruby -> titanium
```

Ruby должен быть дорогим crafted resource sink без собственной руды. Titanium должен быть редким exploration/final tier: ore -> smelting -> matching Ruby equipment upgrade. Protocol shape, PvP cooldowns, movement prediction, mining networking и armor penetration менять нельзя.

## Result

Интеграция завершена без параллельных registries/renderers/network payloads. Зарегистрированы 2 resources, 18 equipment items и block item Titanium Ore. Добавлены Ruby crafting, Titanium upgrades/smelting/worldgen, два mining ranks, точный armor/tool balance, RU/EN names, eight inventory armor icons и Ruby/Titanium layers в существующем `PlayerArmorVisual`.

`BlockId.TitaniumOre = 161`; ни один старый numeric BlockId не сдвинут. Network protocol не менялся: сервер по-прежнему выводит equipment из authoritative inventory и передаёт точные string item IDs.

## Exact balance

### Armor

Flat protection остаётся `4% × armor point`, максимум 20. Toughness penetration не добавлялась.

| Material | Helmet | Chestplate | Leggings | Boots | Total | Full-set reduction |
|---|---:|---:|---:|---:|---:|---:|
| Leather | 1 | 3 | 2 | 1 | 7 | 28% |
| Gold | 2 | 5 | 3 | 1 | 11 | 44% |
| Iron | 2 | 6 | 5 | 2 | 15 | 60% |
| Diamond | 3 | 7 | 5 | 2 | 17 | 68% |
| Ruby | 3 | 7 | 5 | 3 | 18 | 72% |
| Titanium | 3 | 8 | 6 | 3 | 20 | 80% |

| Material | Helmet durability | Chestplate | Leggings | Boots |
|---|---:|---:|---:|---:|
| Ruby | 500 | 720 | 675 | 585 |
| Titanium | 650 | 940 | 880 | 760 |

Armor durability values зарегистрированы, но новая damage-to-armor mechanic намеренно не добавлялась.

### Tools and weapons

| Tier | Durability | Mining speed | Damage bonus | Sword | Pickaxe | Axe | Shovel | Hoe |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Diamond baseline | 1561 | 8 | +3 | 8 | 6 | 7 | 5 | 4 |
| Ruby | 2100 | 10 | +4 | 9 | 7 | 8 | 6 | 5 |
| Titanium | 2800 | 12 | +5 | 10 | 8 | 9 | 7 | 6 |

Последние четыре damage columns используют прежние base-tool formula; sword остаётся отдельным существующим weapon formula `5 + bonus`. Attack cooldown/swing/PvP mechanics не менялись.

## Exact recipes

- Ruby Ingot: shapeless 3×3, exactly `diamond ×1 + gold_ingot ×3 + iron_ingot ×3 -> ruby_ingot ×1`. Matcher generic раскладывает `Ingredient.count` в units и корректно принимает как stacked, так и seven-cell input. Ruby Ingot не имеет ore/smelting recipe.
- Ruby helmet/chestplate/leggings/boots and sword/pickaxe/axe/shovel/hoe: девять обычных existing vanilla-shaped recipes из Ruby Ingots; axe и hoe сохраняют mirrored matching.
- Titanium: девять shapeless 2-slot recipes `matching ruby_<piece> + titanium_ingot ×1 -> matching titanium_<piece> ×1`. Diamond-to-Titanium и direct Titanium ingot patterns не существуют. Полный loadout требует 9 Titanium Ingots.
- Furnace: `titanium_ore ×1 -> titanium_ingot ×1`, `cookingTimeTicks = 200`.

## Titanium Ore and mining

- Stable numeric ID: `161`.
- Key/item ID: `titanium_ore`; category `ore`; hardness `5`; tool `pickaxe`; required tier `ruby`.
- Exact ordinary ore drop: min/max 1 Titanium Ore, `requiresCorrectTool=true`, Silk Touch item remains the ore block through the generic ore helper.
- Canonical ranks: `hand 0, wood 1, stone 2, iron 3, gold 1, diamond 4, ruby 5, titanium 6`.
- Diamond pickaxe progresses visually through the normal mining-speed path but gets no correct-tool drop. Ruby and Titanium pickaxes get the drop. Titanium also harvests existing Diamond-tier requirements.

## World generation

Titanium is appended after Coal/Iron/Gold/Redstone/Diamond:

```text
Y 4..12
veins = 1
size = 3
spawnChance = 0.75 per chunk
```

`spawnChance` is optional and calls `rng()` only when present, so no existing ore rule consumes a new random number. A pre-change fixed-seed old-ore position digest remains exact:

```text
seed: ruby-titanium-compat-v1
sample: cx/cz -3..3 (49 chunks)
old ore SHA-256: 7221e1756de7ad877a94cbe647bb6668fbe38abbfed99d32152f1795fb258e77
Diamond: 198
Titanium: 76
Diamond / Titanium: 2.6052631579
observed Titanium Y: 4..12
max Titanium blocks in one sampled chunk: 3
```

Нет scan/backfill migration: уже загруженный `Chunk` не перегенерируется и не получает Titanium. Ограничение persistence для старых миров описано в Known issues.

## Rendering, Creative and networking

- `PlayerArmorVisual` расширен материалами `ruby`/`titanium`; helmet/chest/boots используют layer 1, leggings — layer 2 через существующий slot resolver.
- UV geometry, shell meshes, body pivots, animation ownership and caches не менялись. Mixed sets, local third-person and remote players идут тем же path.
- Invisibility по-прежнему скрывает body/skin, оставляя armor and held item. First person не создаёт armor meshes или helmet overlay.
- Все новые items имеют обычные texture paths and names. Ingots/Ore stack to 64; equipment stack to 1. `obtainableItems()` автоматически включает их в Creative.
- `playerEquipmentFromInventory() -> snapshot.equipment -> RemotePlayerView -> PlayerVisual.setArmor()` остаётся authoritative generic string-ID pipeline. Клиент не присылает armor material; protocol bump не нужен.

## Asset paths

- Model layers: `assets/minecraft/textures/models/armor/{ruby,titanium}_layer_{1,2}.png`.
- Resources/tools: `public/textures/item/{ruby,titanium}_{ingot,sword,pickaxe,axe,shovel,hoe}.png`.
- Inventory armor icons: `public/textures/item/{ruby,titanium}_{helmet,chestplate,leggings,boots}.png`.
- Ore: `public/textures/block/titanium_ore.png`.
- Generator: `scripts/generate-tier-assets.py`.
- QA sheet: `docs/reports/2026-09-08_ruby-titanium-tier-assets-contact-sheet.png`.

The two supplied `assets/minecraft/textures/models/armor/netherite_layer_{1,2}.png` inputs predated this integration and remain unmodified/untracked user files.

## Changed files

### Gameplay and presentation

- `src/items/types.ts`, `src/items/registry.ts`
- `src/blocks/types.ts`, `src/blocks/registry.ts`, `src/blocks/mining.ts`
- `src/crafting/recipes.ts`
- `src/world/Generator.ts`, `src/world/worldgenMetrics.ts`
- `src/rendering/player/PlayerArmorVisual.ts`
- `src/i18n/ru.ts`, `src/i18n/en.ts`, `src/i18n/displayNames.ts`, `src/i18n/index.ts`

### Tests

- Added `tests/ruby-titanium-equipment.test.ts`.
- Updated `tests/armor-hud.test.ts`, `tests/block-registry.test.ts`, `tests/combat.test.ts`, `tests/lava-bedrock-ore-pass.test.ts`, `tests/player-armor-network.test.ts`, `tests/player-armor-visual.test.ts`.

### Assets/tooling/docs

- Updated `scripts/generate-tier-assets.py` and its contact sheet for 25 assets.
- Added 4 armor layers, 20 item sprites and 1 ore sprite listed above.
- Updated `docs/ARCHITECTURE.md`, `docs/ASSET_AUDIT.md`, `docs/PROJECT_STATE.md`, `docs/ROADMAP.md` and `docs/reports/2026-09-08_ruby-titanium-tier-assets.md`; added this report.

## Architecture decisions

- Extend the canonical registries and data-driven recipe loops. Titanium is deliberately represented by a separate upgrade list so a direct material recipe cannot appear accidentally.
- Keep one exported numeric harvest rank map; no lexical tier comparison or item-ID special case.
- Use optional `spawnChance` and append Titanium last to preserve old RNG consumption.
- Keep armor visual material selection derived from registered server-owned item IDs. No material field is accepted from network input.
- Add independent inventory icons through the existing deterministic pixel generator; never use an armor UV atlas as a GUI icon.
- Do not introduce armor wear, penetration, bosses, events, set bonuses, magic effects or protocol claims.

## Tests

### Feature/regression

- Focused integration pack (7 files): **103/103 PASS**.
- Final `tests/ruby-titanium-equipment.test.ts`: **11/11 PASS** after Creative and seven-cell shapeless assertions.
- Covered: every ID/kind/tier/material/stat/stack; six armor totals and flat reductions; mixed armor; all Ruby and Titanium recipes and rejections; furnace; canonical mining ranks/drop; deterministic abundance/Y/vein cap/old-ore digest; texture mapping/mixed/invisibility/first-person; authoritative equipment equip/unequip/mixed/death/respawn.
- Asset generator `--check`: **25/25 PASS**.

### Required commands

- `npm run typecheck`: PASS.
- `npm run typecheck:client`: PASS.
- `npm run typecheck:server`: PASS.
- `npm run typecheck:sim`: PASS.
- `npm run check:boundaries`: PASS.
- `npm run build`: PASS, 249 modules; existing `/sdk.js` and large-chunk warnings only.
- `npm run check:size`: PASS, 4.10 MiB / 351 files.
- `npm run check:archive`: PASS, 4.10 MiB / 351 files.

### Full repository suite

`npm run test -- --maxWorkers=2`: **1853/1869 tests PASS; 187/191 files PASS**. The non-green classes match the already documented baseline on this host and are outside this diff:

- 15 existing 5-second CPU timeouts across `worldgen-terrain` and `fire-contact-sunlight-minecart`;
- existing `server/tick-load-flight` max-latency assertion failed all retries (`105.8–126.1 ms` vs `<80 ms`);
- existing Vitest parse failure in `minecraft-reference-extractor.test.mjs`;
- one worker `onTaskUpdate` RPC timeout after the long run.

No unrelated timeout, performance threshold or test skip was changed. All changed/added Ruby/Titanium suites pass.

## Visual QA

The 25-asset contact sheet was inspected at original resolution with integer nearest-neighbor scaling. Ruby and Titanium item silhouettes are crisp, armor icons are distinct from layer atlases, tool handles retain the source wood pixels, armor UV islands preserve their alpha/silhouette, and Titanium Ore retains the grayscale stone matrix.

Automated renderer tests confirm layer resolution, mixed materials, stable cached meshes, third-person/invisibility behavior and no first-person armor. Live gameplay/F5/two-client visual QA was not performed in this turn.

## Manual QA checklist

The following remains intentionally unchecked for owner review:

### Craft

- [ ] Ruby Ingot from 1 Diamond + 3 Gold + 3 Iron.
- [ ] Ruby armor and all Ruby tools.
- [ ] All matching Titanium upgrades; verify direct patterns fail.

### Mining and furnace

- [ ] Find Titanium Ore in a newly explored Y 4–12 chunk.
- [ ] Diamond pickaxe breaks visually but gives no drop.
- [ ] Ruby pickaxe drops the ore; smelt it in 200 ticks.
- [ ] Titanium pickaxe works on Titanium and existing Diamond-tier blocks.

### Combat

- [ ] Compare Diamond/Ruby/Titanium protection.
- [ ] Ruby Sword and Titanium Sword hit values/cooldown feel.
- [ ] Two-player PvP has no obvious one/two-shot regression.

### Visual/network lifecycle

- [ ] Ruby full set, Titanium full set and mixed set in F5.
- [ ] Remote client: walk, sprint, crouch, jump, swing and bow while equipped.
- [ ] Invisibility leaves armor/held item visible.
- [ ] Equip/unequip, death/reset and respawn update the remote client.

### World compatibility

- [ ] New chunks contain Titanium within Y 4–12.
- [ ] Already loaded chunks do not change during the session.
- [ ] Review the persisted-unmodified-chunk limitation before promising cross-restart identity for pre-update worlds.

## Performance

Runtime additions are bounded: one optional RNG gate and at most one size-3 Titanium vein attempt per newly generated chunk; no per-frame scans, meshes or network fields. Armor reuses shared textures/materials/geometries and does not rebuild per snapshot. Production bundle remains 4.10 MiB, well below platform limits.

## Known issues

- Strict cross-restart preservation of every pre-update visited chunk is impossible with the current schema: it persists the seed plus modification deltas, not a complete manifest/version for unchanged visited procedural chunks. Such a chunk is indistinguishable from an unexplored chunk after restart and can regenerate with the new Titanium rule. No speculative migration/backfill was added. Loaded chunks remain unchanged, and old Coal/Iron/Gold/Redstone/Diamond positions remain deterministic.
- Manual live gameplay and two-client QA are still open.
- Generated derivatives retain the source/provenance licensing requirements tracked in `docs/ASSET_AUDIT.md`.
- The full suite retains the unrelated baseline timeout/parser/RPC failures listed above.

## Deferred

- Boss/event Titanium sources, event chests and event loot.
- Enchantments/NBT migration, armor wear mechanics, penetration/heavy attacks, set bonuses, magic/movement effects and first-person armor.
- Any save-schema generation manifest/version design requires a separate compatibility task.

## Next work

Run the manual checklist, with particular attention to a real two-client authoritative equipment lifecycle and an old-world/new-chunk exploration session. Separately decide whether a future save schema must persist generated chunk provenance before another worldgen change.

## Git

- Branch: `codex/ruby-titanium-assets`.
- Base/current HEAD before uncommitted work: `90c69f1fb3a38f033a6d63389fc105593e530e8a` (same as audited `origin/main`).
- No commit, push, merge or protocol bump was performed.
