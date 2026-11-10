# Ежедневная награда за вход — 2026-11-10

## Goal

Серверная награда за календарный день Москвы в Anarchy, Survival и Peaceful. Одна выплата на UUID, дату, режим и deployment. Суммы меняются в игре без перезапуска. JSON-кошелёк не используется.

## Result

Выплата — одна операция `DAILY_REWARD` в существующем ledger. Источник `<UUID>:<YYYY-MM-DD>`. Проверка, серия, баланс и ledger коммитятся одной транзакцией. Повтор и параллельный claim возвращают уже записанную сумму. Плагин `daily-rewards` по умолчанию выключен.

## Implemented

- Календарь `Europe/Moscow` через `Intl.DateTimeFormat.formatToParts`.
- `MegacoinService.claimDailyReward`: блокировка счёта, уникальный источник, ledger, откат при потолке баланса.
- Уже существующая выплата не сравнивается с новой суммой серии и не создаёт вторую операцию. `assertSame` для остальных источников не менялся.
- Серия в metadata. Повреждённые metadata вчерашней выплаты начинают день 1. Повреждённая сегодняшняя операция повторно не платит.
- Плагин: одна очередь на вход и полуночный обход, не больше четырёх SQL на процесс, общий backoff, одно системное сообщение, in-memory досылка если игрок отключился до commit.

## Changed files

- `server/economy/moscowCalendar.ts`, `server/economy/dailyReward.ts`
- `server/economy/types.ts`, `repository.ts`, `postgresRepository.ts`, `service.ts`, `currencyPort.ts`, `postgresAuthority.ts`
- `server/builtin-plugins/dailyRewards.ts`, `index.ts`, `context.ts`
- `server/WorldInstance.ts`, `server/services/permissions.ts`
- `tests/server/daily-reward.test.ts`, `daily-rewards-plugin.test.ts`, `daily-reward.integration.test.ts`
- `docs/PLUGINS.md`, `docs/POSTGRESQL.md`, `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`

## Architecture decisions

Новой миграции нет. Уникальность уже есть: `(deployment_id, economy_scope, source_type, source_id)`. Отдельная таблица отметок или запись в `plugin-data` создала бы окно для повторной выплаты. Конфликт именно `DAILY_REWARD` читает ledger и metadata. Остальные источники по-прежнему требуют совпадения суммы.

Кэш баланса обновляется только после commit новой выплаты.

## Tests

Локальная тестовая база `fc_local_test` на 127.0.0.1. Production не использовалась.

- `npx vitest run tests/server/daily-reward.test.ts tests/server/daily-rewards-plugin.test.ts tests/server/daily-reward.integration.test.ts` с `FC_TEST_DATABASE_URL`: 3 файла, 23 теста, 0 падений.
- `npm run typecheck:server`: успешно.
- `npm run check:boundaries`: успешно.
- `npm run build:server`: успешно.
- Точечно экономика, megacoin, plugin platform и anarchy server: 11 файлов, 117 тестов, 0 падений.
- `npm run test:server` с той же тестовой базой завершился с кодом 1. Упали `economy-join` (display name после смены ника) и `tick-load-flight` (лимит 80 мс). Повтор этих двух файлов отдельно: 6 тестов, 0 падений. Это нагрузка полного прогона, не вторая выплата.

## Visual QA

Отдельного клиентского окна нет. Headless `WorldInstance` проверил вход, сообщение в чат, повторный вход и новый процесс мира: одна строка ledger.

## Performance

Выплата не идёт из игрового tick. Планировщик — `scheduleRepeating(10_000)`. Вход и обход делят одну очередь: не больше 4 SQL на процесс. Ошибка базы и потолок баланса ждут 30 с, затем 60 с, 120 с и далее 5 минут, в том числе при повторном входе. Сообщение одно. Если игрок отключился до него, текст живёт в памяти процесса до повторного входа и пропадает при падении процесса.

## Follow-up после аудита PR #146

Очередь общая для входа и полуночи: не больше четырёх SQL на экземпляр плагина. Backoff одинаковый для входа, sweep и повтора. Сообщение одно. Если игрок отключился до отправки, текст хранится в памяти этого процесса до повторного входа или повторного включения того же экземпляра. Падение процесса после commit это сообщение теряет. Деньги при этом уже в ledger и второй раз не начисляются. `/dailyreward disable` снимает ещё не начатые задачи и не отменяет уже открытую транзакцию.

Повторные проверки этой доработки: `npm run typecheck:server`, `npm run check:boundaries`, `npm run build:server` успешны. Daily reward, экономика и plugin platform — 13 файлов, 116 тестов, 0 падений. `npm run test:server` с локальной `fc_local_test`: 153 файла, 1313 прошло, 1 пропущен, 0 падений.

## Known issues

Живой браузерный DEV не прогонялся. Survival и Peaceful проверены отдельными `MegacoinService` на одной тестовой базе, не тремя процессами сервера. Уведомление не записано в базу: аварийный выход процесса после commit и до чата оставляет выплату без строки в чате.

## Deferred

Окно наград в клиенте. Частичная выплата до потолка баланса. Автоматическое включение после установки.

## Next work

Администратор DEV включает PostgreSQL backend, задаёт серию и проверяет три режима. Production эта ветка не меняет.

## Git

Ветка `cursor/daily-login-rewards` от `origin/main` `fd9e8d91d4accc765428665ea49a86ac333e3c50`. `main` и PR #145 не менялись.
