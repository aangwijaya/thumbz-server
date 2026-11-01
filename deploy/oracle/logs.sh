#!/usr/bin/env bash
# Tail the stack. Follows when stdout is a terminal.
#   bash deploy/oracle/logs.sh
#   bash deploy/oracle/logs.sh api worker
set -euo pipefail

ORACLE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "${ORACLE_DIR}/lib.sh"

require_docker
require_env_file
read_tunnel_flag

args=(logs --tail=200)
if [[ -t 1 ]]; then
  args+=(--follow)
fi
compose "${args[@]}" "$@"
