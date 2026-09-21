# 2026-09-21 — Multi-server runtime smoke

## Goal

Runtime-check three live processes (Anarchy :2567, Survival :2568, Peaceful :2569) on `cursor/multi-server-modes-2f64`. Do not merge PR #101.

## Result

The three servers run together without sharing a port, world directory, plugin-data directory, or `.instance.lock`. PvP, explosion, world isolation, restart persistence, and the client `?server=` URLs match the mode rules.

One shutdown bug was fixed: a process-group Ctrl+C delivered `SIGHUP` after `SIGINT` and killed the process before `stop()` removed `.instance.lock`. `SIGINT`, `SIGTERM`, and `SIGHUP` now share one shutdown. After that fix, a group interrupt saves the world, logs `stopped`, and deletes the lock while the other two servers stay up.

## Runtime

- Processes: `npm run dev:server:anarchy`, `dev:server:survival`, `dev:server:peaceful`.
- `/status`: each `ready: true`, `online: 0` when idle, `tickRate: 20`, world/mode `anarchy` / `survival` / `peaceful`.
- PvP via protocol: Anarchy 20→12, Survival 19→12, Peaceful stayed 20 after the players had settled.
- TNT: primed on all three (cell became air). Dirt neighbor became air only on Anarchy.
- Isolation: stone / cobblestone / oak planks placed at the same coordinates stayed in their own world. Breaking the shared dirt on Survival did not change Anarchy or Peaceful.
- Restart: Peaceful stop left Anarchy and Survival ready. Peaceful `world.json` reloaded the marker, dirt, and primed-TNT air cell. `claims`, `balances`, `placed-blocks`, and `permissions` hashes stayed the same. Anarchy and Survival `world.json` hashes did not change.
- Lock: a second Anarchy on port 2570 with `WORLD=anarchy` threw `already owned by pid …` and never listened. A direct `SIGINT` and, after the fix, a process-group `SIGINT` both removed the lock.

## Client

Headless Chrome on `http://127.0.0.1:4173/?server=anarchy|survival|peaceful` used **Играть онлайн → Подключиться** and opened `ws://127.0.0.1:2567`, `:2568`, and `:2569`.

## Tests

- `npm run typecheck` — pass
- `npm run check:boundaries` — pass
- `npm run build` — pass
- `npm run test:server` — 654 passed, 5 failed (same five as `origin/main`)

## Known

`npm run test:server` still has the five failures that also fail on `origin/main` (plugin listener counts and AutoMine reset). They are not from the mode work.

A process-group interrupt can still print a libuv assertion after `[server] stopped`, once the terminal is already gone. The lock file is removed before that.
