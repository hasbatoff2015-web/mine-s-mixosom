# Online session transition input fix

Date: 2026-08-29  
Branch: `cursor/online-session-transition-input-fix-bbb1`  
Base: `0723c6e` (`cursor/online-respawn-input-fix-bbb1`, draft PR **#19**)  
**Not merged to main.** `origin/main` remains `a056e6f`.

## Goal

After Anarchy → Singleplayer → Anarchy, WASD must work on the second Anarchy join the same as a fresh Online join. Do not regress PR #19 death→respawn. Do not change GameplayKernel, fluids, interpolation, or client authority.

## Exact Root Cause

What survives between Singleplayer and Online is **`sessionStorage` `fc.anarchy.sessionToken`** plus the **in-memory server player** (5-minute disconnect grace).

`InputManager` is a Game singleton (listeners once). `tickOnline` runs after `enterPlaying` (`PLAYING`). New `AnarchyClient` + new `PlayerController` are created each `startSession`. Those were not the broken objects.

The broken state is **input sequence ownership**:

1. First Anarchy: client `inputSeq` 1, 2, … N. Server `lastInputSeq = N`.
2. Exit: WebSocket closes; server keeps the player, previously **keeping `lastInputSeq = N`**. Token stays in `sessionStorage`.
3. Singleplayer is a separate local session (IndexedDB). Token is untouched.
4. Re-enter Anarchy: `join` with the same token **resumes** player id X. New client starts `inputSeq = 0` and sends 1, 2, 3…
5. `applyInput` rejects `seq < lastInputSeq`. Every WASD packet is dropped. Look is client-render. Chat is not seq-gated.

Same bug for Anarchy → menu → Anarchy (no SP required). SP in the middle only made the path obvious.

## Fresh vs Re-entry

| State | Fresh Online | Re-entry Online (before fix) |
|---|---|---|
| lifecycle after load | PLAYING | PLAYING |
| tickOnline | yes | yes (packets left the client) |
| InputManager | same singleton | same singleton |
| AnarchyClient | new | new |
| player id | new | **resumed X** |
| client inputSeq | 0 → 1 | 0 → 1 |
| server lastInputSeq | -1 | **stale N** |
| applyInput(seq=1) | accept | **reject stale** |
| mouse look | works | works |
| chat | works | works |
| WASD | works | **broken from join** |

First differing state: **server `lastInputSeq`**, not BACKGROUND and not missing `tickOnline`.

## Input Fix

Not `clearHeldKeys()` on enter. Client still starts seq at 0 each session. Server **resets `lastInputSeq` and lastInput** on disconnect and on resume join (`resetConnectionInput`). Seq 1 is valid again. Movement stays server-authoritative.

`enterPlaying` still forces PLAYING (`lifecycleAfterWorldSessionEnter`) and clears the respawn blur guard so leftover BACKGROUND cannot survive a world enter.

## Session Fix

- `AnarchyClient.disconnect` bumps generation, nulls handlers, closes the socket.
- Socket listeners ignore events from a previous generation.
- `Game` message/disconnect callbacks no-op unless `session.online.client ===` that client.
- Only one live client per Game session; `startSession` still `disposeSession()` first.

## TickOnline

It did **not** stop on this regression. Packets were sent and ignored. After the fix the server accepts them. PLAYING enter is unchanged besides the explicit PLAYING helper.

## Tests

- Fresh seq 0 vs reconnect reset; Anarchy→menu→Anarchy; SP→Anarchy; Anarchy→SP→Anarchy; multiple cycles; chat/pointer-lock/tab after enter; client identity; no duplicate client; PR #19 respawn contract.
- Server: resume after seq 40 accepts seq 1 and moves; three disconnect/resume cycles; death then resume still walks (PR #19 + this pass).

## Regression

GameplayKernel, interpolation, fluids, block states, rendering, bow/arrow, SP tick, and PR #19 `respawnIfDead` health flush / BACKGROUND blur rules were not modified.

Targeted pack: session-transition + respawn + anarchy **92/92**. Full `npm run check`: **1102 passed / 7 failed** (authored ENOENT + minecart 5s timeouts, same pre-existing class) + 1 vitest RPC. `tsc` clean. Production build/size PASS **3.63 MiB / 221 files**.

## Visual QA / Performance

No browser QA in this pass. No render/mesh change.

## Deferred

Phase 2 `useHeld`. Owner local QA of transitions.

## Git

- Branch: `cursor/online-session-transition-input-fix-bbb1`
- Base: PR #19 `cursor/online-respawn-input-fix-bbb1` @ `0723c6e`
- Do not merge `origin/main`
