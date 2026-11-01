#!/usr/bin/env bash
# Shared paths for the Oracle deploy scripts. Source this; do not execute it.
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  echo "Source this file; do not execute it." >&2
  exit 1
fi

ORACLE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC2034 # sourced API for deploy.sh
REPO_ROOT="$(cd "${ORACLE_DIR}/../.." && pwd)"
COMPOSE_FILE="${ORACLE_DIR}/compose.yaml"
TUNNEL_FILE="${ORACLE_DIR}/compose.tunnel.yaml"
ENV_FILE="${ORACLE_DIR}/.env"
# shellcheck disable=SC2034 # sourced API for deploy.sh / rollback.sh
PREVIOUS_SHA_FILE="${ORACLE_DIR}/.previous-sha"
# Keep in sync with the image: field in compose.yaml.
# shellcheck disable=SC2034
APP_IMAGE="thumbz-server:oracle"
# shellcheck disable=SC2034
ROLLBACK_IMAGE="thumbz-server:rollback"
ORACLE_TUNNEL=0

read_tunnel_flag() {
  ORACLE_TUNNEL=0
  if [[ -f "${ENV_FILE}" ]] && grep -qE '^[[:space:]]*ORACLE_TUNNEL=1[[:space:]]*$' "${ENV_FILE}"; then
    ORACLE_TUNNEL=1
  fi
}

compose() {
  local -a files=(-f "${COMPOSE_FILE}")
  if [[ "${ORACLE_TUNNEL}" == "1" ]]; then
    files+=(-f "${TUNNEL_FILE}")
  fi
  docker compose --env-file "${ENV_FILE}" "${files[@]}" "$@"
}

require_env_file() {
  if [[ ! -f "${ENV_FILE}" ]]; then
    echo "Missing ${ENV_FILE}." >&2
    echo "Copy deploy/oracle/.env.example to deploy/oracle/.env and fill in the CHANGE values." >&2
    exit 1
  fi
}

require_docker() {
  if ! docker compose version >/dev/null 2>&1; then
    echo "docker compose is not available. Run: sudo bash deploy/oracle/bootstrap.sh" >&2
    exit 1
  fi
}
