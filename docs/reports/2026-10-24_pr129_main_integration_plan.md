# План стыковки PR #129 с main

Дата: 2026-10-24. Слияние не выполнялось и этим планом не разрешается.

## Состояние

- main: `c8da9fcbe86f63ee0102c5ee621718431dfe2f73`
- feature: `9ed485588f740e67a1443f1e2ea7fc4159ec80e3`
- база: `2dd09ee7e555896b652789408b4ae93a094cef3b`
- 61 впереди, 46 позади
- `git merge-tree` без коммита: ветка не сливается чисто

## Текстовые конфликты

`docs/ARCHITECTURE.md`, `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `server/WorldInstance.ts`, `server/config.ts`, `server/services/buyer.ts`, `server/services/clan.ts`, `server/services/permissions.ts`, `server/builtin-plugins/claims.ts`, `economy.ts`, `home.ts`, `permissions.ts`, `pluginAdmin.ts`, `rtp.ts`, `rtpPortal.ts`, `spawn.ts`, `tpa.ts`, `src/core/Game.ts`, `src/entities/MobManager.ts`, `src/net/AnarchyClient.ts`, `src/save/snapshot.ts`, `src/save/types.ts`, `tests/player-nickname.test.ts`, `tests/server/anarchy-plugins.test.ts`, `tests/ui-main-integration.test.ts`.

`server/AnarchyServer.ts`, `shared/protocol.ts` и `src/ui/GameUI.ts` автослияние проходит. Это не значит, что смысл совпал.

## Что появилось в main после базы

По журналу `2dd09ee..origin/main`: донат-ранги VIP/PREMIUM/BOSS/TITAN, киты как копия инвентаря, косметические пчёлы и мини-крипер, каталог скинов, эмоции, зритель, правки меню и CSP черновика Яндекса, ускорение плавания, автошахта.

Киты на main вызывают `player.give`. На feature выдача должна остаться серверной и, для пяти ресурсов, попасть в учёт как разрешённый минт. Если при стыковке кит напишет слоты мимо `give`, алмазы станут необъяснённым приростом или, хуже, вторым путём выдачи.

Ранги и `permissions` на main завязаны на ник и донат. На feature OP — только UUID, ник из `FC_OPERATORS` игнорируется. Стыковка не должна вернуть ник как ключ OP. Донат-ранг не должен становиться OP.

Скины, эмоции и косметические питомцы предметы экономики не минтят, если остаются клиентским видом. Это надо подтвердить по фактическому `give` после стыковки, а не по названию PR.

## Смысловые риски

- `WorldInstance.ts`: инвентарь, аукцион, обмен, скупщик, сканеры и реконнект. Брать файл целиком с одной стороны нельзя.
- `AnarchyClient.ts`: на feature welcome не глушит следующие пакеты. Версия с main может вернуть старый слушатель.
- `snapshot.ts` / `types.ts`: сохранения гостя и предметов. Потеря `itemInstanceId` или `sessionToken` при автослиянии тихая.
- `permissions.ts`: UUID против ника.
- `config.ts`: база, админы, `FC_YANDEX_AUTH_*`. Секрет Яндекса в git не класть. Вход Яндекса на feature выключен нарочно.
- Протокол: старый клиент и новый сервер после стыковки надо прогнать на join, инвентарь и welcome. Отдельного join по `playerId` нет и не надо добавлять.

## Порядок, когда человек будет сливать

1. Не ребейзить и не force-push эту ветку.
2. Сначала разрешить `protocol`, `AnarchyClient`, `snapshot`/`types`, затем `WorldInstance`.
3. Права: оставить UUID. Ники доната держать отдельно от OP.
4. Киты и лут провести через существующий серверный `give` и учёт ресурсов.
5. Прогнать инвентарь, stage2c, stage3a/3b/3c и гостевой connect.
6. Прогнать PostgreSQL-интеграции на одноразовой схеме, не на DEV и не на PROD.
7. Только после этого смотреть меню, скины и эмоции.
8. PR #129 до этого остаётся черновиком.

## Что не делать

Не брать весь main поверх антидюпа. Не брать весь feature поверх нового геймплея. Не включать вход Яндекса, пока нет схемы подписанного профиля. Не менять живые `FC_OPERATORS` и не останавливать unit-ы ради проверки бэкапа.
