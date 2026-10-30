#!/usr/bin/env bash
# Side-by-side Ollama that can use the Honeykrisp Vulkan GPU, on port 11435.
# It is the system `ollama` binary plus the Vulkan-enabled llama.cpp build used by
# the GPU benchmark (~/personal/llama.cpp-src). The system service on :11434 is
# not touched. Models are shared read-only from the system store.
#
#   ./ollama-vulkan.sh start | stop | status | logs
set -euo pipefail

DIR="${OLLAMA_VULKAN_DIR:-$HOME/ollama-vulkan}"
BUILD="${LLAMA_BUILD_BIN:-$HOME/personal/llama.cpp-src/llama.cpp/build/bin}"
PORT="${OLLAMA_VULKAN_PORT:-11435}"
PIDFILE="$DIR/pid"
LOG="$DIR/serve.log"

running() { [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; }

case "${1:-status}" in
  start)
    running && { echo "already running (pid $(cat "$PIDFILE")) on :$PORT"; exit 0; }
    [ -f "$BUILD/libggml-vulkan.so" ] || { echo "no Vulkan build at $BUILD" >&2; exit 1; }
    mkdir -p "$DIR/bin" "$DIR/lib/ollama"
    cp -f "$(command -v ollama)" "$DIR/bin/ollama"
    cp -a "$BUILD"/llama-server "$BUILD"/lib*.so* "$DIR/lib/ollama/"
    : > "$LOG"
    # HK_SYSMEM raises Honeykrisp's GPU heap from 50% of RAM to 24 GiB.
    OLLAMA_HOST="127.0.0.1:$PORT" OLLAMA_MODELS=/usr/share/ollama/.ollama/models \
      OLLAMA_VULKAN=1 OLLAMA_IGPU_ENABLE=1 HK_SYSMEM=25769803776 \
      OLLAMA_FLASH_ATTENTION=1 OLLAMA_KV_CACHE_TYPE=q8_0 OLLAMA_NUM_PARALLEL=1 \
      OLLAMA_MAX_LOADED_MODELS=1 OLLAMA_CONTEXT_LENGTH=16384 OLLAMA_KEEP_ALIVE=15m OLLAMA_DEBUG=1 \
      setsid nohup "$DIR/bin/ollama" serve > "$LOG" 2>&1 < /dev/null &
    echo $! > "$PIDFILE"
    sleep 5
    grep -m1 'inference compute' "$LOG" | sed 's/.*msg=//' || echo "started, but no GPU line in $LOG yet"
    ;;
  stop)
    running && { kill "$(cat "$PIDFILE")"; rm -f "$PIDFILE"; echo stopped; } || echo "not running"
    ;;
  status)
    running && echo "running (pid $(cat "$PIDFILE")) on :$PORT" || echo "not running"
    ;;
  logs) tail -n "${2:-50}" "$LOG" ;;
  *) echo "usage: $0 start|stop|status|logs" >&2; exit 2 ;;
esac
