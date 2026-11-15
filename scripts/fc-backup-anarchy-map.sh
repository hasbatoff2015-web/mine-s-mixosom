#!/usr/bin/env bash
# Consistent map backup of PROD Anarchy only.
#
# Stops frontier-cubes-anarchy.service, copies that world's map, and starts
# the same unit again. Survival and Peaceful are never stopped, started, or
# copied. PostgreSQL is not read and is not dumped: economy and player rows
# live there, the three env files may point at different databases, and the
# other two game processes keep writing.
#
# The archive contains meta.json, the full world.json, an empty players.json,
# and the map plugin-data used by scripts/clone-world-snapshot.mjs. Original
# player inventories, sessions, economy, and auction files are left on disk
# and are not put in the archive.
#
#   sudo /usr/local/sbin/fc-backup-anarchy-map
#   sudo /usr/local/sbin/fc-backup-anarchy-map verify ARCHIVE
#
# list and verify do not stop the game.
# shellcheck shell=bash

set -euo pipefail
umask 027

: "${FC_BACKUP_DIR:=/var/backups/frontier-cubes}"
: "${FC_ENV_FILE:=/etc/frontier-cubes/anarchy.env}"
: "${FC_SYSTEMCTL:=systemctl}"
: "${FC_NODE:=node}"
: "${FC_TAR:=tar}"
: "${FC_KEEP:=3}"
: "${FC_HEALTH_TIMEOUT:=60}"
: "${FC_HEALTH_INTERVAL:=1}"
: "${FC_STATUS_HOST:=127.0.0.1}"

ANARCHY_UNIT=frontier-cubes-anarchy.service
SURVIVAL_UNIT=frontier-cubes-survival.service
PEACEFUL_UNIT=frontier-cubes-peaceful.service

stopped=0
need_restart=0
services_restarted=0
recovery_attempted=0
published=0
reported=0
work_dir=""
world_dir=""
port=""
server_mode=""
world_id=""
survival_before=""
peaceful_before=""

die() {
  echo "error: $*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
usage: fc-backup-anarchy-map [backup]
       fc-backup-anarchy-map verify ARCHIVE

backup stops only frontier-cubes-anarchy.service, writes one map archive,
and starts that unit again. Survival and Peaceful are not stopped.
verify does not stop the game. PostgreSQL is not dumped.
EOF
}

read_env_value() {
  local file=$1 key=$2 line
  line=$(grep -E "^[[:space:]]*${key}=" "$file" | tail -n 1 || true)
  line=${line%$'\r'}
  line=${line#"${line%%[![:space:]]*}"}
  line=${line#"${key}="}
  line=${line%$'\r'}
  if [[ ${#line} -ge 2 && "$line" == \"*\" && "$line" == *\" ]]; then
    line=${line:1:${#line}-2}
  elif [[ ${#line} -ge 2 && "$line" == \'*\' && "$line" == *\' ]]; then
    line=${line:1:${#line}-2}
  fi
  line=${line%$'\r'}
  printf '%s' "$line"
}

service_state() {
  local unit=$1 state
  state=$("$FC_SYSTEMCTL" is-active "$unit" 2>/dev/null || true)
  printf '%s' "$state"
}

real_path() {
  readlink -f -- "$1"
}

assert_free_space() {
  local avail_kb world_kb need_kb
  avail_kb=$(df -Pk "$FC_BACKUP_DIR" | awk 'NR==2 { print $4 }')
  world_kb=$(du -sk "$world_dir" | awk '{ print $1 }')
  [[ "$avail_kb" =~ ^[0-9]+$ && "$world_kb" =~ ^[0-9]+$ ]] || die "could not measure free space"
  need_kb=$((world_kb * 3 + 65536))
  if (( avail_kb < need_kb )); then
    die "not enough free space on $FC_BACKUP_DIR: have ${avail_kb}KB, need ${need_kb}KB"
  fi
  echo "disk: world_kb=${world_kb} free_kb=${avail_kb} need_kb=${need_kb}"
}

load_anarchy_env() {
  [[ -f "$FC_ENV_FILE" ]] || die "missing $FC_ENV_FILE"
  port=$(read_env_value "$FC_ENV_FILE" PORT)
  server_mode=$(read_env_value "$FC_ENV_FILE" SERVER_MODE)
  world_id=$(read_env_value "$FC_ENV_FILE" WORLD)
  local world_path
  world_path=$(read_env_value "$FC_ENV_FILE" WORLD_PATH)
  [[ -n "$world_path" ]] || world_path=/var/lib/frontier-cubes/worlds
  [[ "$server_mode" == "anarchy" ]] || die "SERVER_MODE in anarchy.env is '$server_mode', expected anarchy"
  [[ "$world_id" == "anarchy" ]] || die "WORLD in anarchy.env is '$world_id', expected anarchy"
  [[ "$port" =~ ^[0-9]+$ && "$port" -ge 1 && "$port" -le 65535 ]] || die "anarchy.env has no usable PORT"
  world_dir=$(real_path "$world_path/$world_id")
  [[ -d "$world_dir" ]] || die "anarchy world directory is missing: $world_dir"
  case "$world_dir" in
    */survival|*/survival/*|*/peaceful|*/peaceful/*)
      die "refusing to read a Survival or Peaceful directory: $world_dir"
      ;;
  esac
  [[ -f "$world_dir/meta.json" && -f "$world_dir/world.json" && -f "$world_dir/players.json" ]] \
    || die "anarchy world is missing meta.json, world.json, or players.json"
  echo "anarchy: port=${port} world=${world_id} mode=${server_mode}"
  echo "postgres: not included (map backup does not read FC_DATABASE_URL)"
}

snapshot_other_units() {
  survival_before=$(service_state "$SURVIVAL_UNIT")
  peaceful_before=$(service_state "$PEACEFUL_UNIT")
  echo "untouched-before: $SURVIVAL_UNIT ${survival_before:-unknown}"
  echo "untouched-before: $PEACEFUL_UNIT ${peaceful_before:-unknown}"
}

assert_other_units_unchanged() {
  local survival_after peaceful_after
  survival_after=$(service_state "$SURVIVAL_UNIT")
  peaceful_after=$(service_state "$PEACEFUL_UNIT")
  if [[ "$survival_after" != "$survival_before" || "$peaceful_after" != "$peaceful_before" ]]; then
    echo "error: Survival or Peaceful changed state during the Anarchy backup" >&2
    echo "untouched-after: $SURVIVAL_UNIT ${survival_after:-unknown} was ${survival_before:-unknown}" >&2
    echo "untouched-after: $PEACEFUL_UNIT ${peaceful_after:-unknown} was ${peaceful_before:-unknown}" >&2
    return 1
  fi
  echo "untouched-after: $SURVIVAL_UNIT ${survival_after:-unknown}"
  echo "untouched-after: $PEACEFUL_UNIT ${peaceful_after:-unknown}"
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

wait_until_ready() {
  local deadline
  [[ "$FC_STATUS_HOST" =~ ^[A-Za-z0-9._-]+$ ]] || die "FC_STATUS_HOST is not a plain host name"
  command -v "$FC_NODE" >/dev/null 2>&1 || die "node is required for the readiness check"
  write_status_checker
  deadline=$((SECONDS + FC_HEALTH_TIMEOUT))
  while true; do
    if "$FC_NODE" "$work_dir/status-check.mjs" \
      "http://${FC_STATUS_HOST}:${port}/status" "$server_mode" "$world_id"; then
      return 0
    fi
    if (( SECONDS >= deadline )); then
      echo "anarchy: readiness timed out" >&2
      return 1
    fi
    sleep "$FC_HEALTH_INTERVAL"
  done
}

stop_anarchy() {
  local state
  state=$(service_state "$ANARCHY_UNIT")
  echo "anarchy-before: ${state:-unknown}"
  if [[ "$state" != "active" && "$state" != "activating" ]]; then
    return 0
  fi
  need_restart=1
  if ! "$FC_SYSTEMCTL" stop "$ANARCHY_UNIT"; then
    die "graceful stop failed for $ANARCHY_UNIT"
  fi
  state=$(service_state "$ANARCHY_UNIT")
  if [[ "$state" != "inactive" ]]; then
    die "graceful stop failed for $ANARCHY_UNIT"
  fi
  stopped=1
  echo "anarchy-stopped: $ANARCHY_UNIT"
}

recover_anarchy() {
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
  if ! "$FC_SYSTEMCTL" start "$ANARCHY_UNIT"; then
    echo "anarchy: restart failed" >&2
    return 1
  fi
  if ! wait_until_ready; then
    echo "anarchy: unhealthy after restart" >&2
    return 1
  fi
  services_restarted=1
  echo "anarchy-ready: http://${FC_STATUS_HOST}:${port}/status"
  return 0
}

write_exporter() {
  cat > "$work_dir/export-map.mjs" <<'EOF'
import { copyFile, cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const source = process.argv[2];
const dest = process.argv[3];
const configKeys = {
  'spawn.json': ['cooldownSeconds', 'warmupSeconds', 'cancelOnMove', 'cancelOnDamage'],
  'rtp.json': ['minX', 'maxX', 'minZ', 'maxZ', 'cooldownSeconds', 'warmupSeconds', 'attemptsPerTick', 'maxAttempts', 'maxChunkGenerates', 'cancelOnMove', 'cancelOnDamage'],
  'world-events.json': ['enabled', 'dailyTime', 'timeZone', 'warningMinutes', 'unlockDelayMinutes', 'durationMinutes', 'spawnMinDistance', 'spawnMaxDistance', 'worldBorder', 'templateName', 'announceCoordinates', 'playerAvoidRadius', 'homeAvoidRadius', 'maxSearchAttempts', 'attemptsPerTick'],
};
const mapJson = [
  'claims/claims.json',
  'holograms/holograms.json',
  'buyers/buyers.json',
  'rtpportal/portals.json',
  'automine/automines.json',
  'mega-zombie/config.json',
  'duels/arena.json',
  'world-events/state.json',
];

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

const CLAIM_PRIORITY_MIN = -1000000;
const CLAIM_PRIORITY_MAX = 1000000;
const ANCHOR_RADIUS = { iron_block: 10, gold_block: 20, diamond_block: 30 };
const MIN_WORLD_Y = 0;
const MAX_WORLD_Y = 255;

function integerVolume(volume) {
  if (!volume || typeof volume !== 'object' || Array.isArray(volume)) return undefined;
  const box = {};
  for (const key of ['minX', 'minY', 'minZ', 'maxX', 'maxY', 'maxZ']) {
    if (typeof volume[key] !== 'number' || !Number.isInteger(volume[key])) return undefined;
    box[key] = volume[key];
  }
  return box;
}

function anchorVolume(anchor) {
  if (!anchor || typeof anchor !== 'object' || Array.isArray(anchor)) return undefined;
  const radius = ANCHOR_RADIUS[anchor.block];
  if (radius === undefined) return undefined;
  const { x, y, z } = anchor;
  if (![x, y, z].every((value) => typeof value === 'number' && Number.isInteger(value))) return undefined;
  return {
    minX: x - radius,
    minY: Math.max(MIN_WORLD_Y, y - radius),
    minZ: z - radius,
    maxX: x + radius,
    maxY: Math.min(MAX_WORLD_Y, y + radius),
    maxZ: z + radius,
  };
}

function serverPriority(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(CLAIM_PRIORITY_MIN, Math.min(CLAIM_PRIORITY_MAX, Math.trunc(value)));
}

function contains(volume, x, y, z) {
  return x >= volume.minX && x <= volume.maxX
    && y >= volume.minY && y <= volume.maxY
    && z >= volume.minZ && z <= volume.maxZ;
}

function loadedClaim(claim, worldId) {
  if (!claim || typeof claim !== 'object' || Array.isArray(claim)) return undefined;
  if (typeof claim.id !== 'string' || typeof claim.name !== 'string' || typeof claim.owner !== 'string') return undefined;
  if (claim.worldId !== worldId) return undefined;
  const stored = integerVolume(claim.volume);
  if (!stored) return undefined;
  return {
    name: claim.name,
    priority: serverPriority(claim.priority),
    flags: claim.flags && typeof claim.flags === 'object' ? claim.flags : {},
    volume: anchorVolume(claim.anchor) ?? stored,
  };
}

// Same rule as flagSetter + effectiveFlag('pvp') in server/services/claims.ts.
// A higher-priority claim that does not store flags.pvp does not beat a lower one that does.
// Equal clamped priority keeps the earlier claim. No explicit setter means the default, false.
function pvpSetter(claims) {
  const setters = [];
  claims.forEach((claim, index) => {
    if (typeof claim.flags?.pvp === 'boolean') setters.push({ claim, index });
  });
  if (setters.length === 0) return undefined;
  setters.sort((left, right) => right.claim.priority - left.claim.priority || left.index - right.index);
  return setters[0].claim;
}

function effectivePvp(claims) {
  const setter = pvpSetter(claims);
  if (!setter) return false;
  return setter.flags.pvp === true;
}

const world = await readJson(path.join(source, 'world.json'));
if (!world || typeof world !== 'object' || !world.modifications || Array.isArray(world.modifications)) {
  throw new Error('world.json has no modifications object');
}
const modificationCount = Object.keys(world.modifications).length;
if (modificationCount === 0) throw new Error('world.json modifications are empty');
const meta = await readJson(path.join(source, 'meta.json'));
if (!Array.isArray(meta.spawn) || meta.spawn.length < 3) throw new Error('meta.json spawn is missing');

await mkdir(dest, { recursive: true });
await copyFile(path.join(source, 'meta.json'), path.join(dest, 'meta.json'));
await copyFile(path.join(source, 'world.json'), path.join(dest, 'world.json'));
await writeJson(path.join(dest, 'players.json'), { players: {} });

const copied = [];
for (const relative of mapJson) {
  const from = path.join(source, 'plugin-data', relative);
  if (!existsSync(from)) continue;
  const raw = await readJson(from);
  let value = raw;
  if (relative === 'buyers/buyers.json') {
    value = { buyers: Array.isArray(raw.buyers) ? raw.buyers : [] };
  } else if (relative === 'world-events/state.json') {
    value = { templates: Array.isArray(raw.templates) ? raw.templates : [] };
  }
  await writeJson(path.join(dest, 'plugin-data', relative), value);
  copied.push(relative);
}
const originals = path.join(source, 'plugin-data', 'automine', 'originals');
if (existsSync(originals)) {
  await cp(originals, path.join(dest, 'plugin-data', 'automine', 'originals'), { recursive: true });
  copied.push('automine/originals/');
}
const configDir = path.join(source, 'plugin-data', 'config');
const skippedConfig = [];
if (existsSync(configDir)) {
  for (const name of await readdir(configDir)) {
    if (!name.endsWith('.json')) continue;
    const raw = await readJson(path.join(configDir, name));
    const allowed = configKeys[name];
    if (!allowed) {
      skippedConfig.push(`config/${name}`);
      continue;
    }
    const kept = {};
    for (const key of allowed) {
      const item = raw[key];
      if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') kept[key] = item;
    }
    if (Object.keys(kept).length === 0) {
      skippedConfig.push(`config/${name}`);
      continue;
    }
    await writeJson(path.join(dest, 'plugin-data', 'config', name), kept);
    copied.push(`config/${name}`);
  }
}

const claimsFile = path.join(dest, 'plugin-data', 'claims', 'claims.json');
const spawnBlock = meta.spawn.slice(0, 3).map((value) => Math.floor(Number(value)));
const review = {
  spawnBlock,
  spawnInsideClaim: false,
  spawnPvp: null,
  spawnPvpSetter: null,
  pvpRule: 'explicit-flag-setter',
  claimsStatus: 'missing',
  explicitPvpClaims: [],
  warnings: [],
};
if (!existsSync(claimsFile)) {
  review.warnings.push('claims.json is missing. The archive has no privates, and clone-world-snapshot.mjs will refuse it.');
} else {
  const store = await readJson(claimsFile);
  const rawClaims = store && typeof store === 'object' && Array.isArray(store.claims) ? store.claims : [];
  if (rawClaims.length === 0) {
    review.claimsStatus = 'empty';
    review.warnings.push('claims.json has no claims. clone-world-snapshot.mjs will refuse this archive.');
  } else {
    const loaded = rawClaims.map((claim) => loadedClaim(claim, meta.worldId)).filter((claim) => claim !== undefined);
    const arena = loaded.filter((claim) => claim.flags.pvp === true);
    review.explicitPvpClaims = arena.map((claim) => ({
      name: claim.name,
      priority: claim.priority,
      volume: claim.volume,
    }));
    const covering = loaded.filter((claim) => contains(claim.volume, spawnBlock[0], spawnBlock[1], spawnBlock[2]));
    const setter = pvpSetter(covering);
    review.spawnInsideClaim = covering.length > 0;
    review.spawnPvp = covering.length > 0 ? effectivePvp(covering) : null;
    review.spawnPvpSetter = setter ? setter.name : null;
    if (arena.length === 0) {
      review.claimsStatus = 'no-arena';
      review.warnings.push('claims.json has no usable arena: no loaded claim has flags.pvp set to true. clone-world-snapshot.mjs will refuse this archive.');
    } else {
      review.claimsStatus = 'ok';
    }
    if (!review.spawnInsideClaim) {
      review.warnings.push(`Spawn block ${spawnBlock.join(',')} is not inside a claim.`);
    } else if (review.spawnPvp === true) {
      review.warnings.push(`Spawn block ${spawnBlock.join(',')} has effective pvp=true.`);
    }
  }
}
await writeJson(path.join(dest, 'map-review.json'), review);
const summary = {
  modificationCount,
  seed: typeof meta.seed === 'string' ? meta.seed : null,
  worldgenVersion: typeof meta.worldgenVersion === 'number' ? meta.worldgenVersion : null,
  spawn: meta.spawn.slice(0, 3),
  copied,
  skippedConfig,
  review,
};
await writeFile(path.join(path.dirname(dest), '..', 'export-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
for (const warning of review.warnings) console.error(`review: ${warning}`);
console.log(`map: modifications=${modificationCount} files=${copied.length}`);
EOF
}

export_map() {
  local dest=$1
  "$FC_NODE" "$work_dir/export-map.mjs" "$world_dir" "$dest"
}

acquire_lock() {
  mkdir -p -- "$FC_BACKUP_DIR"
  chmod 750 "$FC_BACKUP_DIR" || true
  local lock="$FC_BACKUP_DIR/.fc-backup.lock"
  exec 9>"$lock"
  if ! flock -n 9; then
    die "another backup holds $lock"
  fi
  local own="$FC_BACKUP_DIR/.anarchy-map.lock"
  exec 8>"$own"
  if ! flock -n 8; then
    die "another Anarchy map backup is already running"
  fi
}

require_map_files() {
  local archive=$1 listing entry
  listing=$("$FC_TAR" -tzf "$archive" | sed 's|^\./||') || return 1
  for entry in worlds/anarchy/world.json worlds/anarchy/meta.json; do
    if ! grep -qx -- "$entry" <<< "$listing"; then
      echo "error: archive is missing $entry" >&2
      return 1
    fi
  done
}

publish_archive() {
  local stamp=$1 final partial hash
  final="$FC_BACKUP_DIR/frontier-cubes-anarchy-map-${stamp}.tar.gz"
  [[ -e "$final" ]] && die "archive already exists: $final"
  partial="$work_dir/archive.tar.gz.partial"
  "$FC_TAR" -C "$work_dir/staging" -czf "$partial" manifest.json export-summary.json worlds
  if ! require_map_files "$partial"; then
    die "archive is missing a required map file"
  fi
  hash=$(sha256sum "$partial" | awk '{ print $1 }')
  [[ "$hash" =~ ^[0-9a-f]{64}$ ]] || die "checksum generation failed"
  printf '%s  %s\n' "$hash" "$(basename "$final")" > "$work_dir/archive.sha256"
  mv -T -- "$work_dir/archive.sha256" "$final.sha256"
  chmod 640 "$final.sha256" || true
  if ! mv -T -- "$partial" "$final"; then
    rm -f -- "$final.sha256"
    die "could not publish archive"
  fi
  chmod 640 "$final" || true
  if ! (cd "$FC_BACKUP_DIR" && sha256sum -c "$(basename "$final.sha256")") >/dev/null; then
    rm -f -- "$final" "$final.sha256"
    die "published pair failed verification"
  fi
  published=1
  published_archive=$final
}

cleanup() {
  local status=$?
  set +e
  trap - EXIT
  if ! recover_anarchy; then
    status=1
  fi
  if ! assert_other_units_unchanged; then
    status=1
  fi
  if [[ -n "$work_dir" && -d "$work_dir" ]]; then
    rm -rf -- "$work_dir"
  fi
  if [[ "$status" -eq 0 && "$published" == 1 ]]; then
    echo "backup: success"
    echo "archive: ${published_archive:-}"
    echo "checksum: ${published_archive:-}.sha256"
    echo "retention: existing archives were not deleted"
  elif [[ "$published" == 1 ]]; then
    echo "backup: prepared" >&2
    echo "archive: ${published_archive:-}" >&2
    echo "checksum: ${published_archive:-}.sha256" >&2
  else
    echo "backup: failed" >&2
  fi
  exit "$status"
}

cmd_verify() {
  local archive=$1 sum base
  [[ -n "$archive" && -f "$archive" && ! -L "$archive" ]] || die "verify needs a regular archive file"
  base=$(basename "$archive")
  [[ "$base" =~ ^frontier-cubes-anarchy-map-[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{6}\.tar\.gz$ ]] \
    || die "unexpected archive name"
  sum="$archive.sha256"
  [[ -f "$sum" && ! -L "$sum" ]] || die "missing checksum file"
  if ! (cd "$(dirname "$archive")" && sha256sum -c "$(basename "$sum")") >/dev/null; then
    echo "verify: failed" >&2
    exit 1
  fi
  if ! require_map_files "$archive"; then
    echo "verify: failed" >&2
    exit 1
  fi
  echo "verify: ok"
  echo "verify: worlds/anarchy/world.json"
  echo "verify: worlds/anarchy/meta.json"
}

cmd_backup() {
  local stamp summary
  trap cleanup EXIT
  [[ "$FC_KEEP" =~ ^[0-9]+$ && "$FC_KEEP" -ge 1 ]] || die "FC_KEEP must be a positive integer"
  [[ "$FC_HEALTH_TIMEOUT" =~ ^[0-9]+$ ]] || die "FC_HEALTH_TIMEOUT must be a whole number of seconds"
  stamp=${FC_BACKUP_STAMP:-$(date +%Y-%m-%d_%H%M%S)}
  [[ "$stamp" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{6}$ ]] || die "invalid backup timestamp"
  load_anarchy_env
  snapshot_other_units
  mkdir -p -- "$FC_BACKUP_DIR"
  assert_free_space
  acquire_lock
  work_dir=$(mktemp -d "$FC_BACKUP_DIR/.anarchy-map-XXXXXX")
  chmod 700 "$work_dir"
  write_exporter
  stop_anarchy
  mkdir -p -- "$work_dir/staging/worlds"
  export_map "$work_dir/staging/worlds/anarchy"
  summary=$(cat "$work_dir/staging/export-summary.json")
  cat > "$work_dir/staging/manifest.json" <<EOF
{
  "kind": "anarchy-map",
  "world": "anarchy",
  "stoppedUnit": "$ANARCHY_UNIT",
  "postgres": "not-included",
  "players": "empty",
  "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
  publish_archive "$stamp"
  reported=1
  echo "summary: $summary"
  if grep -q '"players": {}' "$work_dir/staging/worlds/anarchy/players.json"; then
    echo "players: empty"
  fi
}

case "${1:-backup}" in
  backup) cmd_backup ;;
  verify) cmd_verify "${2:-}" ;;
  -h|--help|help) usage ;;
  *) usage; exit 1 ;;
esac
