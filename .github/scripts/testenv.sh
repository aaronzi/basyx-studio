#!/usr/bin/env bash
# The test environment (test-setup/) in CI. `start` boots it in the
# background, so it comes up while the job installs dependencies; `wait`
# blocks until its services are healthy:
#   bash .github/scripts/testenv.sh start
#   bash .github/scripts/testenv.sh wait

set -euo pipefail

compose_file=test-setup/docker-compose.yaml
log="${RUNNER_TEMP:-/tmp}/testenv-up.log"
status="${RUNNER_TEMP:-/tmp}/testenv-up.status"

case "${1:-}" in
  start)
    # The issuer must resolve to the same address on the runner and, via
    # host-gateway, inside the BaSyx containers (see test-setup/README.md).
    echo "127.0.0.1 keycloak.localhost" | sudo tee -a /etc/hosts > /dev/null
    rm -f "${status}"
    nohup bash -c "docker compose -f ${compose_file} up -d > '${log}' 2>&1; echo \$? > '${status}'" > /dev/null 2>&1 &
    echo "Starting the test environment in the background."
    ;;

  wait)
    for _ in $(seq 1 300); do
      [ -s "${status}" ] && break
      sleep 1
    done
    cat "${log}"
    if [ "$(cat "${status}" 2> /dev/null)" != "0" ]; then
      echo "docker compose up did not succeed."
      exit 1
    fi
    for service in postgres keycloak basyx-open basyx-secured; do
      container="$(docker compose -f "${compose_file}" ps -q "${service}")"
      for attempt in $(seq 1 90); do
        health="$(docker inspect -f '{{.State.Health.Status}}' "${container}")"
        if [ "${health}" = "healthy" ]; then
          echo "${service} is healthy"
          break
        fi
        if [ "${attempt}" -eq 90 ]; then
          echo "${service} did not become healthy (status: ${health})"
          exit 1
        fi
        sleep 2
      done
    done
    ;;

  *)
    echo "Usage: $0 start|wait" >&2
    exit 2
    ;;
esac
