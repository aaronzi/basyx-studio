#!/usr/bin/env bash
# Runs the smoke tests of the deployment examples side by side against
# $STUDIO_IMAGE, then prints each log in its own group. Fails if one fails.
#   STUDIO_IMAGE=basyx-studio:ci bash .github/scripts/deployment-examples.sh

set -uo pipefail

examples=(time-series signed-app)
logs="${RUNNER_TEMP:-/tmp}"
pids=()

for example in "${examples[@]}"; do
  node "examples/deployment/${example}/smoke-test.mjs" > "${logs}/${example}.log" 2>&1 &
  pids+=("$!")
done

failed=0
for index in "${!examples[@]}"; do
  example="${examples[${index}]}"
  wait "${pids[${index}]}"
  code=$?
  echo "::group::${example} (exit ${code})"
  cat "${logs}/${example}.log"
  echo "::endgroup::"
  if [ "${code}" -ne 0 ]; then
    echo "::error::The ${example} example failed (exit ${code})."
    failed=1
  fi
done

exit "${failed}"
