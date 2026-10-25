#!/usr/bin/env bash
# Runs a command in the background of a CI job, so that it overlaps with the
# next steps, and waits for it in a later step with its log and exit code:
#   bash .github/scripts/background.sh start <name> <command>
#   bash .github/scripts/background.sh wait <name> [timeout in seconds, default 600]

set -euo pipefail

name="${2:?Usage: $0 start|wait <name> ...}"
log="${RUNNER_TEMP:-/tmp}/background-${name}.log"
status="${RUNNER_TEMP:-/tmp}/background-${name}.status"

case "${1:-}" in
  start)
    rm -f "${status}"
    nohup bash -c "(${3:?a command}); echo \$? > '${status}'" > "${log}" 2>&1 &
    echo "Started ${name} in the background."
    ;;

  wait)
    for _ in $(seq 1 "${3:-600}"); do
      [ -s "${status}" ] && break
      sleep 1
    done
    echo "::group::${name}"
    cat "${log}"
    echo "::endgroup::"
    code="$(cat "${status}" 2> /dev/null || echo "timeout")"
    if [ "${code}" != "0" ]; then
      echo "::error::${name} did not succeed (${code})."
      exit 1
    fi
    ;;

  *)
    echo "Usage: $0 start|wait <name> ..." >&2
    exit 2
    ;;
esac
