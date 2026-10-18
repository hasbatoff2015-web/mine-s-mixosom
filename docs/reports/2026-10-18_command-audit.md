# Command, rank, and chat audit — 2026-10-18

## Donate

`enderchest.use` starts at VIP. PREMIUM still adds announce and nick color. The menu expiry line is `До 15 ноября · осталось 27 дней 4 часа` from `expiresAt`, refreshed while the donate screen is open. Clan creation uses one server price: 10000 МК, or 5000 МК for VIP, PREMIUM, BOSS, and TITAN. OP without a donate rank still pays 10000.

## Spectator

`/gamemode spectator` and `/gamemode 2` are the same mode and require OP. The controller sets `noclip` and creative flight, so movement does not collide. Break, place, use, attack, and item pickup are rejected on the server. Other players receive `invisible` on the snapshot, so the model and nameplate stay hidden. Switching back to survival clears noclip.

## /tpa

`/tpa <ник>` teleports the OP to that player immediately. The target gets no chat line. `/tpahere` is the OP pull and tells the moved player they were moved. `/tpaccept` and `/tpdeny` no longer teleport; they say the command is unused. `/tp <x> <y> <z>` is unchanged: TITAN one success per 24 hours, OP unlimited.

## /eco

`/balance`, `/pay`, `/baltop`, and `/transactions` stay player commands. `/eco` and every subcommand (`give`, `take`, `set`, `reset`, `balance`, `transactions`) require OP.

## Access

| Command | Role |
| --- | --- |
| `/gamemode`, `/gm` | OP |
| `/tpa`, `/tpahere` | OP |
| `/tpaccept`, `/tpdeny` | anyone, no effect |
| `/eco` | OP |
| `/op`, `/deop`, `/permissions`, `/plugins` | OP or admin node |
| `/give`, `/time`, `/spawnpet`, `/predsim` | still any player; left as they were |
| `/tp` | TITAN or OP |
| `/ec` | VIP+ or OP |
| `/an`, `/nickcolor` | PREMIUM+ or OP |
| `/invsee` | TITAN or OP, read-only |
| `/invseeop` | OP |
| `/ranktest` | OP and `FC_RANK_TEST` |
| `/back` | everyone; death quota for BOSS and TITAN |
| `/home`, `/sethome`, `/delhome`, `/homes`, `/spawn`, `/rtp`, `/claim`, `/kit`, `/clan`, `/friends`, `/trade`, `/ah`, `/duel`, `/menu`, `/balance`, `/pay` | players, with their existing nodes |
| `/automine`, `/wand`, `/events`, `/holograms`, `/buyer` admin, `/rtpportal` | staff nodes, not donate ranks |

Donate ranks still do not receive `server.*` or `plugins.manage`.

## Chat

Permission denials use `shared/playerText.ts` (`Недостаточно прав для выполнения этой команды.`). Claim break and place use the same module. The default language is Russian. A second language can replace that module without searching call sites. Not every older plugin string was moved; the player-visible denials were.

## Tests

`tsc --noEmit` passed. Client and server builds passed. `npm run test:server` still has the four failures that already fail on `origin/main`: God Sword, two pet hit tests, bow FIFO. New donate, tpa, claim, buyer, and gamemode cases passed.

## Git

Branch `cursor/donation-ranks-fb58`. Not merged. Production was not deployed.
