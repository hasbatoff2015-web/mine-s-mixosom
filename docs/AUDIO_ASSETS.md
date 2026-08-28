# Audio assets

Frontier Cubes core SFX pack. Gameplay talks to `SoundEventId` / `AudioManager.play` / `playAt` / `playBlock`. Filenames stay in this catalog.

## Production pack

| Event / use | File(s) | Group | Volume | Pitch | Positional | Source / license |
| --- | --- | --- | --- | --- | --- | --- |
| `block.hit.stone` / break / place / step | `stone_1.mp3`, `stone_2.mp3` | stone | hit 0.32, break 0.72, place 0.48, step 0.16 | hit 0.92–1.02, break 0.96–1.08, place 0.90–1.04, step 0.94–1.06 | yes | Original procedural Frontier Cubes synthesis (`scripts/generate-core-sfx.mjs`). All rights: this project. **Not** Minecraft audio. |
| `block.*.wood` | `wood_1.mp3`, `wood_2.mp3` | wood | same family | same family | yes | same |
| `block.*.dirt` | `dirt_1.mp3`, `dirt_2.mp3` | dirt | same family | same family | yes | same |
| `block.*.sand` | `sand_1.mp3`, `sand_2.mp3` | sand | same family | same family | yes | same |
| `block.*.wool` | `wool_1.mp3`, `wool_2.mp3` | wool | same family | same family | yes | same |
| `block.*.glass` / `glass.break` | `glass_1.mp3` | glass | same family | same family | yes | same |
| `explosion` | `explosion.mp3` | — | 1.0 | 0.94–1.06 | yes, max 48 | same |
| `bow.shoot` | `bow_shoot.mp3` | — | 0.55 | 0.96–1.06 | no (player-local) | same |
| `arrow.hit` | `arrow_hit.mp3` | — | 0.55 | 0.94–1.08 | yes | same |
| `combat.hit` | `combat_hit.mp3` | — | 0.62 | 0.94–1.08 | yes | same |
| `player.hurt` | `player_hurt.mp3` | — | 0.70 | 0.94–1.06 | no | same |
| `item.pickup` | `item_pickup.mp3` | — | 0.40 | 0.96–1.08 | no | same |
| `food.eat` | `food_eat.mp3` | — | 0.45 | 0.94–1.08 | no | same |
| `potion.drink` | `potion_drink.mp3` | — | 0.50 | 0.96–1.05 | no | same |
| `door.open` / `door.close` | `door_open.mp3` / `door_close.mp3` | — | 0.55 | 0.96–1.04 | yes | same |
| `chest.open` / `chest.close` | `chest_open.mp3` / `chest_close.mp3` | — | 0.55 | 0.96–1.04 | yes | same |
| `redstone.click` | `click.mp3` | — | 0.40 | 0.92–1.08 (ON higher / OFF lower) | yes | same |
| `fire.ignite` | `fire_ignite.mp3` | — | 0.50 | 0.94–1.08 | yes | same |
| `water.splash` | `water_splash.mp3` | — | 0.50 | 0.94–1.08 | yes | same |

Runtime files live in `public/audio/sfx/`. Format: short **mono** MP3, 22.05 kHz, 48 kbps. Total pack ≈ 0.11 MiB. Generator writes a 1-channel WAV then `ffmpeg -ac 1`. Audited 2026-08-28: all 26 files are `mp3, 1 channel, mono` (`ffprobe`). The rear-footstep bug was spatial routing (PannerNode at the block under the camera), not stereo assets.

Catalog `block.*.step` stays positional (`yes` above) for world/mob callers. The **player** footstep caller passes `{ positional: false }` so first-person steps are centered.

Regenerate (deterministic seed):

```bash
npm run audio:generate-sfx
```

## Material groups

`BlockDefinition.soundGroup` is data-driven (`src/blocks/soundGroups.ts`). One family is reused for hit (quiet, slightly lower pitch), break (full), place (quieter), and step (much quieter). Gameplay must not switch on `BlockId` to pick a filename.

Silent: Air, Water, Lava.

## Minecraft Java 1.8 — local reference only

Original Minecraft sounds are **not** production assets. Do not commit, push, or ship them.

On a Windows machine with Minecraft Java installed, extract a comparison set with one command:

```bash
npm run audio:extract-reference
```

The script (`scripts/extract-minecraft-reference-sounds.mjs`):

1. Finds `%APPDATA%\.minecraft\assets` (also Linux/macOS defaults, or `--assets`).
2. Selects a 1.8 asset index (`1.8.json`, else the newest `1.8.x.json`).
3. Resolves logical keys through that index’s SHA-1 object map (hashes are not stored in the repo).
4. Copies friendly `.ogg` names into `.local/minecraft-reference-audio/` (gitignored).

Cloud/Linux agents without a Minecraft install cannot run this step; that is expected. The AudioManager architecture does not depend on those files.

## Not in this pass

Music, cave ambients, weather, unique mob voices, extra footstep files.
