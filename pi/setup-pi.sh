#!/usr/bin/env bash
#
# pi/setup-pi.sh - set up pi with the local models on a new machine.
#
#   1. installs pi if it is missing (--install-pi)
#   2. pulls the base models and creates the pi aliases in Ollama (24k context; CPU and -gpu0)
#   3. copies pi/models.json and pi/settings.json into ~/.pi/agent (existing files are backed up)
#   4. prints the shell alias that starts pi through pi-local.sh
#
# Usage:
#   ./pi/setup-pi.sh                         everything, for all four models
#   ./pi/setup-pi.sh --only qwen35,coder     only these models (coder, qwen35, lfm24, moe26)
#   ./pi/setup-pi.sh --install-pi            also install pi (npm, into ~/.local)
#   ./pi/setup-pi.sh --force                 recreate aliases that already exist
#   ./pi/setup-pi.sh --dry-run               print what would happen, change nothing
#
# The model files are large (14-21 GB each); models.env has the exact sizes. Run it with Ollama running.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$HERE")"
REGISTRY="$ROOT/models.env"
PI_DIR="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
THREADS=6
CTX=24576

ONLY="coder,qwen35,lfm24,moe26"
FORCE=0
DRY=0
INSTALL_PI=0

die()  { echo "setup-pi: $*" >&2; exit 1; }
info() { echo "  $*"; }
run()  { if [ "$DRY" -eq 1 ]; then echo "  [dry-run] $*"; else "$@"; fi; }

while [ $# -gt 0 ]; do
  case "$1" in
    --only)        [ $# -ge 2 ] || die "--only needs a value"; ONLY="$2"; shift ;;
    --force)       FORCE=1 ;;
    --dry-run|-n)  DRY=1 ;;
    --install-pi)  INSTALL_PI=1 ;;
    -h|--help)     sed -n '3,17p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)             die "unknown option '$1' (try --help)" ;;
  esac
  shift
done

# Registry key and Ollama renderer/parser per short name (renderer empty = the GGUF's own template).
key_of()      { case "$1" in coder) echo CODER ;; qwen35) echo QWEN35 ;; lfm24) echo LFM24 ;; moe26) echo MOE26 ;; *) die "unknown model '$1'" ;; esac; }
renderer_of() { case "$1" in coder) echo qwen3-coder ;; qwen35) echo qwen3.5 ;; lfm24) echo "" ;; moe26) echo gemma4 ;; esac; }
ref_of()      { awk -F'|' -v k="$1" '$1 == k {print $2}' "$REGISTRY"; }

# ---------------------------------------------------------------- pi itself ----
echo "==> pi"
if command -v pi >/dev/null 2>&1; then
  info "found $(command -v pi)"
elif [ "$INSTALL_PI" -eq 1 ]; then
  command -v npm >/dev/null 2>&1 || die "npm is needed to install pi (Node 20+)"
  run npm install -g --ignore-scripts --prefix "$HOME/.local" @earendil-works/pi-coding-agent
  info "make sure ~/.local/bin is on your PATH"
else
  info "pi is not installed: re-run with --install-pi, or:"
  info "  npm install -g --ignore-scripts --prefix ~/.local @earendil-works/pi-coding-agent"
fi

# ------------------------------------------------------------------ aliases ----
echo "==> Ollama aliases (num_thread $THREADS, num_ctx $CTX)"
if [ "$DRY" -eq 0 ]; then
  command -v ollama >/dev/null 2>&1 || die "ollama is not installed - run ./setup.sh first"
  ollama list >/dev/null 2>&1 || die "Ollama is not answering - start it first (systemctl start ollama / ollama serve)"
fi

# make_alias NAME REF RENDERER [extra Modelfile lines...]
make_alias() {
  local name="$1" ref="$2" renderer="$3"; shift 3
  if [ "$DRY" -eq 0 ] && [ "$FORCE" -eq 0 ] && ollama list | awk 'NR > 1 {print $1}' | grep -Fxq "$name:latest"; then
    info "$name exists, skipping (--force recreates it)"
    return
  fi
  local tmp; tmp="$(mktemp)"
  {
    printf 'FROM %s\n' "$ref"
    [ -z "$renderer" ] || printf 'RENDERER %s\nPARSER %s\n' "$renderer" "$renderer"
    printf 'PARAMETER num_thread %s\nPARAMETER num_ctx %s\n' "$THREADS" "$CTX"
    for line in "$@"; do printf '%s\n' "$line"; done
  } > "$tmp"
  if [ "$DRY" -eq 1 ]; then
    info "[dry-run] ollama create $name:"; sed 's/^/        /' "$tmp"
  else
    ollama create "$name" -f "$tmp" >/dev/null && info "created $name"
  fi
  rm -f "$tmp"
}

for short in $(printf '%s' "$ONLY" | tr ',' ' '); do
  key="$(key_of "$short")"
  ref="$(ref_of "$key")"
  [ -n "$ref" ] || die "$key is not in $REGISTRY"
  renderer="$(renderer_of "$short")"
  if [ "$DRY" -eq 0 ] && ! ollama list | awk 'NR > 1 {print $1}' | grep -Fxq "$ref"; then
    info "pulling $ref"
    ollama pull "$ref"
  elif [ "$DRY" -eq 1 ]; then
    info "[dry-run] ollama pull $ref (if missing)"
  fi
  make_alias "local-$short-t$THREADS-24k"      "$ref" "$renderer"
  make_alias "local-$short-t$THREADS-24k-gpu0" "$ref" "$renderer" "PARAMETER num_gpu 0"
  # 32k versions for long sessions, only for the two models that have one in pi.
  case "$short" in
    qwen35) CTX=32768 make_alias "local-qwen35-t$THREADS-32k" "$ref" "$renderer" ;;
    coder)  CTX=32768 make_alias "local-coder-t$THREADS-32k-fix" "$ref" "$renderer" ;;
  esac
done

# ------------------------------------------------------------------- config ----
echo "==> pi config in $PI_DIR"
run mkdir -p "$PI_DIR"
for f in models.json settings.json; do
  dest="$PI_DIR/$f"
  if [ -f "$dest" ] && cmp -s "$HERE/$f" "$dest"; then
    info "$f is already up to date"
    continue
  fi
  if [ -f "$dest" ]; then
    run cp "$dest" "$dest.bak-$(date +%Y%m%d-%H%M%S)"
    info "backed up the existing $f"
  fi
  run cp "$HERE/$f" "$dest"
  info "installed $f"
done

# -------------------------------------------------------------------- alias ----
echo "==> start pi with the memory guard"
info "add this to your shell config (pi-local.sh unloads Ollama models, checks free RAM, hides AWS credentials):"
info "  alias pi=\"$ROOT/pi-local.sh\""
info "then run: pi    (Ollama's Vulkan server for the ollama-gpu models: $ROOT/ollama-vulkan.sh start)"
