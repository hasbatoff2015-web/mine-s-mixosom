# Anarchy-only map backup

## Goal

Prepare a separate backup that copies the live Anarchy map and leaves Survival and Peaceful running. Do not run it, connect to the VPS, or deploy.

## Result

`scripts/fc-backup-anarchy-map.sh` stops only `frontier-cubes-anarchy.service`, archives the map, and starts that unit again. The archive is a separate filename, so the full backup's retention does not delete it. PostgreSQL is not dumped. The script was tested locally with stand-in `systemctl`, worlds, and `/status`. It was not installed or run on the VPS.

## Implemented

- Read only `PORT`, `SERVER_MODE`, `WORLD`, and `WORLD_PATH` from the Anarchy env file. Refuse a mode, world id, or directory that is Survival or Peaceful.
- Remember `is-active` for Survival and Peaceful and fail the run if those strings change. Never stop or start those units.
- Check free space before the stop: three times the world size plus 64 MiB.
- Share `.fc-backup.lock` with `fc-backup.sh`, plus a second lock for this script.
- Copy `meta.json` and `world.json` byte for byte. Write an empty `players.json`. Copy claims, holograms, buyers without purchases, RTP portals, automines, mega-zombie config, the duel arena without stats, and world-event templates. Keep only primitive spawn, rtp, and world-events config keys.
- Write `manifest.json` with `postgres: not-included` and `players: empty`. Publish `frontier-cubes-anarchy-map-YYYY-MM-DD_HHMMSS.tar.gz` and a SHA-256 file only after `tar -tzf` and `sha256sum -c` succeed.
- On any exit, if this run stopped Anarchy, start it and require HTTP `/status` with `ready: true`, `mode: anarchy`, and `world: anarchy`. Delete only this run's temporary directory.

## Changed files

- `scripts/fc-backup-anarchy-map.sh`
- `tests/server/anarchy-map-backup.test.ts`
- `docs/BACKUPS.md`
- `docs/ARCHITECTURE.md`
- `docs/PROJECT_STATE.md`
- `docs/ROADMAP.md`

## Architecture decisions

The map is the filesystem snapshot. A PostgreSQL dump does not belong in it. Economy and account rows live in the database. Survival and Peaceful keep running, so a dump of a shared database would not be quiet and would include their rows. A dump of a separate Anarchy database would still contain accounts and balances. The script therefore never reads `FC_DATABASE_URL` and never calls `pg_dump`. The full `fc-backup.sh` remains the database path: it stops every running game unit and dumps each distinct URL. That path is not used here because it stops Survival and Peaceful.

Claim files are copied whole, including member ids, because those ids are the region ACL. Inventories, session tokens, and economy files are not copied. `map-review.json` records whether any claim has `flags.pvp === true` and whether the floored spawn is inside a claim. A missing arena flag warns and still publishes the archive; `clone-world-snapshot.mjs` will refuse that extract later.

`FC_KEEP` is accepted but does not delete archives. The filename does not match `fc-backup.sh`'s `frontier-cubes-YYYY-MM-DD_HHMMSS.tar.gz` filter.

## Tests

`npx vitest run tests/server/anarchy-map-backup.test.ts`: the archive contains the far chunk, the arena claim, and an empty player file; the session token, economy file, auction config, and database password are absent; Survival and Peaceful bytes and unit names stay out of stop/start. A failed export restarts Anarchy. An already stopped Anarchy is not started. A changed Survival state keeps the published archive and still restarts Anarchy. `bash -n`, `npx tsc --noEmit`, and `npm run build:server` passed.

## Visual QA

No client screen changed.

## Performance

Local fixtures only. The live Anarchy world was reported at 8.5 MB with 71 GB free. The script was not timed on the VPS.

## Audit follow-up

`verify` now requires `worlds/anarchy/world.json` and `worlds/anarchy/meta.json` after the checksum matches. A missing `claims.json`, an empty claim list, or no loaded claim with `flags.pvp: true` is written to stderr and `map-review.json`. The archive is still published.

Spawn PvP in that review follows `flagSetter` and `effectiveFlag` for `pvp`. Only a claim that stores `flags.pvp` as a boolean competes. Priority is truncated and clamped to `-1000000..1000000`, matching `clampClaimPriority`. The higher clamped priority wins. Equal priority keeps the earlier claim. A higher-priority claim that omits `pvp` does not override a lower one that sets it. No setter means the server default, `false`. A claim counts only when the server would load it: string `id`, `name`, and `owner`, `worldId` equal to `meta.worldId`, and an integer volume. A valid anchor replaces that volume with the iron, gold, or diamond box. Claim member ids stay in `claims.json` because they are the region ACL.

The clone script uses the same clamped explicit-flag rule for its spawn warning. It still measures the stored volume, not an anchor box.

## Known issues

The live claims, arena volume, and spawn were not read. The script warns instead of guessing. Member ids inside `claims.json` remain in the archive. The installed `/usr/local/sbin/fc-backup` is unchanged and may be older than git.

## Deferred

Install and run on the VPS from the Selectel console. Inspect `map-review.json` before cloning. Do not start DEV worlds from this change.

## Next work

The owner copies the script to `/usr/local/sbin/fc-backup-anarchy-map` and runs it. After `backup: success`, the archive can feed `clone-world-snapshot.mjs` on DEV. Full `fc-backup` stays the separate all-services operation.

## Git

Branch `cursor/dev-prod-map-clone-f343`. Not merged to `main`.
