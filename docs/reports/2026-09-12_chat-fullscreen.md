# 2026-09-12 — Chat fullscreen and transparent log

## Goal

Открытый чат на всю ширину экрана, кнопки у правого края, прозрачный фон лога, красный X. Без изменений серверной маршрутизации каналов.

## Result

`#chat.open` растягивается `left: 0` + `right: 0` внутри HUD. Input занимает оставшуюся ширину. `#chat-log` / `#chat.open #chat-log` — `background: transparent`. Close glyph `.chat-close-x` — `#ff3b3b`. Закрытый чат остаётся `width: fit-content` в top-left.

## Implemented

- Убран `--chat-open-width` / `min(70vw, 72rem)` / compact `40rem` cap.
- `#chat.open { right: 0; width: auto; max-width: none; overflow-x: hidden; }`.
- `#chat-form` / `#chat-input` `width: 100%`; `#chat.open #chat-side { margin-left: auto; }`.
- Message area `background: transparent`; line chips без изменений.
- Красный X, белый TAB; behaviour Tab/X без изменений.

## Changed files

- `src/style.css`, `src/ui/GameUI.ts`
- `tests/chat-layout.test.ts`
- `docs/PROJECT_STATE.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, `docs/TESTING.md`

## Architecture decisions

Серверные каналы, `messageId`, ClanService, 128-char limit, scroll/wheel/touch не трогались. Full-width считается относительно `#hud` (`inset: 0` внутри `#ui-root` с safe-area padding) — это существующая UI-система, а не второй overlay.

## Tests

```text
npx vitest run tests/chat-layout.test.ts tests/chat-channels.test.ts tests/chat-commands.test.ts tests/server/chat-channels.test.ts tests/server/chat-scroll.test.ts tests/ui-main-integration.test.ts --maxWorkers=2
```

Focused: chat-layout 10/10, chat-channels 6/6, chat-commands 10/10, server chat-channels 8/8, chat-scroll 3/3, ui-main-integration 5/5.

- `npm run test:server` — 46 files / 478 tests PASS
- four typechecks — PASS
- `npm run check:boundaries` — PASS
- `npm run build` — PASS
- `npm test` — 5 FAIL only in known `tests/fire-contact-sunlight-minecart.test.ts` 5s timeouts (1 file / 5 tests / 1 vitest-worker Timeout calling onTaskUpdate). Unrelated to chat. 231 files / 2208 tests PASS.

## Deferred

Live browser QA на 1920×1080 / 1280×720 / mobile landscape.

## Git

Ветка `cursor/chat-channels-a8dc`. Не merge в main.
