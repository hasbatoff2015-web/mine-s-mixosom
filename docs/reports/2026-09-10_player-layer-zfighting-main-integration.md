# Player layer z-fighting integration into current main

Date: 2026-09-10

Feature branch: `codex/fix-player-layer-zfighting`

## Goal

Integrate the accepted player skin layer z-fighting and translucent ordering fixes into the current main while preserving the complete modern gameplay/network/plugin line and published history.

## Inputs

- `origin/main`: `4de89948b08b61ea3db6a7a73103855c2a483de6`
- `origin/codex/fix-player-layer-zfighting`: `f1ed162fcd58ad17fc9b54c765bc02b35ab76e83`
- merge-base: `9eaec6ba16c0b2d15d63f1c541b99f46f7711007`
- divergence before merge: 21 main-only commits, 2 feature-only commits
- skin commits: `14ac1ab183b36bcd037fc8d7d944e71aa0f960ea`, `f1ed162fcd58ad17fc9b54c765bc02b35ab76e83`

## Result

Main was merged into the feature as `72bf906` (`merge: sync player layer rendering with main`). The integrated tree retains the feature's runtime alpha metadata, deterministic six-part render ranks and small independent depth bias while keeping main's bow/melee PvP timelines, action sequencing, AutoMine, holograms, online polish, appearance sync, nameplates, armor and tests.

## Conflicts

| File | Feature content | Main content | Resolution |
|---|---|---|---|
| `docs/ARCHITECTURE.md` | deterministic skin material/order/depth policy | bow/melee timeline and current-main architecture | Kept both sections and documented the combined ownership/queue policy. |
| `docs/PROJECT_STATE.md` | accepted skin fix state and QA | bow integration and modern main handoffs | Kept both histories and added this integration as the newest state. |
| `docs/ROADMAP.md` | completed skin fix checklist | current main feature checklists | Kept every checklist and added the completed integration gate. |
| `docs/TESTING.md` | alpha/skin/armor/browser evidence | bow/melee/plugin/hologram test contracts | Kept both test histories and recorded the combined validation. |

There were no code conflicts. `PlayerVisual.ts` auto-merged; its combined result was audited and tested rather than accepted solely because Git reported no conflict.

## Renderer invariants

- Base skin: `transparent=false`, `alphaTest=0.01`, depth test/write enabled.
- Binary outer: opaque cutout; translucent outer is enabled only from `SkinTextureHandle.outerLayerAlpha` returned by the actual registry descriptor.
- Classic and Slim: unique ranks for all six parts; base `0..5`, outer `10..15`.
- Seam depth bias is independent from rank: body/head 0, right limbs -1, left limbs -2.
- Armor stays opaque/depth-writing with base `20..22`, leather overlay `30..32` and its existing polygon-offset policy.
- Three.js opaque and transparent queues are not described as one global numeric order; armor occludes translucent outer via geometry and depth.
- Skin UVs, 64×64 atlas semantics, arm widths, inflate, pivots, animation and PNG files are unchanged.
- Invisibility hides base/outer skin while armor and held items remain visible.
- Production `PlayerSkinGeometry.ts`, `FirstPersonRenderer.ts` and `PlayerArmorVisual.ts` are unchanged from source main.

## Validation

- Production alpha scanner: 45/45 skins PASS.
- Focused skin/armor/appearance/preview: 13 files, 75/75 tests PASS.
- Current-main bow/melee/network/plugin/AutoMine/hologram/online gate: 30 files, 314/314 tests PASS.
- Shared simulation: 12 files, 65/65 tests PASS.
- `typecheck`, `typecheck:sim`, `typecheck:client`, `typecheck:server`: PASS.
- Import boundaries: PASS.
- Production build: PASS with established `/sdk.js` and chunk-size warnings.
- Size/archive: PASS, 4.14 MiB / 353 files.
- Conflict-marker scan and `git diff --check`: PASS.
- Full suite: 212/216 files, 2024/2040 tests PASS; one worker RPC timeout.

## Baseline comparison

The exact source main previously produced 212/216 files and 2016/2033 tests passing, with 17 failures. The integrated tree adds seven passing feature tests and has 16 failures in the same four files:

- unchanged `minecraft-reference-extractor.test.mjs` parse failure;
- two existing `worldgen-terrain.test.ts` 5-second timeouts;
- 13 load-sensitive `fire-contact-sunlight-minecart.test.ts` 5-second timeouts;
- unchanged `server/tick-load-flight.test.ts` `<80 ms` threshold miss, with this run sampling 118–128 ms.

None of these files is changed by the feature. No timeout, performance threshold or assertion was weakened.

## Manual QA

The user already accepted the live skin fix. No new browser QA is claimed for this integration: conflicts were documentation-only, `PlayerVisual` auto-merged without a text conflict, and production geometry/first-person/armor paths remained byte-identical to source main. Automated renderer and composition tests cover the merged code.

## Performance

The change adds no per-frame allocation loop or new renderer system. Materials are created per deterministic depth-bias class, retained across appearance changes and disposed with `PlayerVisual`; texture handles retain their existing acquire/release lifecycle.

## Known risks

- The pre-existing full-suite parser/CPU-timeout/performance baseline remains red as listed above.
- Cross-GPU/WebGL driver behavior can only be completely covered by continued live observation, although the user-accepted visual QA and deterministic tests cover the known regression.

## Git

- Feature sync merge: `72bf906`.
- The commit containing this report becomes the final feature tip before the race check.
- Final main merge and remote SHA are recorded in the delivery response after the required last-minute fetch checks.
- No rebase, reset-hard, amend, force push or history rewrite is used.
