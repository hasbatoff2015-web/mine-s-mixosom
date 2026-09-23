# Shared by the release scripts. Does not read or write world data.
# shellcheck shell=bash

COMMON_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_DIR=$(cd "$COMMON_DIR/../.." && pwd)
RELEASE_OPS="$REPO_DIR/scripts/release-ops.mjs"
HEALTH_SCRIPT="$REPO_DIR/scripts/check-game-servers.mjs"

: "${FC_OPT_ROOT:=/opt/frontier-cubes}"
: "${FC_SYSTEMCTL:=systemctl}"
: "${FC_HEALTH_TIMEOUT:=60}"
: "${FC_HEALTH_INTERVAL:=1}"

WORLD_DATA_ROOT=/var/lib/frontier-cubes
SERVICES=(
  frontier-cubes-anarchy.service
  frontier-cubes-survival.service
  frontier-cubes-peaceful.service
)

die() {
  echo "error: $*" >&2
  exit 1
}

assert_not_world() {
  local path="$1"
  case "$path" in
    "$WORLD_DATA_ROOT"|"$WORLD_DATA_ROOT"/*)
      die "refusing to touch world data: $path"
      ;;
  esac
}

assert_release_id() {
  local id="$1"
  if [[ ! "$id" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$ ]]; then
    die "invalid release id: $id"
  fi
}

switch_current() {
  local id="$1"
  local root="$FC_OPT_ROOT"
  local target="$root/releases/$id"
  assert_release_id "$id"
  assert_not_world "$root"
  assert_not_world "$target"
  [[ -f "$target/dist/server/index.mjs" ]] || die "release $id has no dist/server/index.mjs"
  [[ -f "$target/node_modules/ws/package.json" ]] || die "release $id has no node_modules/ws"
  if [[ -L "$root/current.new" ]]; then
    rm -f -- "$root/current.new"
  elif [[ -e "$root/current.new" ]]; then
    die "refusing to replace non-symlink $root/current.new"
  fi
  ln -s "$target" "$root/current.new"
  mv -Tf "$root/current.new" "$root/current"
}

current_release_id() {
  local root="$FC_OPT_ROOT"
  [[ -L "$root/current" ]] || return 0
  basename "$(readlink "$root/current")"
}

read_previous_id() {
  local file="$FC_OPT_ROOT/previous"
  [[ -f "$file" ]] || return 0
  tr -d '[:space:]' < "$file"
}

restart_services() {
  "$FC_SYSTEMCTL" restart "${SERVICES[@]}"
}

run_health_once() {
  if [[ -n "${FC_HEALTHCHECK:-}" ]]; then
    bash -c "$FC_HEALTHCHECK"
  else
    node "$HEALTH_SCRIPT"
  fi
}

health_check() {
  local start=$SECONDS
  while true; do
    if run_health_once; then
      return 0
    fi
    if (( SECONDS - start >= FC_HEALTH_TIMEOUT )); then
      echo "health-check failed" >&2
      return 1
    fi
    sleep "$FC_HEALTH_INTERVAL"
  done
}
