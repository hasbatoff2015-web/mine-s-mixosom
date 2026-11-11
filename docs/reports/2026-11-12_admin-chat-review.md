# Просмотр личной переписки

## Goal

Команда `/chat <ник1> <ник2>` для OP: открыть сохранённую личную переписку двух игроков, не создавая чат и не меняя историю.

## Result

Сервер резолвит оба ника в id, читает один файл диалога и открывает отдельное окно. Обычный игрок команду не выполняет. Окно не отправляет сообщения.

## Implemented

- Команда `/chat` с `permission: 'operator'`. Отказ: «Недостаточно прав для выполнения этой команды.»
- Оба игрока должны существовать и отличаться. Офлайн из `storedPlayers` подходит. Неизвестный и неоднозначный ник отклоняются до чтения файла.
- `DirectMessageService.inspect` возвращает сохранённые сообщения по `seq`. Дружба не требуется. Файл не создаётся и не переписывается, `lastReadSeq` не меняется.
- Экран `dm-review`: заголовок `Личная переписка: A ↔ B`, ник, текст и локальные дата со временем, прокрутка к концу, закрытие. Пустая пара: «Между этими игроками нет личной переписки.» Поля ввода нет.

## Changed files

- `server/WorldInstance.ts`, `server/services/directMessages.ts`, `server/services/gameMenu.ts`, `server/services/gameMenuActions.ts`
- `shared/directMessages.ts`, `shared/gameMenu.ts`, `shared/protocol.ts`
- `src/ui/GameUI.ts`, `src/ui/gameMenuGui.ts`, `src/ui/containerTheme.ts`, `src/style.css`
- `tests/server/direct-messages.test.ts`, `tests/dm-review-ui.test.ts`

## Architecture decisions

Второе хранилище не добавлялось. Ключ файла по-прежнему hex от двух player id, не от ника. Клиент не выбирает пару: снимок кладёт только серверная команда.

## Tests

`npx vitest run tests/server/direct-messages.test.ts tests/dm-review-ui.test.ts`

Плюс `tsc --noEmit`, `npm run check:boundaries`, `npm run build:server`.

## Visual QA

Окно использует ту же панель меню, что и личный чат: высота 268, масштаб не ниже 1 на узком и широком viewport. Полный браузерный вход в мир не запускался.

## Known issues

Нет.

## Deferred

Пагинация старше 200 сохранённых сообщений не нужна: файл и так хранит не больше 200.

## Next work

Не деплоить и не вливать в `main`.

## Git

Ветка `cursor/restore-chat-pvp-teleport-rules`.
