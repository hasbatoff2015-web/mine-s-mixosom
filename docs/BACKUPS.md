# Резервные копии VPS

VPS только готовит архив. На компьютер владельца он сам не уходит: нет облака, почты, FTP и публичной ссылки. Игровой HTTP и закрытая админка архив не отдают.

Скрипт один: `scripts/fc-backup.sh`. На сервере он ставится в `/usr/local/sbin/fc-backup`. Ручной запуск и таймер вызывают его же. Выкладка игры (`scripts/deploy-release.sh`) этот скрипт не устанавливает и таймер не включает.

## Что попадает в архив

Три каталога мира целиком:

- `/var/lib/frontier-cubes/worlds/anarchy`
- `/var/lib/frontier-cubes/worlds/survival`
- `/var/lib/frontier-cubes/worlds/peaceful`

Внутри сохраняются `meta.json`, `world.json`, `players.json`, `plugin-data/` и остальные файлы мира: инвентари, сундуки, печи, мобы, приваты, дома, аукцион, кланы, учёт ресурсов, инциденты уникальных предметов. Файл `.instance.lock` в архив не кладётся: это метка живого процесса, не сохранение мира.

Общий каталог `/var/lib/frontier-cubes/plugins` попадает в архив, если в нём есть файлы.

PostgreSQL попадает, если во всех трёх файлах `/etc/frontier-cubes/{anarchy,survival,peaceful}.env` задан один и тот же `FC_DATABASE_URL`. Тогда дамп один, формат `pg_dump -Fc`. Если адреса баз различаются, дамп пишется для каждой базы отдельно. Если адрес задан только у части режимов или `FC_DEPLOYMENT_ID` не совпадает, скрипт останавливается и архив не публикует. Пароль передаётся через файл `pgpass` с правами `0600`, не через аргументы команды.

В каждом архиве есть `manifest.json` и `checksums.sha256`. В манифесте нет пароля, адреса базы, хэша токена администратора, сессии игрока и инвентаря.

Файлы `/etc/frontier-cubes/*.env` в архив не входят. Их хранят отдельно, у администратора. Восстановление миров и базы не возвращает `FC_DATABASE_URL`, `FC_ADMIN_AUTH_HASHES` и остальные секреты.

Сам архив чувствительный: в снимках игроков есть данные персонажей и сессионные токены. Каталог архивов не делается доступным всем, и наружу его не публикуют.

## Куда пишется архив

Каталог: `/var/backups/frontier-cubes/`

Права каталога: `0750`. Права архива и файла контрольной суммы: `0640`.

Имя:

```text
frontier-cubes-YYYY-MM-DD_HHMMSS.tar.gz
frontier-cubes-YYYY-MM-DD_HHMMSS.tar.gz.sha256
```

Пример: `frontier-cubes-2026-10-13_040000.tar.gz`. Время в имени — местное время VPS. Готовый файл не перезаписывается. Пока проверка не прошла, окончательное имя не появляется.

Рядом с архивом лежит SHA-256. Первое поле файла — сумма, второе — имя архива.

## Как часто и как сменить расписание

Таймер `deploy/systemd/frontier-cubes-backup.timer` запускает oneshot `frontier-cubes-backup.service` раз в сутки около 04:00 по местному времени VPS. Машина при этом не перезагружается. Часовой пояс Windows на расписание не влияет. Какой пояс стоит на VPS:

```bash
timedatectl
systemctl list-timers frontier-cubes-backup.timer
```

`Persistent=false`. Если VPS был выключен в 04:00, пропущенный запуск сам позже не догоняется. Следующий автоматический запуск — снова в 04:00. Ручную копию можно снять в любой момент.

Смена часа — правка `OnCalendar` в таймере, затем:

```bash
sudo systemctl daemon-reload
sudo systemctl restart frontier-cubes-backup.timer
```

Таймер из этого репозитория на VPS сам не включается. Его включает администратор, когда установка ниже уже сделана.

## Что происходит во время копии

Останавливаются только те игровые unit-ы, которые уже были запущены. Выключенный режим не включается и его `/status` не требуется.

Пока процессы остановлены, скрипт копирует три мира и общий каталог плагинов во временный каталог и снимает `pg_dump`. После этого те же unit-ы запускаются снова. Готовность — это `GET /status` на порту из env (`PORT`), HTTP 200, `ready: true`, свой `mode` и свой `world`. Ожидание готовности ограничено 60 секундами. Строка `active` у systemd сама по себе успехом не считается.

Сжатие gzip, SHA-256 и удаление старых архивов идут уже по временной копии, когда игра снова отвечает. Живые миры второй раз не читаются, второй дамп базы не снимается.

Пауза игры — это остановка, копирование, дамп и набор готовности. Она зависит от размера миров, размера базы и того, сколько процессы поднимаются. Точную паузу на VPS скрипт печатает строками `timing:`; заранее её не обещают. Перед первым включением таймера стоит посмотреть `df -h`.

Журнал одного запуска:

```bash
journalctl -u frontier-cubes-backup.service -n 100 --no-pager
```

На диске остаются три последних полных архива. Полная пара — обычный файл архива и соседний `.sha256`, сумма сходится, `tar` читается. Архив без суммы и сумма без архива в эти три не входят и старые полные копии из-за них не удаляются. Если после копии сервис не дошёл до `ready: true`, новый архив может остаться как `backup: prepared`, но старые полные копии не вычищаются. Число задаётся `FC_KEEP` (по умолчанию 3). Очистка не заходит в каталоги миров и не идёт по symlink.

## Установка

Один раз, от администратора VPS. Игровые unit-ы из-за этого не перезапускаются.

```bash
sudo install -d -m 0750 /var/backups/frontier-cubes
sudo install -m 0750 scripts/fc-backup.sh /usr/local/sbin/fc-backup
sudo install -m 0644 deploy/systemd/frontier-cubes-backup.service /etc/systemd/system/frontier-cubes-backup.service
sudo install -m 0644 deploy/systemd/frontier-cubes-backup.timer /etc/systemd/system/frontier-cubes-backup.timer
sudo systemctl daemon-reload
```

Включить ежедневный запуск:

```bash
sudo systemctl enable --now frontier-cubes-backup.timer
systemctl list-timers frontier-cubes-backup.timer
```

Выключить, не трогая уже лежащие архивы:

```bash
sudo systemctl disable --now frontier-cubes-backup.timer
```

Журнал:

```bash
journalctl -u frontier-cubes-backup.service -n 100 --no-pager
```

## Ручной запуск

```bash
sudo /usr/local/sbin/fc-backup
```

Тот же скрипт через systemd:

```bash
sudo systemctl start frontier-cubes-backup.service
```

Список готовых архивов:

```bash
sudo /usr/local/sbin/fc-backup list
```

Проверка архива на VPS:

```bash
sudo /usr/local/sbin/fc-backup verify /var/backups/frontier-cubes/frontier-cubes-2026-10-13_040000.tar.gz
```

`backup: success` значит, что пара архив+сумма опубликована и остановленные unit-ы снова отвечают `ready: true`. В выводе есть пути, размер и строки `timing:` без паролей и адресов базы.

`backup: prepared` значит, что согласованная пара записана, но готовность игры не подтверждена. Код выхода при этом ненулевой, старые архивы не удаляются.

Если остановка, `pg_dump` или сборка архива срывается, окончательное имя не появляется. Скрипт всё равно пытается поднять unit-ы, которые сам остановил. Чистая остановка — состояние `inactive`. `failed` и пустой ответ успехом остановки не считаются.

Повторный запуск, пока первый держит блокировку, завершается сразу и вторую копию не делает.

## Скачивание на Windows

Каталог `/var/backups/frontier-cubes` всем на чтение не открывают. Для одного выбранного архива делается отдельная копия в домашний каталог SSH-пользователя.

На VPS, под этим пользователем:

```bash
mkdir -p "$HOME/fc-incoming"
sudo /usr/local/sbin/fc-backup stage-download \
  /var/backups/frontier-cubes/frontier-cubes-2026-10-13_040000.tar.gz \
  "$HOME/fc-incoming"
```

Команда копирует архив и `.sha256`. Если она запущена от root, владельцем копий становится владелец каталога назначения.

### WinSCP

1. Протокол SFTP, пользователь `SSH_USER`, хост `VPS_HOST`.
2. Открыть домашний каталог и папку `fc-incoming`.
3. Скачать два файла в `C:\GameBackups\`.
4. Каталог `/var/backups/frontier-cubes` по SFTP не раздавать и права `0750` у него не снимать.

### PowerShell

```powershell
scp SSH_USER@VPS_HOST:fc-incoming/frontier-cubes-2026-10-13_040000.tar.gz C:\GameBackups\
scp SSH_USER@VPS_HOST:fc-incoming/frontier-cubes-2026-10-13_040000.tar.gz.sha256 C:\GameBackups\
```

`SSH_USER` и `VPS_HOST` заменить своими. Имя файла взять из `fc-backup list`.

После проверки на Windows временные копии на VPS удалить:

```bash
rm -f -- "$HOME/fc-incoming/frontier-cubes-2026-10-13_040000.tar.gz" \
  "$HOME/fc-incoming/frontier-cubes-2026-10-13_040000.tar.gz.sha256"
```

Архив в `/var/backups/frontier-cubes` эта команда не удаляет.

## Проверка SHA-256 на Windows

```powershell
Get-FileHash -Algorithm SHA256 C:\GameBackups\frontier-cubes-2026-10-13_040000.tar.gz
Get-Content C:\GameBackups\frontier-cubes-2026-10-13_040000.tar.gz.sha256
tar -tf C:\GameBackups\frontier-cubes-2026-10-13_040000.tar.gz
```

`Hash` из `Get-FileHash` должен совпасть с первым полем файла `.sha256`. Если не совпал, скачанный файл не использовать. Совпадение суммы не заменяет пробное восстановление.

`tar -tf` показывает состав: `manifest.json`, `worlds/anarchy`, `worlds/survival`, `worlds/peaceful`, при наличии `plugins/` и `postgres/`.

## Восстановление

Автоматического восстановления нет. Нельзя разворачивать архив поверх работающего мира и нельзя заливать дамп в рабочую базу, пока идёт проверка.

Порядок для настоящей аварии:

1. Убедиться, что архив снят с того же контура: в `manifest.json` поля `deploymentId` и `releaseId`.
2. Остановить игровые unit-ы:

```bash
sudo systemctl stop frontier-cubes-anarchy frontier-cubes-survival frontier-cubes-peaceful
```

3. Убрать текущие данные в сторону, не удаляя их:

```bash
sudo mv /var/lib/frontier-cubes/worlds /var/lib/frontier-cubes/worlds.before-restore
sudo -u postgres pg_dump -Fc -f /var/backups/frontier-cubes/before-restore.dump ИМЯ_РАБОЧЕЙ_БАЗЫ
```

4. Проверить сумму выбранного архива: `sudo /usr/local/sbin/fc-backup verify АРХИВ`.
5. Распаковать во временный каталог и посмотреть состав:

```bash
sudo mkdir -p /var/tmp/fc-restore
sudo tar -xzf /var/backups/frontier-cubes/frontier-cubes-2026-10-13_040000.tar.gz -C /var/tmp/fc-restore
sudo tar -tzf /var/backups/frontier-cubes/frontier-cubes-2026-10-13_040000.tar.gz
```

6. Вернуть каталоги миров на свои пути и выставить владельца `frontier-cubes`:

```bash
sudo mkdir -p /var/lib/frontier-cubes/worlds
sudo cp -a /var/tmp/fc-restore/worlds/. /var/lib/frontier-cubes/worlds/
sudo chown -R frontier-cubes:frontier-cubes /var/lib/frontier-cubes/worlds
```

7. Восстановить PostgreSQL в ту базу, которую указывают сохранённые env-файлы. Это отдельное решение администратора, не шаг скрипта. Для проверки используют новую пустую базу, не рабочую.

8. Вернуть `/etc/frontier-cubes/*.env` из отдельной защищённой копии. Архив их не содержит.
9. Запустить unit-ы и проверить `/status`, что у каждого процесса свой `world`.
10. Если проверка не сошлась, снова остановить unit-ы и вернуть каталог `worlds.before-restore` и дамп `before-restore.dump`.

## Пробное восстановление

Его делают во временных каталогах и в одноразовой базе. Рабочие пути `/var/lib/frontier-cubes` и рабочая база не используются.

Автоматическая репетиция в репозитории: `tests/server/stage6-backup-restore.integration.test.ts`. Она поднимает схему миграциями, снимает архив фальшивым `systemctl`, распаковывает его во временный каталог, читает снимок через `WorldPersistence` и заливает дамп в другую одноразовую базу. Без `FC_TEST_DATABASE_URL` этот тест не подменяет базу заглушкой и не запускается.

## Чего не делать

- Не копировать файлы мира, пока три процесса их пишут, и не считать такую копию согласованной.
- Не останавливать процессы через `SIGKILL` как обычный шаг.
- Не публиковать полусобранный архив и не удалять прежние хорошие копии после неудачного запуска.
- Не открывать `/var/backups/frontier-cubes` на весь мир и не делать для него HTTP.
- Не класть env-файлы с паролями в git и в скачиваемый архив.
- Не восстанавливать дамп в рабочую базу ради проверки.
