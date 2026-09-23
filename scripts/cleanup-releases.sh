#!/usr/bin/env bash
# List release directories that are neither current nor previous.
# Default is dry-run. --apply deletes only those directories.
# Never deletes current, the recorded previous release, or world data.
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib/release-common.sh
source "$SCRIPT_DIR/lib/release-common.sh"

apply=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --root) FC_OPT_ROOT=${2:-}; shift 2 ;;
    --apply) apply=1; shift ;;
    *) die "unknown argument: $1" ;;
  esac
done

assert_not_world "$FC_OPT_ROOT"
current_id=$(current_release_id || true)
previous_id=$(read_previous_id || true)
[[ -n "$current_id" && -n "$previous_id" ]] || {
  echo "keeping all releases: current and previous must both be recorded"
  exit 0
}

plan=$(node "$RELEASE_OPS" cleanup-plan --root "$FC_OPT_ROOT" --current "$current_id" --previous "$previous_id") || die "cleanup plan failed"
if [[ -z "$plan" ]]; then
  echo "nothing to remove"
  exit 0
fi

while IFS= read -r id; do
  [[ -n "$id" ]] || continue
  assert_release_id "$id"
  [[ "$id" != "$current_id" && "$id" != "$previous_id" ]] || die "refusing to delete $id"
  path="$FC_OPT_ROOT/releases/$id"
  assert_not_world "$path"
  case "$path" in
    "$FC_OPT_ROOT/releases/"*) ;;
    *) die "refusing to delete $path" ;;
  esac
  if [[ "$apply" == 1 ]]; then
    rm -rf -- "$path"
    echo "removed $path"
  else
    echo "would remove $path"
  fi
done <<< "$plan"
