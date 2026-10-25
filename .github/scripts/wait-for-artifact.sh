#!/usr/bin/env bash
# Waits until a job of the same run has uploaded an artifact, so that a job
# can prepare everything else while that job still runs. Fails as soon as the
# job ends without the artifact. Needs GH_TOKEN with `actions: read`.
#   bash .github/scripts/wait-for-artifact.sh <artifact name> <job name> [timeout in seconds, default 900]

set -euo pipefail

artifact="${1:?Usage: $0 <artifact name> <job name> [timeout]}"
job="${2:?Usage: $0 <artifact name> <job name> [timeout]}"
deadline=$((SECONDS + ${3:-900}))
run="repos/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}"

while [ "${SECONDS}" -lt "${deadline}" ]; do
  if [ -n "$(gh api "${run}/artifacts?name=${artifact}" --jq '.artifacts[0].id // empty' 2> /dev/null || true)" ]; then
    echo "${artifact} is ready after ${SECONDS} s."
    exit 0
  fi
  conclusion="$(gh api "${run}/jobs?per_page=100" --jq ".jobs[] | select(.name == \"${job}\") | .conclusion // empty" 2> /dev/null || true)"
  if [ -n "${conclusion}" ] && [ "${conclusion}" != "success" ]; then
    echo "::error::${job} ended (${conclusion}) without ${artifact}."
    exit 1
  fi
  if [ "${conclusion}" = "success" ]; then
    # Listed a moment after the job ends at the latest.
    sleep 5
    if [ -n "$(gh api "${run}/artifacts?name=${artifact}" --jq '.artifacts[0].id // empty' 2> /dev/null || true)" ]; then
      exit 0
    fi
    echo "::error::${job} succeeded without uploading ${artifact}."
    exit 1
  fi
  sleep 5
done

echo "::error::${artifact} was not uploaded in time."
exit 1
