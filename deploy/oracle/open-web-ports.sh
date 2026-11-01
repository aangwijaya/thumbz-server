#!/usr/bin/env bash
# Open TCP 80 and 443 on an Oracle Cloud Ubuntu image, and keep them open.
#
# The VCN security list is not enough. The image ships an iptables ruleset
# that accepts SSH and REJECTS everything else, and iptables-persistent
# restores /etc/iptables/rules.v4 (and rules.v6) on every boot.
#
# Docker publishes 80/443 via the userland proxy, which is an INPUT-chain
# listener, so those INPUT rejects are what black-hole the site. DOCKER-USER
# accepts are added too, for the iptables-DNAT path. They are applied live
# only: writing a DOCKER-USER rule into rules.v4 makes iptables-restore fail
# at boot (the chain does not exist yet) and can take SSH down with it.
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root: sudo bash deploy/oracle/open-web-ports.sh" >&2
  exit 1
fi

PORTS=(80 443)

chain_exists() {
  local bin="$1"
  local chain="$2"
  "$bin" -nL "$chain" >/dev/null 2>&1
}

rule_present() {
  local bin="$1"
  local chain="$2"
  local port="$3"
  "$bin" -C "$chain" -p tcp -m state --state NEW -m tcp --dport "${port}" -j ACCEPT >/dev/null 2>&1
}

add_live_rule() {
  local bin="$1"
  local chain="$2"
  local port="$3"
  if ! chain_exists "$bin" "$chain"; then
    return 0
  fi
  if rule_present "$bin" "$chain" "${port}"; then
    return 0
  fi
  "$bin" -I "$chain" 1 -p tcp -m state --state NEW -m tcp --dport "${port}" -j ACCEPT
  echo "Added ${bin} ${chain} accept for tcp/${port}."
}

wait_for_chain() {
  local bin="$1"
  local chain="$2"
  local i
  for ((i = 0; i < 15; i++)); do
    if chain_exists "$bin" "$chain"; then
      return 0
    fi
    sleep 1
  done
  return 1
}

apply_live() {
  local bin="$1"
  local wait_docker="${2:-0}"
  local port
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "${bin} is not installed; skipping."
    return 0
  fi
  for port in "${PORTS[@]}"; do
    add_live_rule "$bin" INPUT "${port}"
  done
  # IPv4 waits briefly for dockerd to create DOCKER-USER. IPv6 does not:
  # Docker leaves ip6tables alone unless IPv6 is enabled, and a wait on
  # every boot would just burn 15 seconds.
  if chain_exists "$bin" DOCKER-USER; then
    for port in "${PORTS[@]}"; do
      add_live_rule "$bin" DOCKER-USER "${port}"
    done
  elif [[ "${wait_docker}" == "1" ]] && wait_for_chain "$bin" DOCKER-USER; then
    for port in "${PORTS[@]}"; do
      add_live_rule "$bin" DOCKER-USER "${port}"
    done
  else
    echo "${bin}: DOCKER-USER is absent. INPUT accepts for 80/443 still apply."
  fi
}

# Insert an ACCEPT before the INPUT REJECT. A rule after REJECT never runs.
patch_rules_file() {
  local file="$1"
  local restore_bin="$2"
  local tmp next port rule
  if [[ ! -f "${file}" ]]; then
    echo "No ${file}. The thumbz-firewall service re-applies the live rules on boot."
    return 0
  fi
  tmp="$(mktemp)"
  cp -a "${file}" "${tmp}"
  for port in "${PORTS[@]}"; do
    if grep -Eq -- "--dport ${port}([^0-9]|$)" "${tmp}"; then
      continue
    fi
    rule="-A INPUT -p tcp -m state --state NEW -m tcp --dport ${port} -j ACCEPT"
    next="$(mktemp)"
    if grep -q -- '-A INPUT -j REJECT' "${tmp}"; then
      awk -v rule="${rule}" '
        !done && index($0, "-A INPUT -j REJECT") { print rule; done = 1 }
        { print }
      ' "${tmp}" > "${next}"
    elif grep -qE '^COMMIT$' "${tmp}"; then
      awk -v rule="${rule}" '
        !done && $0 ~ /^COMMIT$/ { print rule; done = 1 }
        { print }
        END { if (!done) print rule }
      ' "${tmp}" > "${next}"
    else
      cp "${tmp}" "${next}"
      printf '%s\n' "${rule}" >> "${next}"
    fi
    mv "${next}" "${tmp}"
    echo "Patched ${file} with an accept for tcp/${port}."
  done
  if cmp -s "${file}" "${tmp}"; then
    rm -f "${tmp}"
    echo "${file} already allows tcp/80 and tcp/443."
    return 0
  fi
  if command -v "${restore_bin}" >/dev/null 2>&1; then
    if ! "${restore_bin}" --test < "${tmp}"; then
      echo "Refusing to write ${file}: ${restore_bin} --test failed. Live rules were still applied." >&2
      rm -f "${tmp}"
      return 1
    fi
  fi
  if [[ ! -f "${file}.bak-thumbz" ]]; then
    cp -a "${file}" "${file}.bak-thumbz"
    echo "Backed up the original to ${file}.bak-thumbz."
  fi
  cat "${tmp}" > "${file}"
  rm -f "${tmp}"
  echo "Updated ${file}. It is restored on boot by iptables-persistent."
}

apply_live iptables 1
apply_live ip6tables 0
patch_rules_file /etc/iptables/rules.v4 iptables-restore
patch_rules_file /etc/iptables/rules.v6 ip6tables-restore
