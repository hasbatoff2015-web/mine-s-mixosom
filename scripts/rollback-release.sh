#!/usr/bin/env bash
# Point current at the recorded previous release, restart, and health-check.
# Does not delete releases or world data.
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib/release-common.sh
source "$SCRIPT_DIR/lib/release-common.sh"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --root) FC_OPT_ROOT=${2:-}; shift 2 ;;
    *) die "unknown argument: $1" ;;
  esac
done

assert_not_world "$FC_OPT_ROOT"
current_id=$(current_release_id || true)
target=$(read_previous_id || true)
[[ -n "$current_id" ]] || die "current release is not set"
[[ -n "$target" ]] || die "no previous release recorded"
[[ "$target" != "$current_id" ]] || die "previous release is already current"
assert_release_id "$target"

switched=0
on_fail() {
  local code=$?
  trap - ERR
  echo "rollback to $target failed" >&2
  if [[ "$switched" == 1 ]]; then
    echo "returning current to $current_id" >&2
    switch_current "$current_id"
    printf '%s\n' "$target" > "$FC_OPT_ROOT/previous"
    if ! restart_services; then
      echo "restart after failed rollback failed" >&2
    elif health_check; then
      echo "restored release is healthy; rollback still failed" >&2
    else
      echo "restored release failed health-check" >&2
    fi
  fi
  exit "$code"
}
trap on_fail ERR

switch_current "$target"
switched=1
printf '%s\n' "$current_id" > "$FC_OPT_ROOT/previous"
restart_services
health_check
trap - ERR
echo "rolled back to $target"
