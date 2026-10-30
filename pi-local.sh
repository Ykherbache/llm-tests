#!/usr/bin/env bash
#
# pi-local.sh - start pi without running the machine out of RAM.
#
# Why: on Asahi the Vulkan Ollama (:11435) pins its model in unevictable shared memory
# (`grep Unevictable /proc/meminfo`), and the CPU server on :11434 knows nothing about it.
# A 20 GB model loaded next to a resident 15 GB one gets the kernel OOM-killer to kill Ollama.
# This unloads every resident model on both servers, waits for the memory to come back,
# checks that the model pi will use fits, then runs pi with your arguments.
#
# Usage:
#   ./pi-local.sh [pi arguments]           e.g. ./pi-local.sh -p "list the .ts files"
#   ./pi-local.sh --model ollama/local-qwen35-t6-24k
#   ./pi-local.sh --force ...              start even if the memory check fails
#
# AWS credentials are hidden from pi so only the local models are listed (PI_KEEP_AWS=1 keeps them).
# Without --model the default of ~/.pi/agent/settings.json is used. Models of the
# "ollama-gpu" provider are looked up on the Vulkan server, the others on the CPU one.

set -euo pipefail

CPU_URL="${OLLAMA_CPU_BASE_URL:-http://127.0.0.1:11434}"
GPU_URL="${OLLAMA_BASE_URL:-http://127.0.0.1:11435}"
# Weights + KV cache + compute buffers come to a bit more than the model file.
MARGIN_MB=3072
SETTINGS="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}/settings.json"

die() { echo "pi-local: $*" >&2; exit 1; }

FORCE=0
ARGS=()
MODEL=""
while [ $# -gt 0 ]; do
  case "$1" in
    --force)   FORCE=1 ;;
    --model)   [ $# -ge 2 ] || die "--model needs a value"; MODEL="$2"; ARGS+=("$1" "$2"); shift ;;
    --model=*) MODEL="${1#--model=}"; ARGS+=("$1") ;;
    *)         ARGS+=("$1") ;;
  esac
  shift
done

# Listing or version calls load no model: skip the unloading and the memory check.
PASSTHRU=0
for a in "${ARGS[@]+"${ARGS[@]}"}"; do
  case "$a" in --list-models|--help|-h|--version|-v) PASSTHRU=1 ;; esac
done

if [ "$PASSTHRU" -eq 0 ] && [ -z "$MODEL" ] && [ -f "$SETTINGS" ]; then
  MODEL="$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(d.get("defaultProvider","ollama")+"/"+d.get("defaultModel",""))' "$SETTINGS" 2>/dev/null || true)"
fi
case "$MODEL" in
  */*) PROVIDER="${MODEL%%/*}"; TAG="${MODEL#*/}" ;;
  *)   PROVIDER="ollama"; TAG="$MODEL" ;;
esac
case "$PROVIDER" in ollama-gpu) URL="$GPU_URL" ;; *) URL="$CPU_URL" ;; esac

# Unload what is resident on both servers; a server that is not running is skipped.
unload() {
  local base="$1" names name
  names="$(curl -fsS -m 3 "$base/api/ps" 2>/dev/null | python3 -c 'import sys,json; [print(m.get("name") or m.get("model")) for m in json.load(sys.stdin).get("models",[])]' 2>/dev/null)" || return 0
  for name in $names; do
    echo "pi-local: unloading $name from $base"
    curl -fsS -m 10 "$base/api/generate" -d "{\"model\":\"$name\",\"keep_alive\":0}" >/dev/null 2>&1 || true
  done
}
if [ "$PASSTHRU" -eq 0 ]; then
  unload "$CPU_URL"
  unload "$GPU_URL"
fi

avail_mb() { awk '/^MemAvailable:/ {print int($2 / 1024)}' /proc/meminfo; }

# Size of the model on disk, from the server that will run it.
SIZE_MB=""
if [ "$PASSTHRU" -eq 0 ] && [ -n "$TAG" ]; then
  SIZE_MB="$(curl -fsS -m 3 "$URL/api/tags" 2>/dev/null | python3 -c '
import sys, json
tag = sys.argv[1]
for m in json.load(sys.stdin).get("models", []):
    if m.get("name") in (tag, tag + ":latest"):
        print(int(m["size"] / 1048576))
        break
' "$TAG" 2>/dev/null || true)"
fi

if [ -n "$SIZE_MB" ]; then
  NEED_MB=$((SIZE_MB + MARGIN_MB))
  # Freed GPU memory takes a moment to come back.
  for _ in $(seq 20); do
    [ "$(avail_mb)" -ge "$NEED_MB" ] && break
    sleep 1
  done
  HAVE_MB="$(avail_mb)"
  if [ "$HAVE_MB" -lt "$NEED_MB" ]; then
    echo "pi-local: $TAG needs about $((NEED_MB / 1024)) GB free, only $((HAVE_MB / 1024)) GB available." >&2
    echo "          Close heavy apps (browser, IDE), then retry. Pinned GPU memory: $(awk '/^Unevictable:/ {printf "%d", $2/1048576}' /proc/meminfo) GB." >&2
    [ "$FORCE" -eq 1 ] || exit 1
    echo "pi-local: --force given, starting anyway." >&2
  else
    echo "pi-local: $((HAVE_MB / 1024)) GB available, $TAG needs about $((NEED_MB / 1024)) GB - ok."
  fi
elif [ "$PASSTHRU" -eq 0 ]; then
  echo "pi-local: could not size '${TAG:-the default model}' (server down or unknown tag); skipping the memory check."
fi

# The ambient AWS credentials (AWS_PROFILE...) make pi list ~200 Bedrock models next to the local ones.
# Hide them from pi only; PI_KEEP_AWS=1 keeps them.
if [ -z "${PI_KEEP_AWS:-}" ]; then
  unset AWS_PROFILE AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN AWS_BEARER_TOKEN_BEDROCK \
        AWS_REGION AWS_DEFAULT_REGION AWS_CONTAINER_CREDENTIALS_FULL_URI AWS_CONTAINER_CREDENTIALS_RELATIVE_URI \
        AWS_WEB_IDENTITY_TOKEN_FILE
fi

exec pi "${ARGS[@]}"
