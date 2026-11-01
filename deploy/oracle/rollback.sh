#!/usr/bin/env bash
# Recreate the API and the worker from thumbz-server:rollback.
# deploy.sh tags that image before each build.
#
# Prisma migrations are not reversed. If the failed deploy already applied
# a migration, the restored image has to tolerate that schema.
set -euo pipefail

ORACLE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "${ORACLE_DIR}/lib.sh"

require_docker
require_env_file
read_tunnel_flag

if ! docker image inspect "${ROLLBACK_IMAGE}" >/dev/null 2>&1; then
  echo "No ${ROLLBACK_IMAGE} image. Deploy at least once before rolling back." >&2
  exit 1
fi

docker tag "${ROLLBACK_IMAGE}" "${APP_IMAGE}"
echo "Pointed ${APP_IMAGE} at ${ROLLBACK_IMAGE}."

# --no-deps: do not run migrate again, and do not recreate Redis.
compose up -d --no-build --force-recreate --no-deps api worker

if [[ "${ORACLE_TUNNEL}" != "1" ]]; then
  if compose ps --status running --services 2>/dev/null | grep -qx caddy; then
    compose restart caddy
  fi
fi

attempt=1
healthy=0
while [[ "${attempt}" -le 36 ]]; do
  if compose exec -T api node -e "fetch('http://127.0.0.1:3001/health/live').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then
    healthy=1
    break
  fi
  sleep 5
  attempt=$((attempt + 1))
done

if [[ "${healthy}" -ne 1 ]]; then
  echo "The restored API did not pass /health/live. See: bash deploy/oracle/logs.sh api" >&2
  exit 1
fi

echo "API /health/live is ok on the restored image."
if [[ -f "${PREVIOUS_SHA_FILE}" ]]; then
  previous="$(tr -d '[:space:]' < "${PREVIOUS_SHA_FILE}")"
  echo "Git commit recorded before the last deploy: ${previous}"
  echo "The git checkout is unchanged. Migrations from the newer deploy were not rolled back."
fi
