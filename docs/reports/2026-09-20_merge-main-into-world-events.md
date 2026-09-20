# 2026-09-20 — Sync origin/main into world-events

## Goal

Bring `cursor/world-events-event-chest-525a` onto current `origin/main` without dropping either side.

## Result

Semantic merge (no rebase, no `--ours/--theirs`). World-events overlay, scheduler, protection, and reconnect fix kept. Latest main clan/nameplate/minecart/network code kept.

## Conflicts

- `server/gameplay.ts`: kept `isExplosionProtected` from feature and `ridingCartId` occupancy comment from main.
- Docs (`ARCHITECTURE`, `PROJECT_STATE`, `ROADMAP`, `TESTING`): stacked both histories; plugin bullets use main economy/clan/base text plus `/wand` and world-events.
- Clan base overlap now also checks the virtual event claim (`ClanRuntime.extraClaims`).

## Tests

World-events / claims / clan-base / mesh / generation / anarchy after this commit.
