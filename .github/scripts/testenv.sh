#!/usr/bin/env bash
# The test environment (test-setup/) in CI. `start` boots it in the
# background, so it comes up while the job installs dependencies; `wait`
# blocks until its services are healthy:
#   bash .github/scripts/testenv.sh start
#   bash .github/scripts/testenv.sh wait

set -euo pipefail

compose_file=test-setup/docker-compose.yaml
background=.github/scripts/background.sh

case "${1:-}" in
  start)
    # The issuer must resolve to the same address on the runner and, via
    # host-gateway, inside the BaSyx containers (see test-setup/README.md).
    echo "127.0.0.1 keycloak.localhost" | sudo tee -a /etc/hosts > /dev/null
    bash "${background}" start testenv "docker compose -f ${compose_file} up -d"
    ;;

  wait)
    bash "${background}" wait testenv 300
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
