# Ruby and Titanium code-generated pixel assets

## Goal

Create final Ruby and Titanium PNG assets from existing repository templates through code only. Preserve canvas, transparency, silhouettes, UV layout and pixel-art edges. The initial pass was asset-only; the later equipment integration extended the same generator with the required inventory armor icons.

Requested outputs:

- Ruby: 2 armor layers, ingot, sword, pickaxe, axe, shovel and hoe.
- Titanium: 2 armor layers, ore, ingot, sword, pickaxe, axe, shovel and hoe.
- Integration follow-up: helmet, chestplate, leggings and boots inventory icons for both tiers.

## Result

All 25 gameplay PNGs are generated and validated by one reproducible Pillow script; the nearest-neighbor contact sheet includes every output. Gameplay integration is documented separately in `2026-09-08_ruby-titanium-equipment.md`.

## Implemented

- Central Ruby palette: `#2E0B12`, `#5A1622`, `#9B2233`, `#BC3445`, `#D24A5A`, `#F3E6EA`.
- Central Titanium palette: `#0F1318`, `#232A32`, `#3B4652`, `#536272`, `#66798B`, `#C2CED9`.
- Titanium ore palette: `#2A3038`, `#4D5968`, `#7C8E9E`, `#D1D9E1`.
- Controlled remap normalizes luminance only across selected material pixels, then assigns one of the fixed material levels. It is not a hue shift.
- Transparent pixels and alpha values are copied from the normalized template. Item and block art is never resized.
- The supplied 640×320 Netherite layers were verified as exact 5× pixel replications. They are reduced to 128×64 with nearest-neighbor before Titanium recoloring.
- Tool handle colors are loaded from opaque `stick.png` pixels. Those source pixels remain unchanged; only the non-handle opaque region is remapped.
- Eight 32×32 armor inventory icons keep the Diamond item silhouettes/alpha and apply the same approved Ruby/Titanium palettes. They are independent item sprites, not model-layer atlases.
- Emerald Ore's grayscale pixels remain unchanged. Inclusion mask = opaque pixels whose maximum and minimum RGB channels differ by at least 12.
- `--check` recreates expected images in memory and validates every written output without modifying files.

## Template and output map

| Output | Size | Template |
|---|---:|---|
| `assets/minecraft/textures/models/armor/ruby_layer_1.png` | 128×64 | `diamond_layer_1.png` |
| `assets/minecraft/textures/models/armor/ruby_layer_2.png` | 128×64 | `diamond_layer_2.png` |
| `assets/minecraft/textures/models/armor/titanium_layer_1.png` | 128×64 | `netherite_layer_1.png` (640×320 exact 5×) |
| `assets/minecraft/textures/models/armor/titanium_layer_2.png` | 128×64 | `netherite_layer_2.png` (640×320 exact 5×) |
| `public/textures/item/ruby_{helmet,chestplate,leggings,boots}.png` | 32×32 each | matching Diamond item icon |
| `public/textures/item/titanium_{helmet,chestplate,leggings,boots}.png` | 32×32 each | matching Diamond item icon |
| `public/textures/item/ruby_ingot.png` | 32×32 | `iron_ingot.png` |
| `public/textures/item/titanium_ingot.png` | 32×32 | `iron_ingot.png` |
| `public/textures/item/ruby_{sword,pickaxe,axe,shovel,hoe}.png` | 32×32 each | matching `iron_*.png` |
| `public/textures/item/titanium_{sword,pickaxe,axe,shovel,hoe}.png` | 32×32 each | matching `iron_*.png` |
| `public/textures/block/titanium_ore.png` | 32×32 | `emerald_ore.png` |

## Changed files

- Generator: `scripts/generate-tier-assets.py`.
- Generated armor: `assets/minecraft/textures/models/armor/{ruby,titanium}_layer_{1,2}.png`.
- Generated items: `public/textures/item/{ruby,titanium}_{ingot,sword,pickaxe,axe,shovel,hoe,helmet,chestplate,leggings,boots}.png`.
- Generated block: `public/textures/block/titanium_ore.png`.
- QA preview: `docs/reports/2026-09-08_ruby-titanium-tier-assets-contact-sheet.png`.
- Docs: `PROJECT_STATE.md`, `ROADMAP.md`, `ARCHITECTURE.md`, `ASSET_AUDIT.md`, this report.

The untracked `assets/minecraft/textures/models/armor/netherite_layer_{1,2}.png` files were present before this task and were read only as Titanium templates.

## Architecture decisions

- Extend existing paths: armor layers stay beside current armor UV sheets; item/block outputs follow current `public/textures` runtime folders.
- One script owns palettes, selection rules, generation, validation and preview. No parallel renderer or importer was added.
- Use Iron tool shapes for both materials because the handles exactly share the `stick.png` palette, making the preserved region deterministic.
- Use normalized source luminance instead of raw fixed brightness thresholds, so both bright Diamond and dark Netherite source shading occupy the full requested palette.

## Tests

Command:

```text
python scripts/generate-tier-assets.py --check
```

Result: PASS, 25/25 gameplay assets.

Checked per output:

- exact expected dimensions;
- exact alpha sequence and silhouette versus normalized template;
- transparent background for armor/items and full opacity for the ore tile;
- every selected material pixel belongs to its declared palette;
- every unselected tool-handle or ore-stone pixel equals the template;
- written pixels equal freshly regenerated pixels.

## Visual QA

`docs/reports/2026-09-08_ruby-titanium-tier-assets-contact-sheet.png` was inspected at original resolution. Pixel sprites are displayed only with integer nearest-neighbor scaling over a checkerboard. Ruby reads as deep red metal with pale metallic highlights, not emissive art. Titanium reads as cold dark steel with stronger highlights, without blue glow. UV islands, silhouettes, transparent gaps, wooden handles and the ore stone matrix remain readable.

## Performance

Generation and validation remain offline tooling over 25 small PNGs. Runtime impact of consuming the assets is covered by the equipment integration report.

## Known issues

- Generated derivatives retain the unresolved publication/provenance requirements of the repository templates documented in `ASSET_AUDIT.md`.
- The generator requires Python 3 and Pillow.

## Deferred

- Boss/event Titanium sources remain a separate future scope.
- Publication licensing/provenance confirmation remains open.

## Next work

Run the manual gameplay checklist from `2026-09-08_ruby-titanium-equipment.md`; do not create a second item, armor or worldgen system.

## Git

Branch: `codex/ruby-titanium-assets`.

No commit or push was performed. Existing untracked Netherite templates were preserved.
