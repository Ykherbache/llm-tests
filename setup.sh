#!/usr/bin/env bash
#
# setup.sh - install and tune a local LLM stack on Apple Silicon.
# Tuned and tested for Fedora Asahi Remix (M1 Pro) and macOS (M1 Max).
#
# Usage:
#   ./setup.sh                pull the default daily driver only
#   ./setup.sh --big          + Qwen3.6-35B-A3B MoE  (wants ~26 GB free)
#   ./setup.sh --coder        + Qwen3-Coder-30B-A3B
#   ./setup.sh --dense        + Qwen3.8-27B dense
#   ./setup.sh --quants       + 27B IQ4_XS and Q3, for the bench comparison
#   ./setup.sh --all          every key in models.env
#   ./setup.sh --set MOE26,LFM24      pull specific registry keys
#   ./setup.sh --threads 6 --alias LFM24
#                             create a thread-capped alias (default key: LFM24).
#                             Alias only: no sudo, no env rewrite, no pull of other keys.
#   ./setup.sh --threads 6 --alias CODER --ctx 32768
#                             same, with a fixed num_ctx; applies the registry's
#                             renderer/parser (needed for Qwen3-Coder tool calls)
#   ./setup.sh --threads 6 --alias CODER --ctx 32768 --num-gpu 0
#                             also fixes num_gpu (0 = weights in RAM, the GPU only reads prompts when
#                             the alias runs on the Vulkan server); the name gets a -gpuN suffix
#   ./setup.sh --dry-run      print every command, change nothing
#
# Nothing is installed until you drop --dry-run. Sizes are checked against
# free RAM and free disk before any download starts.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REGISTRY="$HERE/models.env"
ENVFILE="$HERE/env.local"

DRY_RUN=0
WANT=""
THREADS=""
ALL=0
ALIAS_KEY="LFM24"
ALIAS_CTX=""
ALIAS_NUM_GPU=""
ALIAS_ONLY=0

# ---------------------------------------------------------------- output ----
if [ -t 1 ]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'
  GRN=$'\033[32m';  YEL=$'\033[33m'; RST=$'\033[0m'
else
  BOLD=""; DIM=""; RED=""; GRN=""; YEL=""; RST=""
fi

say()  { printf '%s\n' "${BOLD}==>${RST} $*"; }
info() { printf '%s\n' "    $*"; }
ok()   { printf '%s\n' "${GRN} ok${RST}  $*"; }
warn() { printf '%s\n' "${YEL}warn${RST}  $*" >&2; }
die()  { printf '%s\n' "${RED}fail${RST}  $*" >&2; exit 1; }

run() {
  if [ "$DRY_RUN" -eq 1 ]; then
    printf '%s\n' "${DIM}    [dry-run] $*${RST}"
  else
    "$@"
  fi
}

usage() { sed -n '3,25p' "$0" | sed 's/^# \{0,1\}//'; }

# ------------------------------------------------------------------ args ----
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run|-n) DRY_RUN=1 ;;
    --big)        WANT="$WANT BIG" ;;
    --coder)      WANT="$WANT CODER" ;;
    --dense)      WANT="$WANT DENSE" ;;
    --quants)     WANT="$WANT DENSE DENSE_IQ4 DENSE_Q3" ;;
    --all)        ALL=1 ;;
    --set)        [ $# -ge 2 ] || die "--set needs a value"; WANT="$WANT $(printf '%s' "$2" | tr ',' ' ')"; shift ;;
    --threads)    [ $# -ge 2 ] || die "--threads needs a value"; THREADS="$2"; shift ;;
    --alias)      [ $# -ge 2 ] || die "--alias needs a value"; ALIAS_KEY="$2"; shift ;;
    --ctx)        [ $# -ge 2 ] || die "--ctx needs a value"; ALIAS_CTX="$2"; shift ;;
    --num-gpu)    [ $# -ge 2 ] || die "--num-gpu needs a value"; ALIAS_NUM_GPU="$2"; shift ;;
    -h|--help)    usage; exit 0 ;;
    *)            die "unknown option '$1' (try --help)" ;;
  esac
  shift
done
case "$ALIAS_CTX" in ''|*[!0-9]*) [ -z "$ALIAS_CTX" ] || die "--ctx must be a number" ;; esac
case "$ALIAS_NUM_GPU" in ''|*[!0-9]*) [ -z "$ALIAS_NUM_GPU" ] || die "--num-gpu must be a number" ;; esac
[ -z "$ALIAS_NUM_GPU" ] || [ -n "$THREADS" ] || die "--num-gpu only applies to an alias: pass --threads N too"
[ -z "$ALIAS_CTX" ] || [ -n "$THREADS" ] || die "--ctx only applies to an alias: pass --threads N too"
# de-duplicate while keeping order
if [ "$ALL" -eq 1 ]; then
  WANT="$(awk -F'|' '$1 !~ /^#/ && NF {print $1}' "$REGISTRY" | tr '\n' ' ')"
fi
# --threads with nothing else selected means "just make the alias": skip the
# sudo/systemd step, the env rewrite and any pull other than the alias's model.
if [ -n "$THREADS" ] && [ -z "${WANT// /}" ]; then ALIAS_ONLY=1; fi
[ -z "${WANT// /}" ] && WANT="$ALIAS_KEY"
WANT="$(printf '%s\n' $WANT | awk '!seen[$0]++' | tr '\n' ' ')"

# -------------------------------------------------------------- platform ----
OS="$(uname -s)"
ARCH="$(uname -m)"
case "$OS" in
  Linux)  PLATFORM=linux ;;
  Darwin) PLATFORM=macos ;;
  *)      die "unsupported OS: $OS (expected Linux or Darwin)" ;;
esac
case "$ARCH" in
  arm64|aarch64) ;;
  *) warn "expected arm64/aarch64, got $ARCH; the tuning here assumes Apple Silicon" ;;
esac

mem_total_gb() {
  if [ "$PLATFORM" = macos ]; then
    echo $(( $(sysctl -n hw.memsize) / 1024 / 1024 / 1024 ))
  else
    free -g | awk '/^Mem:/{print $2}'
  fi
}

# macOS has no cheap "available" figure; assume ~75% is usable for weights.
mem_avail_gb() {
  if [ "$PLATFORM" = macos ]; then
    echo $(( $(mem_total_gb) * 75 / 100 ))
  else
    free -m | awk '/^Mem:/{print int($7 / 1024)}'
  fi
}

# Stable budget for "will this model fit", independent of what is loaded right
# now. Reserves 8 GB for the OS, compositor and whatever the user is running.
mem_budget_gb() { echo $(( $(mem_total_gb) - 8 )); }

disk_free_gb() { df -Pk "$HOME" | awk 'NR==2{printf "%d", $4 / 1024 / 1024}'; }

pick_context() {
  local budget
  budget="$(mem_budget_gb)"
  if   [ "$budget" -ge 28 ]; then echo 32768
  elif [ "$budget" -ge 18 ]; then echo 16384
  elif [ "$budget" -ge 10 ]; then echo 8192
  else                            echo 4096
  fi
}

is_wanted() { case " $WANT " in *" $1 "*) return 0 ;; esac; return 1; }

registry_lookup() { awk -F'|' -v k="$1" '$1 == k {print $2}' "$REGISTRY"; }

# Optional 5th field: Ollama renderer/parser name (e.g. qwen3-coder).
registry_renderer() { awk -F'|' -v k="$1" '$1 == k {print $5}' "$REGISTRY"; }

# ----------------------------------------------------------- environment ----
say "Host: $OS/$ARCH   platform=$PLATFORM"
info "RAM total/available: $(mem_total_gb) GB / $(mem_avail_gb) GB"
info "Model budget (total - 8 GB reserve): $(mem_budget_gb) GB"
info "Disk free in \$HOME: $(disk_free_gb) GB"
CTX="$(pick_context)"
info "Chosen context length: $CTX tokens"

[ -f "$REGISTRY" ] || die "missing $REGISTRY"

write_envfile() {
  if [ "$DRY_RUN" -eq 1 ]; then
    info "[dry-run] would write $ENVFILE with OLLAMA_CONTEXT_LENGTH=$CTX"
    return
  fi
  say "Writing $ENVFILE"
  cat > "$ENVFILE" <<EOF
# Generated by setup.sh on $(date -u +%Y-%m-%dT%H:%MZ)
# Source this before running ollama CLI commands or bench.sh:
#   source "$ENVFILE"
export OLLAMA_FLASH_ATTENTION=1
export OLLAMA_KV_CACHE_TYPE=q8_0
export OLLAMA_NUM_PARALLEL=1
export OLLAMA_MAX_LOADED_MODELS=1
export OLLAMA_KEEP_ALIVE=30m
export OLLAMA_CONTEXT_LENGTH=$CTX
EOF
}

configure_linux() {
  local dir=/etc/systemd/system/ollama.service.d
  # Honeykrisp advertises only 50% of RAM as GPU heap; HK_SYSMEM raises it.
  # Default 24 GiB on a 32 GB machine leaves ~7 GB for the OS.
  local HK_SYSMEM_BYTES="${HK_SYSMEM_BYTES:-25769803776}"
  say "Configuring systemd drop-in: $dir/override.conf"
  if [ "$DRY_RUN" -eq 1 ]; then
    info "[dry-run] sudo mkdir -p $dir && write override.conf (CONTEXT_LENGTH=$CTX)"
    info "[dry-run] sudo systemctl daemon-reload && sudo systemctl restart ollama"
    return
  fi
  sudo mkdir -p "$dir"
  sudo tee "$dir/override.conf" >/dev/null <<EOF
[Service]
Environment="OLLAMA_FLASH_ATTENTION=1"
Environment="OLLAMA_KV_CACHE_TYPE=q8_0"
Environment="OLLAMA_NUM_PARALLEL=1"
Environment="OLLAMA_MAX_LOADED_MODELS=1"
Environment="OLLAMA_KEEP_ALIVE=30m"
Environment="OLLAMA_CONTEXT_LENGTH=$CTX"
Environment="OLLAMA_VULKAN=1"
Environment="OLLAMA_IGPU_ENABLE=1"
Environment="HK_SYSMEM=$HK_SYSMEM_BYTES"
EOF
  sudo systemctl daemon-reload
  sudo systemctl enable --now ollama
  sudo systemctl restart ollama
  sleep 2
  systemctl is-active --quiet ollama && ok "ollama service is running" || warn "ollama service did not start; check: journalctl -u ollama -n 50"
}

configure_macos() {
  say "Exporting OLLAMA_* into this GUI session (launchctl)"
  if [ "$DRY_RUN" -eq 1 ]; then
    info "[dry-run] launchctl setenv OLLAMA_FLASH_ATTENTION 1  (and friends)"
    return
  fi
  launchctl setenv OLLAMA_FLASH_ATTENTION 1
  launchctl setenv OLLAMA_KV_CACHE_TYPE q8_0
  launchctl setenv OLLAMA_NUM_PARALLEL 1
  launchctl setenv OLLAMA_MAX_LOADED_MODELS 1
  launchctl setenv OLLAMA_KEEP_ALIVE 30m
  launchctl setenv OLLAMA_CONTEXT_LENGTH "$CTX"
  info "restart the Ollama menu-bar app for these to take effect"
  info "for the CLI: add 'source \"$ENVFILE\"' to ~/.zshrc"
  if [ "$CTX" -ge 16384 ] && [ "$(sysctl -n iogpu.wired_limit_mb 2>/dev/null || echo 0)" -eq 0 ]; then
    warn "iogpu.wired_limit_mb is still at the default; large models may spill"
    info "consider: ./wired-limit.sh 26624"
  fi
}

install_ollama() {
  if command -v ollama >/dev/null 2>&1; then
    ok "ollama already installed: $(ollama --version 2>/dev/null || echo unknown)"
    return
  fi
  say "Installing Ollama"
  if [ "$PLATFORM" = linux ]; then
    if [ "$DRY_RUN" -eq 1 ]; then
      info "[dry-run] curl -fsSL https://ollama.com/install.sh | sh"
    else
      curl -fsSL https://ollama.com/install.sh | sh
    fi
  else
    if command -v brew >/dev/null 2>&1; then
      run brew install ollama
    else
      die "no Homebrew found. Install Ollama from https://ollama.com/download, then re-run this script."
    fi
  fi
}

# --------------------------------------------------------------- pulling ----
pull_models() {
  local key ref size note _renderer budget free_gb
  budget="$(mem_budget_gb)"
  free_gb="$(disk_free_gb)"

  while IFS='|' read -r key ref size note _renderer; do
    case "$key" in ''|\#*) continue ;; esac
    is_wanted "$key" || continue

    say "Model: $key  (${size} GB)  - $note"
    if awk -v s="$size" -v f="$free_gb" 'BEGIN{exit !(s * 1.1 > f)}'; then
      warn "not enough disk: needs ~${size} GB, have ${free_gb} GB free - skipping"
      continue
    fi
    if awk -v s="$size" -v b="$budget" 'BEGIN{exit !(s > b)}'; then
      warn "too big for this machine: ${size} GB model vs ${budget} GB usable RAM"
      info "pull it anyway on the other machine, or lower the context afterwards"
    fi
    run ollama pull "$ref"
    # Count this download against the next models' disk check (also in dry-run,
    # so --dry-run --all shows where the disk would run out).
    free_gb="$(awk -v s="$size" -v f="$free_gb" 'BEGIN{printf "%d", f - s}')"
  done < "$REGISTRY"
}

# ------------------------------------------------------------------ main ----
# Fail on a bad --alias before touching the network.
ALIAS_NAME=""
ALIAS_REF=""
if [ -n "$THREADS" ]; then
  ALIAS_REF="$(registry_lookup "$ALIAS_KEY")"
  [ -n "$ALIAS_REF" ] || die "--alias $ALIAS_KEY: no such key in $REGISTRY"
  ALIAS_NAME="local-$(printf '%s' "$ALIAS_KEY" | tr 'A-Z_.' 'a-z--')-t${THREADS}"
  [ -z "$ALIAS_CTX" ] || ALIAS_NAME="${ALIAS_NAME}-$((ALIAS_CTX / 1024))k"
  [ -z "$ALIAS_NUM_GPU" ] || ALIAS_NAME="${ALIAS_NAME}-gpu${ALIAS_NUM_GPU}"
fi

if [ "$ALIAS_ONLY" -eq 1 ]; then
  command -v ollama >/dev/null 2>&1 || die "ollama is not installed - run ./setup.sh first"
else
  write_envfile
  install_ollama
  if [ "$PLATFORM" = linux ]; then configure_linux; else configure_macos; fi
  pull_models
fi

if [ -n "$ALIAS_NAME" ]; then
  ALIAS_RENDERER="$(registry_renderer "$ALIAS_KEY")"
  say "Creating thread-capped alias: $ALIAS_NAME (num_thread=$THREADS${ALIAS_CTX:+, num_ctx=$ALIAS_CTX}${ALIAS_NUM_GPU:+, num_gpu=$ALIAS_NUM_GPU}${ALIAS_RENDERER:+, renderer=$ALIAS_RENDERER}, from $ALIAS_KEY)"
  if [ "$DRY_RUN" -eq 0 ] && ! ollama list 2>/dev/null | awk 'NR > 1 {print $1}' | grep -Fxq "$ALIAS_REF"; then
    warn "$ALIAS_KEY is not installed yet - pulling it for the alias"
    ollama pull "$ALIAS_REF" || die "could not pull $ALIAS_REF"
  fi
  tmp="$(mktemp)"
  {
    printf 'FROM %s\n' "$ALIAS_REF"
    [ -z "$ALIAS_RENDERER" ] || printf 'RENDERER %s\nPARSER %s\n' "$ALIAS_RENDERER" "$ALIAS_RENDERER"
    printf 'PARAMETER num_thread %s\n' "$THREADS"
    [ -z "$ALIAS_CTX" ] || printf 'PARAMETER num_ctx %s\n' "$ALIAS_CTX"
    [ -z "$ALIAS_NUM_GPU" ] || printf 'PARAMETER num_gpu %s\n' "$ALIAS_NUM_GPU"
  } > "$tmp"
  if [ "$DRY_RUN" -eq 1 ]; then
    info "[dry-run] ollama create $ALIAS_NAME -f <Modelfile>:"
    sed 's/^/        /' "$tmp"
  else
    ollama create "$ALIAS_NAME" -f "$tmp" && ok "use it with: ollama run $ALIAS_NAME"
  fi
  rm -f "$tmp"
fi

echo
say "Done"
if [ "$DRY_RUN" -eq 1 ]; then
  info "dry-run only: nothing was changed"
  exit 0
fi
info "installed models:"
ollama list 2>/dev/null | sed 's/^/      /' || true
echo
if [ -n "$ALIAS_NAME" ]; then
  info "chat:      ollama run $ALIAS_NAME   (num_thread=$THREADS)"
else
  info "chat:      ollama run $(registry_lookup "$ALIAS_KEY")"
  info "faster:    ./setup.sh --threads 6 --alias $ALIAS_KEY  (creates a thread-capped alias)"
fi
info "benchmark: ./bench.sh --all-pulled"
info "config:    source \"$ENVFILE\""
