# 2026-09-12 — Chat layout and controls

## Goal

Доработать существующий chat UI: top-left, фиксированная высота лога, более крупные controls, скрытый native scrollbar. Без изменений серверной маршрутизации каналов.

## Result

`#chat` закреплён в левом верхнем углу. Открытый message area имеет фиксированную `--chat-open-log-height`. Кнопки ENTER / TAB / CHAT ON|OFF крупные и подписаны. Scrollbar скрыт, wheel и touch pan-y сохранены.

## Implemented

- `top`/`left` + `bottom: auto`; closed log content-sized, open log fixed height.
- `#chat-log-inner` `flex-start`: мало сообщений оставляет пустое место снизу, chrome не съезжает.
- Side column: ENTER (submit), X+TAB (close), speech bubble + CHAT ON/OFF.
- `scrollbar-width: none` + `::-webkit-scrollbar { display: none }`; `overflow-y: auto`; `touch-action: pan-y`.
- Width/height через `vw`/`vh`/`rem`/`--hud-scale`, compact override для коротких/узких экранов.

## Changed files

- `src/ui/GameUI.ts`, `src/style.css`, `src/chat/chatView.ts`
- `tests/chat-layout.test.ts`, `tests/chat-channels.test.ts`
- `docs/PROJECT_STATE.md`, `docs/ARCHITECTURE.md`, `docs/TESTING.md`, `docs/ROADMAP.md`

## Architecture decisions

Серверные каналы, `messageId`, ClanService и 128-char limit не трогались. Layout — CSS + разметка существующего `#chat`.

## Tests

```text
npx vitest run tests/chat-layout.test.ts tests/chat-channels.test.ts tests/chat-commands.test.ts tests/server/chat-channels.test.ts tests/server/chat-scroll.test.ts tests/ui-main-integration.test.ts --maxWorkers=2
```

Focused: chat-layout 8/8, chat-channels 6/6, chat-commands 10/10, server chat-channels 8/8, chat-scroll 3/3, ui-main-integration 5/5.

- `npm run test:server` — 46 files / 478 tests PASS
- four typechecks — PASS
- `npm run check:boundaries` — PASS
- `npm run build` — PASS
- `npm test` — 5 FAIL only in known `tests/fire-contact-sunlight-minecart.test.ts` 5s timeouts (1 file / 5 tests / 1 vitest-worker Timeout calling onTaskUpdate). Unrelated to chat. 231 files / 2202 tests PASS.

## Visual QA

Live browser QA на 1920×1080 / 1280×720 / mobile landscape не запускалась в этой среде (нет GUI browser tools). Layout проверен CSS/DOM-контрактами и существующими chat tests.

## Performance

Без изменений meshing / tick / server routing.

## Known issues

Полный `npm test` падает только на известных 5s timeout minecart-тестов.

## Deferred

Live visual QA на desktop/mobile landscape.

## Next work

Не начинать следующие задачи в этом проходе.

## Git

Ветка `cursor/chat-channels-a8dc`. Не merge в main.
