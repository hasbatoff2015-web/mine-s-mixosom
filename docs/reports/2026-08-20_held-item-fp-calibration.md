# First-person held-item transform calibration

Дата: 2026-08-20  
Ветка: `cursor/minecraft-item-pipeline-rework-935a`

## Goal

По Java screenshots тех же sword/pickaxe textures увеличить и сместить shared first-person sprite pose вправо/вниз, убрать residual pitch/yaw, добавить dev QA knobs. `GeneratedItemGeometry` не менять.

## Result

Idle parent chain не даёт pitch/yaw. Новый shared pose: **final** Three.js scale `0.85` (не `0.68 * 0.85`), position `[0.50, -0.56, -0.82]`, Euler `[0, 0, 14]°`. Это временный calibration baseline, не утверждённое art-значение. Query `held*` подменяет idle transform 1:1 (`?heldScale=0.578` ≈ старый ×1.6). `npm run check` green.

## Changed files

- `src/items/itemRenderProfiles.ts`
- `src/rendering/heldItemQa.ts` (new)
- `src/rendering/FirstPersonRenderer.ts`
- `src/dev/ItemQaHarness.ts`
- `tests/item-rendering.test.ts`
- `docs/PROJECT_STATE.md`
- `docs/ARCHITECTURE.md`
- `docs/ROADMAP.md`
- `docs/TESTING.md`
- `docs/reports/2026-08-20_held-item-fp-calibration.md`

Не менялся: `src/rendering/GeneratedItemGeometry.ts`.

## Tests

21 files / 132 tests. Typecheck, Vite 73 modules, 0.93 MiB / 165 files.

## Scale architecture

`heldScale` / `FIRST_PERSON_SPRITE_POSE.scale` is **B**: the FINAL uniform Three.js scale written to the item root via `object.scale.set(s, s, s)`. It is **not** a project multiplier on vanilla `0.68`.

- previous final scale = `0.68 * 0.52 = 0.3536`
- current default final scale = `0.85` (temporary calibration baseline, not an approved art value)
- local ×1.6 check without code change: `?heldScale=0.578` (`0.68 * 0.85`)

`itemHolder` and `root` stay at identity scale, so the item-root value is the on-screen uniform scale (idle, ignoring equip/eat/swing).

## Git

Commit `feat: add held item transform calibration` on `cursor/minecraft-item-pipeline-rework-935a`. No merge to `main`.
