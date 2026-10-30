#!/usr/bin/env bash
#
# wired-limit.sh - raise the macOS GPU "wired" memory cap.
#
# Why: macOS only lets the GPU wire roughly 65-75% of physical RAM by default.
# On a 32 GB machine that is ~21-24 GB, which a 22 GB model plus KV cache will
# hit. When it does, llama.cpp either spills to CPU (10x slower) or refuses to
# load.
#
# Usage:
#   ./wired-limit.sh            set 26624 MB (sane ceiling for 32 GB)
#   ./wired-limit.sh 20480      set a specific value in MB
#   ./wired-limit.sh --show     print current value and the default
#   ./wired-limit.sh --reset    back to the system default (0)
#
# WARNING: setting this too high can hard-freeze macOS when another app asks
# for memory. Leave at least 4-6 GB for the OS.

set -euo pipefail

if [ "$(uname -s)" != Darwin ]; then
  echo "wired-limit.sh is macOS only (detected $(uname -s))." >&2
  echo "On Asahi Linux the equivalent is Mesa's HK_SYSMEM (Honeykrisp reports only 50% of RAM" >&2
  echo "as GPU heap by default). Set Environment=\"HK_SYSMEM=<bytes>\" on the ollama service." >&2
  exit 1
fi

DEFAULT_MB=26624
TOTAL_MB=$(( $(sysctl -n hw.memsize) / 1024 / 1024 ))

current() { sysctl -n iogpu.wired_limit_mb 2>/dev/null || echo 0; }

show() {
  local cur total_gb
  cur="$(current)"
  total_gb=$(( TOTAL_MB / 1024 ))
  echo "physical RAM        : ${total_gb} GB"
  echo "system default cap  : ~$(( TOTAL_MB * 70 / 100 )) MB  (65-75% of RAM)"
  if [ "$cur" -eq 0 ]; then
    echo "iogpu.wired_limit_mb: 0  (system default)"
  else
    echo "iogpu.wired_limit_mb: ${cur} MB ($(( cur * 100 / TOTAL_MB )) % of RAM)"
  fi
}

case "${1:-}" in
  -h|--help) sed -n '3,17p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
  --show)    show; exit 0 ;;
  --reset)
    echo "Resetting iogpu.wired_limit_mb to 0 (system default)..."
    sudo sysctl -w iogpu.wired_limit_mb=0
    echo "Done for this boot."
    exit 0
    ;;
  "")  MB="$DEFAULT_MB" ;;
  *[!0-9]*) echo "error: expected a number of megabytes, got '$1'" >&2; exit 1 ;;
  *)   MB="$1" ;;
esac

if [ "$MB" -lt 4096 ]; then
  echo "error: $MB MB is below the minimum useful value" >&2
  exit 1
fi
if [ "$MB" -gt $(( TOTAL_MB - 4096 )) ]; then
  cat >&2 <<EOF
error: $MB MB is too close to the ${TOTAL_MB} MB of physical RAM.
       Leave at least ~4 GB for macOS itself (max $(( TOTAL_MB - 4096 )) MB here).
       Going over this is a reliable way to hard-freeze the machine.
EOF
  exit 1
fi

show
echo
echo "Setting iogpu.wired_limit_mb=${MB} MB ..."
sudo sysctl -w iogpu.wired_limit_mb="$MB"

cat <<'EOF'

Note: this setting does not survive a reboot.
To persist it, create a LaunchDaemon:

  sudo tee /Library/LaunchDaemons/local.iogpu.wiredlimit.plist >/dev/null <<'PLIST'
  <?xml version="1.0" encoding="UTF-8"?>
  <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
    "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
  <plist version="1.0">
  <dict>
    <key>Label</key><string>local.iogpu.wiredlimit</string>
    <key>ProgramArguments</key>
    <array>
      <string>/usr/sbin/sysctl</string>
      <string>-w</string>
      <string>iogpu.wired_limit_mb=VALUE</string>
    </array>
    <key>RunAtLoad</key><true/>
  </dict>
  </plist>
  PLIST

  # then replace VALUE with the number above and load it:
  sudo launchctl bootstrap system /Library/LaunchDaemons/local.iogpu.wiredlimit.plist

If anything feels slow afterwards, reset with:  ./wired-limit.sh --reset
EOF
