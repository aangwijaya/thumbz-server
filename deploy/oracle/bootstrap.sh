#!/usr/bin/env bash
# Idempotent setup for a fresh Oracle Cloud Ubuntu 22.04 or 24.04 VM:
# Docker Engine + Compose plugin, a small swap when RAM is tight, and
# persistent iptables accepts for TCP 80 and 443.
#
#   sudo bash deploy/oracle/bootstrap.sh
set -euo pipefail

ORACLE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Re-running with sudo."
  exec sudo -- "$0" "$@"
fi

if [[ -r /etc/os-release ]]; then
  # shellcheck disable=SC1091
  . /etc/os-release
  case "${VERSION_ID:-}" in
    22.04 | 24.04) ;;
    *)
      echo "Warning: this script is written for Ubuntu 22.04 and 24.04 (found ${VERSION_ID:-unknown})."
      ;;
  esac
else
  echo "Warning: /etc/os-release is missing. This script expects Ubuntu."
fi

case "$(uname -m)" in
  aarch64 | arm64) ;;
  *)
    echo "Warning: the compose file pins linux/arm64. This machine is $(uname -m)."
    ;;
esac

export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y ca-certificates curl gnupg git

install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc

codename="${VERSION_CODENAME:-}"
if [[ -z "${codename}" && -r /etc/os-release ]]; then
  # shellcheck disable=SC1091
  . /etc/os-release
  codename="${VERSION_CODENAME}"
fi
arch="$(dpkg --print-architecture)"
echo "deb [arch=${arch} signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${codename} stable" \
  > /etc/apt/sources.list.d/docker.list

apt-get update
# Do not let the package save the current ruleset over Oracle's rules.v4.
# A save taken while Docker is running persists Docker's chains and can
# break the next boot. open-web-ports.sh patches the file itself.
echo 'iptables-persistent iptables-persistent/autosave_v4 boolean false' | debconf-set-selections
echo 'iptables-persistent iptables-persistent/autosave_v6 boolean false' | debconf-set-selections
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin iptables iptables-persistent

systemctl enable --now docker

if [[ -n "${SUDO_USER:-}" && "${SUDO_USER}" != "root" ]]; then
  usermod -aG docker "${SUDO_USER}"
  echo "Added ${SUDO_USER} to the docker group. Log out and back in before deploy.sh."
fi

# Redis may fork for an AOF rewrite. Without overcommit that fork is often
# refused and the rewrite fails. Harmless on a VM that only runs this stack.
printf 'vm.overcommit_memory=1\n' > /etc/sysctl.d/99-thumbz-redis.conf
sysctl -w vm.overcommit_memory=1 >/dev/null

ensure_swap() {
  local mem_kb swap_kb
  mem_kb="$(awk '/MemTotal:/ {print $2}' /proc/meminfo)"
  swap_kb="$(awk '/SwapTotal:/ {print $2}' /proc/meminfo)"
  if [[ "${swap_kb}" -gt 0 ]]; then
    echo "Swap already present (${swap_kb} kB). Leaving it."
    return 0
  fi
  # 10 GiB. The 6 GB shape needs swap for the image build; 12 GB and 24 GB do not.
  if [[ "${mem_kb}" -ge 10485760 ]]; then
    echo "RAM is ${mem_kb} kB (10 GiB or more) and there is no swap. Skipping swap."
    return 0
  fi
  echo "RAM is under 10 GiB and there is no swap. Creating a 2 GiB swapfile."
  if [[ ! -f /swapfile ]]; then
    if ! fallocate -l 2G /swapfile; then
      dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
    fi
  fi
  chmod 600 /swapfile
  if ! swapon --show=NAME --noheadings | grep -qx '/swapfile'; then
    mkswap /swapfile
    swapon /swapfile
  fi
  if ! grep -qE '^/swapfile[[:space:]]' /etc/fstab; then
    printf '/swapfile none swap sw 0 0\n' >> /etc/fstab
  fi
  printf 'vm.swappiness=10\n' > /etc/sysctl.d/99-thumbz-swap.conf
  sysctl -w vm.swappiness=10 >/dev/null
  echo "Swap is on. It is used for image-build spikes, not for steady traffic."
}

ensure_swap

install -m 0755 "${ORACLE_DIR}/open-web-ports.sh" /usr/local/sbin/thumbz-open-web-ports
install -m 0644 "${ORACLE_DIR}/thumbz-firewall.service" /etc/systemd/system/thumbz-firewall.service
systemctl daemon-reload
systemctl enable thumbz-firewall.service
systemctl restart thumbz-firewall.service

echo
echo "Bootstrap finished."
echo "Next: copy deploy/oracle/.env.example to deploy/oracle/.env, fill it in, then bash deploy/oracle/deploy.sh"
