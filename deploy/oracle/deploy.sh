#!/usr/bin/env bash
# Pull the checked-out branch, build the image on this VM, run Prisma
# migrations, and recreate the stack. Tags the previous image as
# thumbz-server:rollback first. If the new API does not become healthy,
# the previous image is restored.
#
#   bash deploy/oracle/deploy.sh
#   DEPLOY_BRANCH=main bash deploy/oracle/deploy.sh
set -euo pipefail

ORACLE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "${ORACLE_DIR}/lib.sh"

require_docker
require_env_file
read_tunnel_flag

if [[ "${EUID}" -eq 0 ]]; then
  echo "Warning: running deploy as root. Prefer the user that owns the git checkout (usually ubuntu)."
fi

cd "${REPO_ROOT}"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "The working tree has local changes. Commit, stash, or discard them before deploying." >&2
  exit 1
fi

branch="${DEPLOY_BRANCH:-}"
if [[ -z "${branch}" ]]; then
  branch="$(git rev-parse --abbrev-ref HEAD)"
fi
if [[ "${branch}" == "HEAD" ]]; then
  echo "Detached HEAD. Check out a branch, or set DEPLOY_BRANCH=main." >&2
  exit 1
fi

git rev-parse HEAD > "${PREVIOUS_SHA_FILE}"

avail_kb="$(df -Pk "${REPO_ROOT}" | awk 'NR==2 {print $4}')"
if [[ "${avail_kb}" -lt 4000000 ]]; then
  echo "Warning: under 4 GB free on this disk. The image build may fail. Prune old images or grow the boot volume."
fi

if [[ -f /usr/local/sbin/thumbz-open-web-ports ]] && command -v cmp >/dev/null 2>&1; then
  if ! cmp -s "${ORACLE_DIR}/open-web-ports.sh" /usr/local/sbin/thumbz-open-web-ports; then
    echo "Note: the firewall script in git differs from /usr/local/sbin/thumbz-open-web-ports."
    echo "      Re-apply it with: sudo bash deploy/oracle/bootstrap.sh"
  fi
fi

echo "Fetching origin/${branch}."
git fetch --prune origin
git checkout "${branch}"
git pull --ff-only origin "${branch}"
echo "Deploying $(git rev-parse --short HEAD) (previous $(cut -c1-12 "${PREVIOUS_SHA_FILE}"))."

if docker image inspect "${APP_IMAGE}" >/dev/null 2>&1; then
  docker tag "${APP_IMAGE}" "${ROLLBACK_IMAGE}"
  echo "Tagged the current image as ${ROLLBACK_IMAGE}."
fi

fail_release() {
  echo "Release failed." >&2
  if docker image inspect "${ROLLBACK_IMAGE}" >/dev/null 2>&1; then
    echo "Restoring ${ROLLBACK_IMAGE}." >&2
    # shellcheck disable=SC1091
    bash "${ORACLE_DIR}/rollback.sh" || echo "Rollback did not finish cleanly. See: bash deploy/oracle/logs.sh api" >&2
  else
    echo "No previous image to restore (this was the first deploy)." >&2
    compose ps >&2 || true
    compose logs --tail=80 migrate api >&2 || true
  fi
  exit 1
}

echo "Building ${APP_IMAGE} for linux/arm64."
compose build

if ! compose up -d --remove-orphans --force-recreate; then
  fail_release
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
  echo "API did not pass /health/live within about 3 minutes." >&2
  fail_release
fi

echo "API /health/live is ok."
docker image prune -f >/dev/null
docker builder prune -f --filter until=168h >/dev/null || true
echo "Deploy finished. After DNS points at this VM: curl -fsS https://<API_DOMAIN>/health"
echo "Logs: bash deploy/oracle/logs.sh"
