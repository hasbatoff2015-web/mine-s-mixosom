#!/usr/bin/env bash
# Prepare one Frontier Cubes archive on the VPS.
# The script stops the game units that are actually running, copies worlds
# and plugin data, dumps PostgreSQL when the env files configure it, then
# starts those same units again. It does not upload the archive, serve it
# over HTTP, or restore production.
# shellcheck shell=bash

set -euo pipefail
umask 027

: "${FC_BACKUP_DIR:=/var/backups/frontier-cubes}"
: "${FC_WORLD_ROOT:=/var/lib/frontier-cubes/worlds}"
: "${FC_PLUGIN_DIR:=/var/lib/frontier-cubes/plugins}"
: "${FC_ENV_DIR:=/etc/frontier-cubes}"
: "${FC_OPT_ROOT:=/opt/frontier-cubes}"
: "${FC_SYSTEMCTL:=systemctl}"
: "${FC_PG_DUMP:=pg_dump}"
: "${FC_PG_RESTORE:=pg_restore}"
: "${FC_KEEP:=3}"
: "${FC_SERVICES:=frontier-cubes-anarchy.service frontier-cubes-survival.service frontier-cubes-peaceful.service}"
: "${FC_TAR:=tar}"
: "${FC_MV:=mv}"
: "${FC_NODE:=node}"
: "${FC_HEALTH_TIMEOUT:=60}"
: "${FC_HEALTH_INTERVAL:=1}"
: "${FC_STATUS_HOST:=127.0.0.1}"

WORLDS=(anarchy survival peaceful)
ENV_NAMES=(anarchy survival peaceful)

need_restart=0
services_restarted=0
recovery_attempted=0
published=0
reported=0
timing_printed=0
t_origin=0
t_stop_begin=0
timing_stop_ms=0
timing_copy_ms=0
timing_dump_ms=0
timing_start_ms=0
timing_ready_ms=0
timing_compress_ms=0
timing_total_ms=0
timing_downtime_ms=0
declare -a was_running=()
work_dir=""

die() {
  echo "error: $*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
usage: fc-backup [backup]
       fc-backup list
       fc-backup verify ARCHIVE
       fc-backup stage-download ARCHIVE DEST_DIR

backup stops running frontier-cubes game services, writes one archive under
FC_BACKUP_DIR, and starts only the services that were running. list, verify,
and stage-download do not stop the game.
EOF
}

json_escape() {
  local s=$1
  s=${s//\\/\\\\}
  s=${s//\"/\\\"}
  s=${s//$'\n'/}
  s=${s//$'\r'/}
  printf '%s' "$s"
}

json_string_or_null() {
  local s=$1
  if [[ -z "$s" ]]; then
    printf 'null'
  else
    printf '"%s"' "$(json_escape "$s")"
  fi
}

is_backup_name() {
  [[ "$1" =~ ^frontier-cubes-[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{6}\.tar\.gz$ ]]
}

real_path() {
  readlink -f -- "$1"
}

assert_inside() {
  local path=$1 root=$2 label=$3
  local real root_real
  real=$(real_path "$path")
  root_real=$(real_path "$root")
  case "$real/" in
    "$root_real"/*) ;;
    *) die "$label escapes $root" ;;
  esac
  printf '%s' "$real"
}

read_env_value() {
  local file=$1 key=$2 line
  line=$(grep -E "^[[:space:]]*${key}=" "$file" | tail -n 1 || true)
  line=${line#"${line%%[![:space:]]*}"}
  line=${line#"${key}="}
  if [[ ${#line} -ge 2 && "$line" == \"*\" && "$line" == *\" ]]; then
    line=${line:1:${#line}-2}
  elif [[ ${#line} -ge 2 && "$line" == \'*\' && "$line" == *\' ]]; then
    line=${line:1:${#line}-2}
  fi
  printf '%s' "$line"
}

url_decode() {
  local encoded=$1
  local decoded="" i=0 c hex
  local len=${#encoded}
  while (( i < len )); do
    c=${encoded:i:1}
    if [[ "$c" == "%" ]]; then
      hex=${encoded:i+1:2}
      if [[ "$hex" =~ ^[0-9A-Fa-f]{2}$ ]]; then
        decoded+=$(printf '%b' "\\x$hex")
        i=$((i + 3))
        continue
      fi
    fi
    decoded+="$c"
    i=$((i + 1))
  done
  printf '%s' "$decoded"
}

escape_pgpass() {
  local v=$1
  v=${v//\\/\\\\}
  v=${v//:/\\:}
  printf '%s' "$v"
}

# Prints host, port, user, database, and password on separate lines.
# The caller must not log that output.
parse_database_url() {
  local url=$1 rest userinfo hostpart user pass hostport db host port
  case "$url" in
    postgresql://*|postgres://*) ;;
    *) return 1 ;;
  esac
  rest=${url#postgresql://}
  rest=${rest#postgres://}
  userinfo=${rest%@*}
  hostpart=${rest##*@}
  if [[ "$userinfo" == "$rest" || -z "$hostpart" ]]; then
    return 1
  fi
  user=${userinfo%%:*}
  if [[ "$userinfo" == *:* ]]; then
    pass=${userinfo#*:}
  else
    pass=""
  fi
  hostport=${hostpart%%/*}
  db=${hostpart#*/}
  local query=""
  if [[ "$db" == *\?* ]]; then
    query=${db#*\?}
    db=${db%%\?*}
  fi
  if [[ "$hostport" == "$hostpart" || -z "$db" || -z "$user" ]]; then
    return 1
  fi
  local sslmode=""
  if [[ -n "$query" ]]; then
    if [[ ! "$query" =~ ^sslmode=(disable|allow|prefer|require|verify-ca|verify-full)$ ]]; then
      return 1
    fi
    sslmode=${query#sslmode=}
  fi
  if [[ "$hostport" == \[*\]* ]]; then
    host=${hostport%%\]*}
    host=${host#\[}
    port=${hostport#*\]}
    port=${port#:}
    [[ -z "$port" ]] && port=5432
  elif [[ "$hostport" == *:* ]]; then
    host=${hostport%%:*}
    port=${hostport##*:}
  else
    host=$hostport
    port=5432
  fi
  [[ "$port" =~ ^[0-9]+$ ]] || return 1
  [[ -n "$host" && -n "$db" ]] || return 1
  user=$(url_decode "$user")
  pass=$(url_decode "$pass")
  host=$(url_decode "$host")
  db=$(url_decode "$db")
  printf '%s\n' "$host" "$port" "$user" "$db" "$pass" "$sslmode"
}

service_state() {
  "$FC_SYSTEMCTL" is-active "$1" 2>/dev/null || true
}

now_ms() {
  awk '{printf "%d", $1 * 1000}' /proc/uptime
}

mark_phase() {
  if [[ -n "${FC_PHASE_LOG:-}" ]]; then
    printf '%s\n' "$1" >> "$FC_PHASE_LOG"
  fi
}

unit_mode() {
  case "$1" in
    frontier-cubes-anarchy.service) printf '%s' anarchy ;;
    frontier-cubes-survival.service) printf '%s' survival ;;
    frontier-cubes-peaceful.service) printf '%s' peaceful ;;
    *) return 1 ;;
  esac
}

write_status_checker() {
  cat > "$work_dir/status-check.mjs" <<'EOF'
const url = process.argv[2];
const expectMode = process.argv[3];
const expectWorld = process.argv[4];
let response;
try {
  response = await fetch(url, { signal: AbortSignal.timeout(5000) });
} catch {
  console.error('status-unreachable');
  process.exit(2);
}
let body;
try {
  body = await response.json();
} catch {
  console.error('status-not-json');
  process.exit(2);
}
const ready = body && typeof body === 'object' ? body.ready === true : false;
const mode = body && typeof body === 'object' && typeof body.mode === 'string' ? body.mode : '';
const world = body && typeof body === 'object' && typeof body.world === 'string' ? body.world : '';
if (response.status !== 200 || !ready || mode !== expectMode || world !== expectWorld) {
  console.error(`status-not-ready http=${response.status} ready=${String(body && body.ready)} mode=${mode} world=${world}`);
  process.exit(1);
}
EOF
}

check_ready_once() {
  local unit mode port world server_mode
  for unit in "${was_running[@]}"; do
    mode=$(unit_mode "$unit") || {
      echo "services: no status target for $unit" >&2
      return 1
    }
    port=$(read_env_value "$FC_ENV_DIR/$mode.env" PORT)
    world=$(read_env_value "$FC_ENV_DIR/$mode.env" WORLD)
    server_mode=$(read_env_value "$FC_ENV_DIR/$mode.env" SERVER_MODE)
    [[ "$port" =~ ^[0-9]+$ && "$port" -ge 1 && "$port" -le 65535 ]] || {
      echo "services: $mode env has no usable PORT" >&2
      return 1
    }
    [[ -n "$world" && -n "$server_mode" ]] || {
      echo "services: $mode env is missing WORLD or SERVER_MODE" >&2
      return 1
    }
    if ! "$FC_NODE" "$work_dir/status-check.mjs" \
      "http://${FC_STATUS_HOST}:${port}/status" "$server_mode" "$world"; then
      return 1
    fi
  done
  return 0
}

wait_until_ready() {
  local deadline
  if [[ -n "${FC_HEALTHCHECK:-}" ]]; then
    bash -c "$FC_HEALTHCHECK"
    return
  fi
  [[ "$FC_STATUS_HOST" =~ ^[A-Za-z0-9._-]+$ ]] || {
    echo "services: FC_STATUS_HOST is not a plain host name" >&2
    return 1
  }
  command -v "$FC_NODE" >/dev/null 2>&1 || {
    echo "services: node is required for the readiness check" >&2
    return 1
  }
  write_status_checker
  deadline=$((SECONDS + FC_HEALTH_TIMEOUT))
  while true; do
    if check_ready_once; then
      return 0
    fi
    if (( SECONDS >= deadline )); then
      echo "services: readiness timed out" >&2
      return 1
    fi
    sleep "$FC_HEALTH_INTERVAL"
  done
}

note_downtime() {
  if [[ "$need_restart" == 1 && "$t_stop_begin" != 0 ]]; then
    timing_downtime_ms=$(( $(now_ms) - t_stop_begin ))
  fi
}

recover_services() {
  local started
  if [[ "$services_restarted" == 1 ]]; then
    return 0
  fi
  if [[ "$recovery_attempted" == 1 ]]; then
    return 1
  fi
  recovery_attempted=1
  if [[ "$need_restart" != 1 ]]; then
    services_restarted=1
    return 0
  fi
  started=$(now_ms)
  if ! "$FC_SYSTEMCTL" start "${was_running[@]}"; then
    timing_start_ms=$(( $(now_ms) - started ))
    note_downtime
    echo "services: restart failed" >&2
    return 1
  fi
  timing_start_ms=$(( $(now_ms) - started ))
  mark_phase start-end
  started=$(now_ms)
  if ! wait_until_ready; then
    timing_ready_ms=$(( $(now_ms) - started ))
    note_downtime
    echo "services: unhealthy" >&2
    return 1
  fi
  timing_ready_ms=$(( $(now_ms) - started ))
  note_downtime
  mark_phase ready-end
  services_restarted=1
  return 0
}

print_timing() {
  if [[ "$timing_printed" == 1 ]]; then
    return 0
  fi
  timing_printed=1
  if [[ "$t_origin" != 0 ]]; then
    timing_total_ms=$(( $(now_ms) - t_origin ))
  fi
  echo "timing: stop_ms=${timing_stop_ms}"
  echo "timing: copy_ms=${timing_copy_ms}"
  echo "timing: dump_ms=${timing_dump_ms}"
  echo "timing: start_ms=${timing_start_ms}"
  echo "timing: ready_ms=${timing_ready_ms}"
  echo "timing: compress_ms=${timing_compress_ms}"
  echo "timing: total_ms=${timing_total_ms}"
  echo "timing: downtime_ms=${timing_downtime_ms}"
}

print_service_states() {
  local unit state
  for unit in "${SERVICES[@]}"; do
    state=$(service_state "$unit")
    echo "service: $unit ${state:-unknown}"
  done
}

backup_cleanup() {
  local status=$?
  set +e
  trap - EXIT
  if ! recover_services; then
    status=1
  fi
  print_timing
  if [[ -n "$work_dir" && -d "$work_dir" ]]; then
    rm -rf -- "$work_dir"
  fi
  if [[ "$reported" == 1 ]]; then
    exit "$status"
  fi
  if [[ "$status" -ne 0 && "$published" != 1 ]]; then
    echo "backup: failed" >&2
  elif [[ "$status" -ne 0 && "$published" == 1 ]]; then
    echo "backup: prepared" >&2
    if [[ -n "${published_archive:-}" ]]; then
      echo "archive: $published_archive" >&2
      echo "checksum: $published_archive.sha256" >&2
    fi
  fi
  exit "$status"
}

acquire_lock() {
  mkdir -p -- "$FC_BACKUP_DIR"
  chmod 750 "$FC_BACKUP_DIR" || true
  local lock="$FC_BACKUP_DIR/.fc-backup.lock"
  exec 9>"$lock"
  chmod 640 "$lock" || true
  if ! flock -n 9; then
    die "another backup is already running"
  fi
}

assert_backup_dir_safe() {
  local backup_real world_real
  [[ -d "$FC_BACKUP_DIR" ]] || die "backup directory does not exist"
  backup_real=$(real_path "$FC_BACKUP_DIR")
  if [[ -d "$FC_WORLD_ROOT" ]]; then
    world_real=$(real_path "$FC_WORLD_ROOT")
    case "$backup_real/" in
      "$world_real"/*|"$world_real"/)
        die "backup directory must stay outside the world root"
        ;;
    esac
  fi
  case "$backup_real" in
    /var/lib/frontier-cubes|/var/lib/frontier-cubes/*)
      die "backup directory must stay outside /var/lib/frontier-cubes"
      ;;
  esac
}

load_services() {
  local unit
  # shellcheck disable=SC2206
  SERVICES=($FC_SERVICES)
  ((${#SERVICES[@]} > 0)) || die "no game services configured"
  for unit in "${SERVICES[@]}"; do
    [[ "$unit" =~ ^[A-Za-z0-9@._-]+\.service$ ]] || die "invalid service name"
  done
}

require_worlds() {
  local world path
  [[ -d "$FC_WORLD_ROOT" ]] || die "world root is missing"
  for world in "${WORLDS[@]}"; do
    path="$FC_WORLD_ROOT/$world"
    [[ -d "$path" ]] || die "missing world directory: $world"
    [[ -f "$path/meta.json" && -f "$path/world.json" && -f "$path/players.json" ]] \
      || die "world $world is missing meta.json, world.json, or players.json"
  done
}

load_database_plan() {
  local name file url deployment previous=""
  postgres_mode=none
  deployment_id=""
  rm -rf -- "$work_dir/db"
  mkdir -p -- "$work_dir/db"
  chmod 700 "$work_dir/db"
  [[ -d "$FC_ENV_DIR" ]] || die "env directory is missing; refusing to guess whether PostgreSQL is configured"
  for name in "${ENV_NAMES[@]}"; do
    file="$FC_ENV_DIR/$name.env"
    [[ -f "$file" ]] || die "missing $name.env; refusing to guess whether PostgreSQL is configured"
    url=$(read_env_value "$file" FC_DATABASE_URL)
    deployment=$(read_env_value "$file" FC_DEPLOYMENT_ID)
    if [[ -n "$url" ]]; then
      printf '%s' "$url" > "$work_dir/db/$name.url"
      chmod 600 "$work_dir/db/$name.url"
      postgres_mode=configured
    fi
    if [[ -n "$deployment" ]]; then
      if [[ -n "$previous" && "$previous" != "$deployment" ]]; then
        die "FC_DEPLOYMENT_ID differs between env files; refusing to mix deployments"
      fi
      previous=$deployment
      deployment_id=$deployment
    fi
  done
  if [[ "$postgres_mode" == configured ]]; then
    for name in "${ENV_NAMES[@]}"; do
      [[ -f "$work_dir/db/$name.url" ]] || die "$name.env has no FC_DATABASE_URL while another mode does"
    done
    [[ -n "$deployment_id" ]] || die "FC_DEPLOYMENT_ID is required when FC_DATABASE_URL is set"
    [[ -x "$FC_PG_DUMP" || -x "$(command -v "$FC_PG_DUMP" 2>/dev/null || true)" ]] || die "pg_dump is not executable"
    [[ -x "$FC_PG_RESTORE" || -x "$(command -v "$FC_PG_RESTORE" 2>/dev/null || true)" ]] || die "pg_restore is not executable"
  fi
}

copy_worlds() {
  local world src dest real
  mkdir -p -- "$work_dir/staging/worlds"
  for world in "${WORLDS[@]}"; do
    src="$FC_WORLD_ROOT/$world"
    real=$(assert_inside "$src" "$FC_WORLD_ROOT" "world $world")
    dest="$work_dir/staging/worlds/$world"
    cp -a -- "$real" "$dest"
    # Runtime ownership marker. A restored pid can collide with a later process.
    rm -f -- "$dest/.instance.lock"
    [[ -f "$dest/meta.json" && -f "$dest/world.json" && -f "$dest/players.json" ]] \
      || die "copied world $world is incomplete"
  done
}

copy_plugins() {
  local real world_real
  plugins_included=0
  [[ -d "$FC_PLUGIN_DIR" ]] || return 0
  if ! find "$FC_PLUGIN_DIR" -mindepth 1 -print -quit | grep -q .; then
    return 0
  fi
  real=$(real_path "$FC_PLUGIN_DIR")
  [[ -d "$real" ]] || die "plugin directory is not a directory"
  if [[ -d "$FC_WORLD_ROOT" ]]; then
    world_real=$(real_path "$FC_WORLD_ROOT")
    case "$real/" in
      "$world_real"/*|"$world_real"/)
        die "plugin directory must stay outside the world root"
        ;;
    esac
  fi
  cp -a -- "$real" "$work_dir/staging/plugins"
  plugins_included=1
}

dump_postgres() {
  local -a groups=()
  local name other url_file group host port user db pass sslmode dump_rel dump_path item
  local pgpass="$work_dir/pgpass"
  : > "$pgpass"
  chmod 600 "$pgpass"
  mkdir -p -- "$work_dir/staging/postgres"
  for name in "${ENV_NAMES[@]}"; do
    url_file="$work_dir/db/$name.url"
    group=""
    for other in "${groups[@]}"; do
      if cmp -s "$url_file" "$work_dir/db/${other%%+*}.url"; then
        group=$other
        break
      fi
    done
    if [[ -z "$group" ]]; then
      groups+=("$name")
    else
      local -a rebuilt=()
      for item in "${groups[@]}"; do
        if [[ "$item" == "$group" ]]; then
          rebuilt+=("${group}+${name}")
        else
          rebuilt+=("$item")
        fi
      done
      groups=("${rebuilt[@]}")
    fi
  done
  dump_list=()
  for group in "${groups[@]}"; do
    name=${group%%+*}
    mapfile -t parsed < <(parse_database_url "$(cat "$work_dir/db/$name.url")") \
      || die "FC_DATABASE_URL in $name.env is not a usable postgresql URL"
    if [[ ${#parsed[@]} -ne 6 ]]; then
      die "FC_DATABASE_URL in $name.env is not a usable postgresql URL"
    fi
    host=${parsed[0]}
    port=${parsed[1]}
    user=${parsed[2]}
    db=${parsed[3]}
    pass=${parsed[4]}
    sslmode=${parsed[5]}
    printf '%s:%s:%s:%s:%s\n' \
      "$(escape_pgpass "$host")" \
      "$(escape_pgpass "$port")" \
      "$(escape_pgpass "$db")" \
      "$(escape_pgpass "$user")" \
      "$(escape_pgpass "$pass")" >> "$pgpass"
    dump_rel="postgres/${group}.dump"
    dump_path="$work_dir/staging/$dump_rel"
    local -a dump_env=(
      "PGHOST=$host" "PGPORT=$port" "PGUSER=$user" "PGDATABASE=$db" "PGPASSFILE=$pgpass"
    )
    if [[ -n "$sslmode" ]]; then
      dump_env+=("PGSSLMODE=$sslmode")
    fi
    if ! env "${dump_env[@]}" "$FC_PG_DUMP" -Fc --no-password -f "$dump_path"; then
      die "pg_dump failed"
    fi
    if [[ ! -s "$dump_path" ]]; then
      die "pg_dump produced no dump"
    fi
    if ! "$FC_PG_RESTORE" --list "$dump_path" >/dev/null; then
      die "pg_restore could not read the dump"
    fi
    dump_list+=("$dump_rel")
  done
  unset host port user db pass sslmode parsed
}

write_manifest() {
  local dumps_json="[]" dirs_json item comma=""
  local tar_ver pg_ver="" created release_id=""
  if [[ ${#dump_list[@]} -gt 0 ]]; then
    dumps_json="["
    comma=""
    for item in "${dump_list[@]}"; do
      dumps_json+="$comma\"$(json_escape "$item")\""
      comma=","
    done
    dumps_json+="]"
  fi
  dirs_json='["worlds/anarchy","worlds/survival","worlds/peaceful"'
  if [[ "$plugins_included" == 1 ]]; then
    dirs_json+=',"plugins"'
  fi
  dirs_json+="]"
  if [[ -n "${FC_RELEASE_ID:-}" ]]; then
    release_id=$FC_RELEASE_ID
  elif [[ -L "$FC_OPT_ROOT/current" ]]; then
    release_id=$(basename "$(readlink -- "$FC_OPT_ROOT/current")")
  fi
  if [[ ! "$release_id" =~ ^[A-Za-z0-9._-]*$ ]]; then
    release_id=""
  fi
  tar_ver=$(tar --version 2>/dev/null | head -n 1 || true)
  if [[ "$postgres_mode" == configured ]]; then
    pg_ver=$("$FC_PG_DUMP" --version 2>/dev/null | head -n 1 || true)
  fi
  created=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  cat > "$work_dir/staging/manifest.json" <<EOF
{
  "formatVersion": 1,
  "createdAt": "$(json_escape "$created")",
  "deploymentId": $(json_string_or_null "$deployment_id"),
  "releaseId": $(json_string_or_null "$release_id"),
  "worlds": ["anarchy", "survival", "peaceful"],
  "directories": $dirs_json,
  "postgresql": {
    "included": $([[ "$postgres_mode" == configured ]] && printf 'true' || printf 'false'),
    "format": $([[ "$postgres_mode" == configured ]] && printf '"custom"' || printf 'null'),
    "dumps": $dumps_json
  },
  "status": "complete",
  "tools": {
    "tar": $(json_string_or_null "$tar_ver"),
    "pgDump": $(json_string_or_null "$pg_ver")
  }
}
EOF
  chmod 640 "$work_dir/staging/manifest.json"
  if grep -E -q '://|FC_ADMIN_AUTH|password=|sessionToken' "$work_dir/staging/manifest.json"; then
    die "manifest failed the secret check"
  fi
}

write_tree_checksums() {
  (
    cd "$work_dir/staging"
    find . -type f ! -name 'checksums.sha256' -print0 | sort -z | xargs -0 -r sha256sum
  ) > "$work_dir/staging/checksums.sha256"
  chmod 640 "$work_dir/staging/checksums.sha256"
}

publish_archive() {
  local stamp=$1 partial final hash sidecar
  final="$FC_BACKUP_DIR/frontier-cubes-${stamp}.tar.gz"
  if [[ -e "$final" || -e "$final.sha256" ]]; then
    die "backup already exists: $(basename "$final")"
  fi
  partial="$work_dir/archive.tar.gz"
  local -a archive_paths=(manifest.json checksums.sha256 worlds)
  if [[ -d "$work_dir/staging/plugins" ]]; then
    archive_paths+=(plugins)
  fi
  if [[ -d "$work_dir/staging/postgres" ]]; then
    archive_paths+=(postgres)
  fi
  "$FC_TAR" -C "$work_dir/staging" -czf "$partial" "${archive_paths[@]}"
  if ! tar -tzf "$partial" >/dev/null; then
    die "archive is not readable"
  fi
  if ! tar -tzf "$partial" | sed 's|^\./||' | grep -qx 'manifest.json'; then
    die "archive is missing manifest.json"
  fi
  hash=$(sha256sum "$partial" | awk '{print $1}')
  [[ "$hash" =~ ^[0-9a-f]{64}$ ]] || die "checksum generation failed"
  sidecar="$work_dir/archive.sha256"
  printf '%s  %s\n' "$hash" "$(basename "$final")" > "$sidecar"
  # The checksum is published first. The archive rename is the completion mark.
  if ! "$FC_MV" -T -- "$sidecar" "$final.sha256"; then
    die "could not publish checksum"
  fi
  chmod 640 "$final.sha256" || true
  if ! "$FC_MV" -T -- "$partial" "$final"; then
    rm -f -- "$final.sha256"
    die "could not publish archive"
  fi
  chmod 640 "$final" "$final.sha256" || true
  if ! (cd "$FC_BACKUP_DIR" && sha256sum -c "$(basename "$final.sha256")") >/dev/null; then
    rm -f -- "$final" "$final.sha256"
    die "published pair failed verification"
  fi
  published=1
  published_archive=$final
}

complete_backup() {
  local archive=$1 sum base dir
  [[ -f "$archive" && ! -L "$archive" ]] || return 1
  sum="$archive.sha256"
  [[ -f "$sum" && ! -L "$sum" ]] || return 1
  base=$(basename "$archive")
  is_backup_name "$base" || return 1
  dir=$(dirname "$archive")
  (cd "$dir" && sha256sum -c "$(basename "$sum")" >/dev/null) || return 1
  tar -tzf "$archive" >/dev/null || return 1
}

apply_retention() {
  local keep=$FC_KEEP
  local backup_real world_real=""
  local -a found=()
  local path base real
  [[ "$keep" =~ ^[0-9]+$ ]] || die "FC_KEEP must be a positive integer"
  (( keep >= 1 )) || die "FC_KEEP must be a positive integer"
  backup_real=$(real_path "$FC_BACKUP_DIR")
  if [[ -d "$FC_WORLD_ROOT" ]]; then
    world_real=$(real_path "$FC_WORLD_ROOT")
  fi
  while IFS= read -r -d '' path; do
    base=$(basename "$path")
    is_backup_name "$base" || continue
    [[ -L "$path" ]] && continue
    real=$(real_path "$path")
    case "$real/" in
      "$backup_real"/*) ;;
      *) die "refusing to consider $base outside the backup directory" ;;
    esac
    if [[ -n "$world_real" ]]; then
      case "$real/" in
        "$world_real"/*) die "refusing to delete world data" ;;
      esac
    fi
    case "$real" in
      /var/lib/frontier-cubes|/var/lib/frontier-cubes/*)
        die "refusing to delete world data"
        ;;
    esac
    complete_backup "$real" || continue
    found+=("$base")
  done < <(find "$FC_BACKUP_DIR" -maxdepth 1 -type f -name 'frontier-cubes-*.tar.gz' -print0)
  if ((${#found[@]} == 0)); then
    return 0
  fi
  mapfile -t found < <(printf '%s\n' "${found[@]}" | sort)
  local count=${#found[@]}
  local extra=$((count - keep))
  local i=0
  while (( i < extra )); do
    base=${found[$i]}
    path="$FC_BACKUP_DIR/$base"
    real=$(real_path "$path")
    case "$real/" in
      "$backup_real"/*) ;;
      *) die "refusing to delete $base" ;;
    esac
    rm -f -- "$real" "$real.sha256"
    i=$((i + 1))
  done
}

stop_running_services() {
  local unit state
  was_running=()
  for unit in "${SERVICES[@]}"; do
    state=$(service_state "$unit")
    if [[ "$state" == "active" || "$state" == "activating" ]]; then
      was_running+=("$unit")
    fi
  done
  if ((${#was_running[@]} == 0)); then
    return 0
  fi
  need_restart=1
  if ! "$FC_SYSTEMCTL" stop "${was_running[@]}"; then
    die "graceful stop failed"
  fi
  for unit in "${was_running[@]}"; do
    state=$(service_state "$unit")
    if [[ "$state" != "inactive" ]]; then
      die "graceful stop failed for $unit"
    fi
  done
}

cmd_backup() {
  local stamp started recover_ok=0 size
  trap backup_cleanup EXIT
  t_origin=$(now_ms)
  load_services
  [[ "$FC_KEEP" =~ ^[0-9]+$ ]] || die "FC_KEEP must be a positive integer"
  (( FC_KEEP >= 1 )) || die "FC_KEEP must be a positive integer"
  [[ "$FC_HEALTH_TIMEOUT" =~ ^[0-9]+$ ]] || die "FC_HEALTH_TIMEOUT must be a whole number of seconds"
  [[ "$FC_HEALTH_INTERVAL" =~ ^[0-9]+$ ]] || die "FC_HEALTH_INTERVAL must be a whole number of seconds"
  stamp=${FC_BACKUP_STAMP:-$(date +%Y-%m-%d_%H%M%S)}
  [[ "$stamp" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{6}$ ]] || die "invalid backup timestamp"
  acquire_lock
  assert_backup_dir_safe
  work_dir=$(mktemp -d "$FC_BACKUP_DIR/.work-XXXXXX")
  chmod 700 "$work_dir"
  require_worlds
  load_database_plan
  t_stop_begin=$(now_ms)
  stop_running_services
  timing_stop_ms=$(( $(now_ms) - t_stop_begin ))
  mark_phase stop-end
  started=$(now_ms)
  copy_worlds
  copy_plugins
  timing_copy_ms=$(( $(now_ms) - started ))
  mark_phase copy-end
  dump_list=()
  plugins_included=0
  if [[ -d "$work_dir/staging/plugins" ]]; then
    plugins_included=1
  fi
  started=$(now_ms)
  if [[ "$postgres_mode" == configured ]]; then
    dump_postgres
  fi
  timing_dump_ms=$(( $(now_ms) - started ))
  mark_phase dump-end
  if recover_services; then
    recover_ok=1
  fi
  started=$(now_ms)
  write_manifest
  write_tree_checksums
  mark_phase compress-begin
  publish_archive "$stamp"
  timing_compress_ms=$(( $(now_ms) - started ))
  mark_phase publish-end
  if [[ "$recover_ok" != 1 ]]; then
    reported=1
    print_timing
    echo "backup: prepared" >&2
    echo "archive: $published_archive" >&2
    echo "checksum: $published_archive.sha256" >&2
    print_service_states >&2
    exit 1
  fi
  apply_retention
  mark_phase retention-end
  size=$(stat -c '%s' "$published_archive")
  reported=1
  print_timing
  echo "backup: success"
  echo "archive: $published_archive"
  echo "size: $size"
  echo "checksum: $published_archive.sha256"
  print_service_states
}

cmd_list() {
  local path base size
  [[ -d "$FC_BACKUP_DIR" ]] || die "backup directory does not exist"
  while IFS= read -r -d '' path; do
    base=$(basename "$path")
    is_backup_name "$base" || continue
    complete_backup "$path" || continue
    size=$(stat -c '%s' "$path")
    echo "$base $size"
  done < <(find "$FC_BACKUP_DIR" -maxdepth 1 -type f -name 'frontier-cubes-*.tar.gz' -print0 | sort -z)
}

cmd_verify() {
  local archive=$1
  local base dir sum tmp checksum_name
  [[ -n "$archive" ]] || die "verify needs an archive path"
  [[ -f "$archive" && ! -L "$archive" ]] || die "archive is not a regular file"
  base=$(basename "$archive")
  is_backup_name "$base" || die "unexpected archive name"
  dir=$(dirname "$archive")
  sum="$archive.sha256"
  [[ -f "$sum" && ! -L "$sum" ]] || die "missing checksum file"
  checksum_name=$(basename -- "$sum")
  if ! (cd "$dir" && sha256sum -c "$checksum_name") >/dev/null; then
    echo "verify: failed" >&2
    exit 1
  fi
  if ! tar -tzf "$archive" >/dev/null; then
    echo "verify: failed" >&2
    exit 1
  fi
  if ! tar -tzf "$archive" | sed 's|^\./||' | grep -qx 'manifest.json'; then
    echo "verify: failed" >&2
    exit 1
  fi
  tmp=$(mktemp -d)
  tar -C "$tmp" -xzf "$archive"
  if ! (cd "$tmp" && sha256sum -c checksums.sha256 >/dev/null); then
    rm -rf -- "$tmp"
    echo "verify: failed" >&2
    exit 1
  fi
  if grep -q '"included": true' "$tmp/manifest.json"; then
    local ok=0 dump
    shopt -s nullglob
    local dumps=( "$tmp"/postgres/*.dump )
    shopt -u nullglob
    for dump in "${dumps[@]}"; do
      if ! "$FC_PG_RESTORE" --list "$dump" >/dev/null; then
        rm -rf -- "$tmp"
        echo "verify: failed" >&2
        exit 1
      fi
      ok=1
    done
    if [[ "$ok" != 1 ]]; then
      rm -rf -- "$tmp"
      echo "verify: failed" >&2
      exit 1
    fi
  fi
  rm -rf -- "$tmp"
  echo "verify: ok"
  echo "archive: $archive"
}

cmd_stage_download() {
  local archive=$1 dest=$2 base real dest_real backup_real owner
  [[ -n "$archive" && -n "$dest" ]] || die "stage-download needs ARCHIVE and DEST_DIR"
  [[ -f "$archive" && ! -L "$archive" ]] || die "archive is not a regular file"
  base=$(basename "$archive")
  is_backup_name "$base" || die "unexpected archive name"
  [[ -f "$archive.sha256" && ! -L "$archive.sha256" ]] || die "missing checksum file"
  [[ -d "$dest" && ! -L "$dest" ]] || die "destination is not a directory"
  acquire_lock
  real=$(real_path "$archive")
  backup_real=$(real_path "$FC_BACKUP_DIR")
  dest_real=$(real_path "$dest")
  case "$real/" in
    "$backup_real"/*) ;;
    *) die "archive is outside the backup directory" ;;
  esac
  case "$dest_real/" in
    "$backup_real"/*|"$backup_real"/)
      die "destination must be outside the backup directory"
      ;;
  esac
  if [[ -d "$FC_WORLD_ROOT" ]]; then
    local world_real
    world_real=$(real_path "$FC_WORLD_ROOT")
    case "$dest_real/" in
      "$world_real"/*|"$world_real"/)
        die "destination must be outside the world root"
        ;;
    esac
  fi
  cp -a -- "$archive" "$dest_real/$base"
  cp -a -- "$archive.sha256" "$dest_real/$base.sha256"
  chmod 640 "$dest_real/$base" "$dest_real/$base.sha256"
  if [[ "$(id -u)" -eq 0 ]]; then
    owner=$(stat -c '%U:%G' "$dest_real")
    chown -- "$owner" "$dest_real/$base" "$dest_real/$base.sha256"
  fi
  echo "download-copy: $dest_real/$base"
  echo "download-checksum: $dest_real/$base.sha256"
}

main() {
  case "${1:-backup}" in
    backup) cmd_backup ;;
    list) cmd_list ;;
    verify)
      shift
      cmd_verify "${1:-}"
      ;;
    stage-download)
      shift
      cmd_stage_download "${1:-}" "${2:-}"
      ;;
    -h|--help|help) usage ;;
    *)
      usage >&2
      exit 2
      ;;
  esac
}

main "$@"
