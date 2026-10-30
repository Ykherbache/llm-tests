#!/usr/bin/env bash
#
# bench.sh - measure actual tokens/sec for the models you have installed.
#
# Usage:
#   ./bench.sh                     benchmark the default model (3 reps, median)
#   ./bench.sh --all-pulled        every registry model that is installed
#                                  (registry refs only; local-* aliases need --model)
#   ./bench.sh --quants            the Qwen3.8-27B Q4 / IQ4_XS / Q3 matrix
#   ./bench.sh --model TAG ...     specific model tag(s)
#   ./bench.sh --threads 8         cap generation threads (default: 6 on Linux, since
#                                  Ollama's all-cores default halves MoE speed;
#                                  --threads 0 = let Ollama decide)
#   ./bench.sh --reps 5            more repetitions (default 3)
#   ./bench.sh --sustained         generate 512 tokens to expose throttling
#   ./bench.sh --llama             also run llama-bench on ./models/*.gguf
#   ./bench.sh --mlx               also run mlx-lm (macOS only)
#
# Every measured prompt is prefixed with a unique nonce so Ollama cannot serve
# it from its prefix cache. Decode and steady-state tokens/sec are timed
# client-side (see measure.py); the server's prefill figure is reported
# separately because Ollama over-counts it on cache hits.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REGISTRY="$HERE/models.env"
ENVFILE="$HERE/env.local"
API="${OLLAMA_HOST:-http://127.0.0.1:11434}"
API="${API%/}"
case "$API" in http://*|https://*) ;; *) API="http://$API" ;; esac

NP=128
REPS=3
THREADS=""
DO_LLAMA=0
DO_MLX=0
DO_QUANTS=0
DO_ALL=0
MODELS=""
MLX_MODEL="${MLX_MODEL:-mlx-community/Qwen3.8-27B-4bit}"

if [ -t 1 ]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'
  GRN=$'\033[32m'; YEL=$'\033[33m'; RST=$'\033[0m'
else
  BOLD=""; DIM=""; RED=""; GRN=""; YEL=""; RST=""
fi

say()  { printf '%s\n' "${BOLD}==>${RST} $*"; }
info() { printf '%s\n' "    $*"; }
warn() { printf '%s\n' "${YEL}warn${RST}  $*" >&2; }
die()  { printf '%s\n' "${RED}fail${RST}  $*" >&2; exit 1; }

usage() { sed -n '3,25p' "$0" | sed 's/^# \{0,1\}//'; }

while [ $# -gt 0 ]; do
  case "$1" in
    --model)      [ $# -ge 2 ] || die "--model needs a value"; MODELS="$MODELS $2"; shift ;;
    --models)     [ $# -ge 2 ] || die "--models needs a value"; MODELS="$MODELS ${2//,/ }"; shift ;;
    --quants)     DO_QUANTS=1 ;;
    --all-pulled) DO_ALL=1 ;;
    --threads)    [ $# -ge 2 ] || die "--threads needs a value"; THREADS="$2"; shift ;;
    --reps)       [ $# -ge 2 ] || die "--reps needs a value"; REPS="$2"; shift ;;
    --sustained)  [ "$NP" -lt 512 ] && NP=512 ;;
    --np)         [ $# -ge 2 ] || die "--np needs a value"; NP="$2"; shift ;;
    --llama)      DO_LLAMA=1 ;;
    --mlx)        DO_MLX=1 ;;
    --mlx-model)  [ $# -ge 2 ] || die "--mlx-model needs a value"; MLX_MODEL="$2"; shift ;;
    -h|--help)    usage; exit 0 ;;
    *)            die "unknown option '$1' (try --help)" ;;
  esac
  shift
done

if [ -z "$THREADS" ] && [ "$(uname -s)" = Linux ]; then
  THREADS=6
  info "num_thread defaults to 6 on Linux (pass --threads 0 for Ollama's own default)"
fi
[ "$THREADS" = 0 ] && THREADS=""

[ -f "$REGISTRY" ] || die "missing $REGISTRY"
command -v python3 >/dev/null 2>&1 || die "python3 is required (used by measure.py)"
# shellcheck disable=SC1090
[ -f "$ENVFILE" ] && . "$ENVFILE"

registry_lookup() { awk -F'|' -v k="$1" '$1 == k {print $2}' "$REGISTRY"; }

curl -sf "$API/api/version" >/dev/null 2>&1 \
  || die "cannot reach Ollama at $API - start it with: ollama serve"

PULLED="$(mktemp)"
RUNS="$(mktemp)"
TBL="$(mktemp)"
trap 'rm -f "$PULLED" "$RUNS" "$TBL"' EXIT
ollama list 2>/dev/null | awk 'NR > 1 && NF {print $1}' > "$PULLED" || true
[ -s "$PULLED" ] || die "no models installed - run ./setup.sh first"
is_pulled() { grep -Fxq "$1" "$PULLED"; }

if [ "$DO_QUANTS" -eq 1 ]; then
  MODELS="$MODELS $(registry_lookup DENSE) $(registry_lookup DENSE_IQ4) $(registry_lookup DENSE_Q3)"
fi
if [ "$DO_ALL" -eq 1 ]; then
  while IFS='|' read -r key ref _rest; do
    case "$key" in ''|\#*) continue ;; esac
    MODELS="$MODELS $ref"
  done < "$REGISTRY"
fi

if [ -z "${MODELS// /}" ]; then
  # Default: the first registry model that is actually installed. Keeps working
  # after any single model is deleted, on either machine.
  while IFS='|' read -r _key ref _rest; do
    case "$_key" in ''|\#*) continue ;; esac
    if is_pulled "$ref"; then MODELS="$ref"; break; fi
  done < "$REGISTRY"
  [ -n "${MODELS// /}" ] || MODELS="$(head -n1 "$PULLED")"
fi

SELECTED=""
for m in $MODELS; do
  case " $SELECTED " in *" $m "*) continue ;; esac
  if ! is_pulled "$m"; then
    warn "not installed, skipping: $m"
    continue
  fi
  SELECTED="$SELECTED $m"
done
[ -n "${SELECTED// /}" ] || die "nothing to benchmark - run ./setup.sh first"

# Long enough that prefill is measurable, plain ASCII so JSON escaping is trivial.
PROMPT="Local inference speed is governed by memory bandwidth, not by raw compute, whenever a model is decoded one token at a time. Each generated token requires streaming every active weight through the memory hierarchy, so a model that activates three billion parameters per token reads roughly two gigabytes of quantized weights per step, while a dense twenty seven billion parameter model must read more than sixteen gigabytes for the same single token. This single fact explains why mixture of experts architectures feel dramatically faster on laptops and desktops that have no discrete GPU, and why shrinking the quantization of a dense model buys far less than switching to a sparse one. Prompt processing behaves in the opposite way, because it is arithmetic bound and parallel across the whole prompt, which is why a dedicated graphics card can ingest a long context many times faster than a unified memory laptop while still generating tokens at a similar rate. Measure both numbers separately before drawing conclusions about which machine or which runtime is faster for the way you actually work."

say "Benchmarking via $API"
info "models: $REPS reps each, num_predict=$NP${THREADS:+, num_thread=$THREADS}"
info "each prompt gets a unique nonce to defeat Ollama's prefix cache"

for m in $SELECTED; do
  info "running $(basename "${m%%:*}"):${m##*:} (x$REPS) ..."
  # Warm-up: forces Ollama to load the model with these exact options, so the
  # first timed rep does not include multi-second weights loading.
  python3 "$HERE/measure.py" --api "$API" --model "$m" --prompt "warm" --np 1 \
      ${THREADS:+--threads "$THREADS"} >/dev/null 2>&1 || true
  for rep in $(seq 1 "$REPS"); do
    nonce="r$(date +%s)${rep}${RANDOM}"
    if ! python3 "$HERE/measure.py" --api "$API" --model "$m" \
          --prompt "[$nonce] $PROMPT" --np "$NP" \
          ${THREADS:+--threads "$THREADS"} >> "$RUNS"; then
      warn "a run failed for $m - stopping this model"
      break
    fi
  done
done

[ -s "$RUNS" ] || die "no successful runs"

python3 - "$RUNS" "$TBL" "$NP" "$REPS" "${THREADS:-auto}" <<'PY'
import json, statistics, sys

runs_path, out_path, np_, reps, threads = sys.argv[1:6]
rows = [json.loads(l) for l in open(runs_path) if l.strip()]
groups = {}
for r in rows:
    groups.setdefault(r["model"], []).append(r)

def col(rs, key):
    return [r[key] for r in rs if r.get(key)]

print()
print(f"{'model':<44}{'decode':>8}{'range':>14}{'steady':>8}{'prefill':>9}{'ttft':>7}")
print(f"{'':<44}{'tok/s':>8}{'':>14}{'tok/s':>8}{'tok/s':>9}{'s':>7}")
print("-" * 90)

md = ["| model | decode tok/s | min | max | steady tok/s | prefill tok/s | ttft s |",
      "|---|---|---|---|---|---|---|"]
for model, rs in groups.items():
    dec = col(rs, "decode_tok_s")
    st = col(rs, "steady_tok_s")
    pre = col(rs, "prefill_tok_s")
    tt = col(rs, "ttft_s")
    d = statistics.median(dec) if dec else 0.0
    s = statistics.median(st) if st else 0.0
    p = statistics.median(pre) if pre else 0.0
    t = statistics.median(tt) if tt else 0.0
    lo = min(dec) if dec else 0.0
    hi = max(dec) if dec else 0.0
    print(f"{model:<44}{d:>8.1f}{f'{lo:.1f}-{hi:.1f}':>14}{s:>8.1f}{p:>9.0f}{t:>7.2f}")
    md.append(f"| {model} | {d:.1f} | {lo:.1f} | {hi:.1f} | {s:.1f} | {p:.0f} | {t:.2f} |")

print()
print(f"note: prefill = prompt tokens / time-to-first-token (client-timed);")
print(f"      decode/steady are timed client-side by measure.py.")
with open(out_path, "w") as f:
    f.write("\n".join(md) + "\n")
PY

# ------------------------------------------------------------ llama-bench ----
LLAMA_OUT=""
if [ "$DO_LLAMA" -eq 1 ]; then
  BENCH_BIN="${LLAMA_BENCH:-llama-bench}"
  if ! command -v "$BENCH_BIN" >/dev/null 2>&1; then
    warn "llama-bench not found. Build it with:"
    info "cmake -B build && cmake --build build --target llama-bench -j\$(nproc 2>/dev/null || sysctl -n hw.ncpu)"
  else
    shopt -s nullglob
    ggufs=("$HERE"/models/*.gguf)
    shopt -u nullglob
    if [ ${#ggufs[@]} -eq 0 ]; then
      warn "no .gguf files in $HERE/models - drop one there to compare backends"
    else
      for f in "${ggufs[@]}"; do
        say "llama-bench: $(basename "$f")"
        LLAMA_OUT="${LLAMA_OUT}$("$BENCH_BIN" -m "$f" -p 512 -n 128 -r 3 2>&1)"$'\n'
        printf '%s\n' "$LLAMA_OUT"
      done
    fi
  fi
fi

# -------------------------------------------------------------------- mlx ----
MLX_OUT=""
if [ "$DO_MLX" -eq 1 ]; then
  if [ "$(uname -s)" != Darwin ]; then
    warn "MLX is macOS only - skipping"
  elif ! python3 -c 'import mlx_lm' >/dev/null 2>&1; then
    warn "mlx-lm not installed: python3 -m pip install --user mlx-lm"
  else
    say "mlx-lm: $MLX_MODEL"
    MLX_OUT="$(python3 -m mlx_lm.generate --model "$MLX_MODEL" \
                 --prompt "$PROMPT" --max-tokens "$NP" 2>&1 | tr '\r' '\n' \
                 | grep -i 'Generation:' | tail -n1 || true)"
    [ -n "$MLX_OUT" ] && printf '%s\n' "$MLX_OUT" || warn "could not parse mlx-lm output"
  fi
fi

# ---------------------------------------------------------------- results ----
mkdir -p "$HERE/results"
OUT="$HERE/results/$(hostname -s | tr ' ' '-')-$(date +%Y%m%d-%H%M%S).md"
{
  echo "# LLM benchmark - $(hostname -s)"
  echo
  echo "- date: $(date -u +%Y-%m-%dT%H:%MZ)"
  echo "- host: $(uname -sm) $(uname -r)"
  echo "- runtime: ollama $(ollama --version 2>/dev/null | head -n1 || echo unknown)"
  echo "- num_predict: $NP, reps: $REPS, num_thread: ${THREADS:-auto}"
  echo
  cat "$TBL"
  if [ -n "$LLAMA_OUT" ]; then echo; echo '```'; printf '%s' "$LLAMA_OUT"; echo '```'; fi
  if [ -n "$MLX_OUT" ];   then echo; echo '```'; printf '%s\n' "$MLX_OUT"; echo '```'; fi
} > "$OUT"

echo
say "Saved: $OUT"
