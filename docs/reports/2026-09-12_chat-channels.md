# 2026-09-12 — Chat channels (Global / Nearby / Clan)

## Goal

Переработать существующий чат Frontier Cubes: крупнее UI, три канала, server-authoritative routing, без второй системы чата и без копии clan membership.

## Result

Существующие `ChatLog`, `GameUI` `#chat`, `ClientChatMessage` / `ServerChatMessage` и `WorldInstance.handleChat` расширены. Clan membership по-прежнему только `ClanService.playerClan`.

## Implemented

- **T** открывает чат, фокус в поле, вкладка «Общий». После отправки чат остаётся открытым, выбранный канал не сбрасывается. Повторное **T** после закрытия снова выбирает «Общий».
- **Enter** отправляет, очищает поле, оставляет чат открытым. Пустая строка не отправляется и не закрывает чат.
- **Tab** и **X** закрывают чат, отбрасывают draft, возвращают управление / pointer lock.
- Кнопка с пузырьком чата включает/выключает **отображение** входящих. История не стирается, отправка работает.
- Каналы: `global` | `nearby` | `clan`. Клиент шлёт только intent. Сервер игнорирует forged sender/recipients/coords/clanId.
- Nearby: 3D `distance <= 20`, inclusive, позиция `controller.position`. Отправитель всегда получает сообщение.
- Clan: live `ClanService.playerClan`. Без клана — «Вы не состоите в клане.», ввод на вкладке Клан недоступен.
- General показывает полученные global + nearby + clan без дубля одного `messageId`. Nearby — жёлтая полоска, Clan — фиолетовая. Формат `player: text`.
- Лимит 128 символов: parse + `handleChat` reject. История с подключения, ~40 на вкладку, store cap 200. Persist между рестартами нет.

## Changed files

- `shared/config.ts`, `shared/chat.ts`, `shared/protocol.ts`
- `server/AnarchyServer.ts`, `server/WorldInstance.ts`, `server/services/clan.ts`
- `src/chat/ChatLog.ts`, `src/chat/chatView.ts`, `src/chat/index.ts`
- `src/ui/GameUI.ts`, `src/style.css`, `src/core/Game.ts`
- `tests/chat-channels.test.ts`, `tests/server/chat-channels.test.ts`, `tests/server/chat-scroll.test.ts`
- `docs/PROJECT_STATE.md`, `docs/ARCHITECTURE.md`, `docs/TESTING.md`, `docs/ROADMAP.md`, `docs/PLUGINS.md`

## Architecture decisions

- Один network event на получателя; вкладки — клиентские фильтры, не второй packet.
- Nearby считается на сервере. Clan не кэшируется в chat: каждый send читает `ClanService`.
- Closed clan snapshot теперь несёт `viewer`, чтобы UI чата видел membership без открытия кланового дома. После clan action flush уходит затронутым членам.
- Display toggle — CSS `#chat.display-off`, не отдельный log.

## Tests

- `tests/chat-channels.test.ts` 6/6
- `tests/chat-commands.test.ts` 10/10
- `tests/server/chat-channels.test.ts` 8/8
- `tests/server/chat-scroll.test.ts` 3/3
- `tests/ui-main-integration.test.ts` 5/5
- `tests/server/clan-plugin.test.ts` 7/7
- `test:server` **46 files / 478 tests PASS**
- typecheck / typecheck:client / typecheck:server / typecheck:sim PASS
- `check:boundaries` PASS
- `npm run build` PASS
- Full `npm test`: 230/231 files, 2198/2203 PASS. 5 failures are known 5s timeouts in `tests/fire-contact-sunlight-minecart.test.ts` (pre-existing, not chat).

## Visual QA

Не прогонялся в браузере в этом проходе. Нужно вручную: T/Enter/Tab/X, вкладки, полоски, hide/show, clan empty, pointer lock.

## Performance

DOM log по-прежнему bounded (200 store / 40 на вкладку). Nearby — линейный проход `connectedPlayers()`.

## Known issues

- Display toggle доступен, пока чат открыт (T). В закрытом состоянии скрытый log просто не рисует fade.
- Клиентский `playerInClan` — производное от welcome / clan `viewer` / входящих clan lines, не второй store.

## Deferred

Live browser QA чата в Anarchy.

## Next work

Ручная проверка в браузере на desktop и landscape mobile.

## Git

Ветка `cursor/chat-channels-a8dc`. Commit/push по просьбе пользователя не делались.
