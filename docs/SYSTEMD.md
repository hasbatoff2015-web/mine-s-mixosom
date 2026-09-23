# systemd: три игровых процесса

Один и тот же production bundle, три независимых процесса. У каждого свой порт и свой каталог мира. Игровая механика, протокол и клиент здесь не меняются.

Код релиза и файлы миров лежат в разных местах. Обновление bundle не трогает миры.

| | Путь |
| --- | --- |
| Текущий релиз | `/opt/frontier-cubes/current` → `/opt/frontier-cubes/releases/<sha>` |
| Мир Anarchy | `/var/lib/frontier-cubes/worlds/anarchy` |
| Мир Survival | `/var/lib/frontier-cubes/worlds/survival` |
| Мир Peaceful | `/var/lib/frontier-cubes/worlds/peaceful` |
| Пустые дисковые плагины | `/var/lib/frontier-cubes/plugins` |
| Env | `/etc/frontier-cubes/anarchy.env`, `survival.env`, `peaceful.env` |
| Unit-файлы в репозитории | `deploy/systemd/` |

`WORLD_PATH` в env — это родитель `/var/lib/frontier-cubes/worlds`. Процесс сам дописывает `WORLD`, поэтому каталог мира получается `/var/lib/frontier-cubes/worlds/anarchy`, а не `.../anarchy/anarchy`. Так устроен `loadServerConfig`.

Процесс слушает `0.0.0.0`. Firewall, Nginx и TLS в этот шаг не входят.

Нужен Node.js 20+ и `node` по пути `/usr/bin/node`. Проверка: `command -v node`.

## Пользователь и каталоги

Игровой процесс не запускается от root.

```bash
sudo useradd --system --home /var/lib/frontier-cubes --shell /usr/sbin/nologin --user-group frontier-cubes
sudo mkdir -p /opt/frontier-cubes/releases \
  /var/lib/frontier-cubes/worlds/anarchy \
  /var/lib/frontier-cubes/worlds/survival \
  /var/lib/frontier-cubes/worlds/peaceful \
  /var/lib/frontier-cubes/plugins \
  /etc/frontier-cubes
sudo chown -R frontier-cubes:frontier-cubes /var/lib/frontier-cubes
sudo chmod 750 /var/lib/frontier-cubes /var/lib/frontier-cubes/worlds
```

`/opt/frontier-cubes` остаётся читаемым для `frontier-cubes` и не должен быть местом, куда процесс пишет мир.

## Установка релиза

Сборка выполняется отдельно от каталогов миров. На машине сборки, в дереве репозитория:

```bash
npm ci
npm run build:server
```

Дальше на сервере, под новым каталогом релиза (подставьте sha коммита):

```bash
sudo mkdir -p /opt/frontier-cubes/releases/<sha>/dist
sudo rsync -a dist/server /opt/frontier-cubes/releases/<sha>/dist/
sudo rsync -a package.json package-lock.json /opt/frontier-cubes/releases/<sha>/
sudo npm ci --omit=dev --prefix /opt/frontier-cubes/releases/<sha>
sudo ln -sfn /opt/frontier-cubes/releases/<sha> /opt/frontier-cubes/current
sudo chown -R root:root /opt/frontier-cubes/releases/<sha>
sudo chmod -R a+rX /opt/frontier-cubes/releases/<sha>
```

`npm ci --omit=dev` нужен из-за external-пакета `ws`. В этот каталог не копируют `server/data`. Старый релиз не удаляют.

## Unit-файлы и env

```bash
sudo cp deploy/systemd/anarchy.env /etc/frontier-cubes/anarchy.env
sudo cp deploy/systemd/survival.env /etc/frontier-cubes/survival.env
sudo cp deploy/systemd/peaceful.env /etc/frontier-cubes/peaceful.env
sudo cp deploy/systemd/frontier-cubes-anarchy.service /etc/systemd/system/
sudo cp deploy/systemd/frontier-cubes-survival.service /etc/systemd/system/
sudo cp deploy/systemd/frontier-cubes-peaceful.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now frontier-cubes-anarchy frontier-cubes-survival frontier-cubes-peaceful
```

В git лежат только эти значения: режим, порт, `HOST=0.0.0.0`, родитель миров, tick rate, view radius, max players, интервал сохранения, каталог дисковых плагинов. Паролей там нет. Если на сервере позже появится `FC_OPERATORS`, его дописывают в `/etc/frontier-cubes/*.env` и не коммитят.

Каждый unit:

- `User=frontier-cubes`
- `ExecStart=/usr/bin/node /opt/frontier-cubes/current/dist/server/index.mjs`
- `Restart=on-failure`, `RestartSec=5`
- `KillSignal=SIGTERM`, `TimeoutStopSec=30`
- `NoNewPrivileges=true`, `PrivateTmp=true`
- stdout/stderr в journald

`systemctl stop` шлёт SIGTERM. Процесс сохраняет мир, снимает `.instance.lock` и выходит с кодом 0, поэтому `Restart=on-failure` его снова не поднимает. Падение с кодом 1 поднимается через 5 секунд.

## Статус и журналы

```bash
systemctl status frontier-cubes-anarchy frontier-cubes-survival frontier-cubes-peaceful
journalctl -u frontier-cubes-anarchy -u frontier-cubes-survival -u frontier-cubes-peaceful -f
```

Health check с той же машины:

```bash
curl -fsS http://127.0.0.1:2567/status
curl -fsS http://127.0.0.1:2568/status
curl -fsS http://127.0.0.1:2569/status
```

или из корня репозитория, если три процесса уже слушают порты:

```bash
npm run status:servers
```

Ожидание для каждого: HTTP 200, `ready: true`, `mode` и `world` равны `anarchy`, `survival` или `peaceful` на портах 2567, 2568 и 2569. `systemctl status` показывает, что процесс принадлежит unit-у `frontier-cubes-*` и пользователю `frontier-cubes`.

## Остановка и перезапуск

```bash
sudo systemctl stop frontier-cubes-anarchy
sudo systemctl start frontier-cubes-anarchy
sudo systemctl restart frontier-cubes-anarchy frontier-cubes-survival frontier-cubes-peaceful
```

`restart` для каждого сервиса шлёт SIGTERM, ждёт до 30 секунд, пока `stop()` сохранит мир и удалит `.instance.lock`, затем запускает процесс заново. После этого снова `npm run status:servers`.

## Обновление

1. Собрать новый sha отдельно (`npm ci`, `npm run build:server`).
2. Положить его в `/opt/frontier-cubes/releases/<new>` вместе с `npm ci --omit=dev`. Не удалять `/var/lib/frontier-cubes` и не удалять предыдущий `/opt/frontier-cubes/releases/<old>`.
3. Переключить ссылку только после того, как новый каталог собран:

```bash
sudo ln -sfn /opt/frontier-cubes/releases/<new> /opt/frontier-cubes/current
sudo systemctl restart frontier-cubes-anarchy frontier-cubes-survival frontier-cubes-peaceful
npm run status:servers
```

`restart` даёт текущему процессу SIGTERM: мир пишется на диск, lock снимается, новый процесс открывает тот же каталог мира.

## Откат

Предыдущий релиз всё ещё лежит на диске. Миры не перезаписывались установкой кода.

```bash
sudo ln -sfn /opt/frontier-cubes/releases/<old> /opt/frontier-cubes/current
sudo systemctl restart frontier-cubes-anarchy frontier-cubes-survival frontier-cubes-peaceful
npm run status:servers
```

Старый каталог релиза удаляют только после успешной проверки нового `/status`.
