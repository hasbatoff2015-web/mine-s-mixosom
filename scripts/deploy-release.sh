#!/usr/bin/env bash
# Install a packed release, switch /opt/frontier-cubes/current atomically, restart, health-check.
# Does not reload systemd: the units already point at current/dist/server/index.mjs.
# Does not delete world data or the previous release.
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib/release-common.sh
source "$SCRIPT_DIR/lib/release-common.sh"

release_id=
source_path=
while [[ $# -gt 0 ]]; do
  case "$1" in
    --release-id) release_id=${2:-}; shift 2 ;;
    --source) source_path=${2:-}; shift 2 ;;
    --root) FC_OPT_ROOT=${2:-}; shift 2 ;;
    *) die "unknown argument: $1" ;;
  esac
done

[[ -n "$release_id" && -n "$source_path" ]] || die "usage: deploy-release.sh --release-id ID --source DIR_OR_TAR_GZ [--root PATH]"
assert_release_id "$release_id"
assert_not_world "$FC_OPT_ROOT"
assert_not_world "$source_path"

extract_dir=
if [[ -f "$source_path" ]]; then
  extract_dir=$(mktemp -d)
  tar -xzf "$source_path" -C "$extract_dir"
  source_path=$extract_dir
fi

previous_id=$(current_release_id || true)
previous_file_backup=$(read_previous_id || true)
switched=0

restore_previous_link() {
  if [[ -n "$previous_id" ]]; then
    switch_current "$previous_id"
  fi
  if [[ -n "$previous_file_backup" ]]; then
    printf '%s\n' "$previous_file_backup" > "$FC_OPT_ROOT/previous"
  else
    rm -f -- "$FC_OPT_ROOT/previous"
  fi
}

on_fail() {
  local code=$?
  trap - ERR
  echo "deployment of $release_id failed" >&2
  if [[ "$switched" == 1 && -n "$previous_id" ]]; then
    echo "restoring release $previous_id" >&2
    restore_previous_link
    if ! restart_services; then
      echo "restart after restore failed" >&2
    elif health_check; then
      echo "restored release is healthy; deployment still failed" >&2
    else
      echo "restored release failed health-check" >&2
    fi
  elif [[ "$switched" == 1 ]]; then
    echo "no previous release to restore" >&2
  fi
  if [[ -n "$extract_dir" ]]; then
    assert_not_world "$extract_dir"
    rm -rf -- "$extract_dir"
  fi
  exit "$code"
}
trap on_fail ERR

dest=$(node "$RELEASE_OPS" install --root "$FC_OPT_ROOT" --source "$source_path" --release-id "$release_id")
assert_not_world "$dest"
if [[ "$(id -u)" -eq 0 ]]; then
  chown -R root:root "$dest"
  chmod -R a+rX "$dest"
fi

switch_current "$release_id"
switched=1
if [[ -n "$previous_id" && "$previous_id" != "$release_id" ]]; then
  printf '%s\n' "$previous_id" > "$FC_OPT_ROOT/previous"
fi

restart_services
health_check
trap - ERR
if [[ -n "$extract_dir" ]]; then
  assert_not_world "$extract_dir"
  rm -rf -- "$extract_dir"
fi
echo "deployed $release_id"
