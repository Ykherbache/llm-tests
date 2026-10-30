# llm-tests

Local LLM setup and benchmarking for Apple Silicon, tuned for two targets:

- **Asahi Linux** on an M1 Pro (CPU-bound, experimental Vulkan)
- **macOS** on an M1 Max (Metal + MLX)

The point is not to install the biggest model. It is to **measure what actually
runs well on your machine** before you commit disk and time to it.

## Files

| File | Purpose |
|---|---|
| `setup.sh` | Installs Ollama, tunes it, pulls models with a RAM/disk check |
| `bench.sh` | Runs the matrix, prints a table, saves a report to `results/` |
| `measure.py` | Times one generation; the source of truth for tok/s |
| `wired-limit.sh` | macOS only: raises the GPU wired-memory cap |
| `models.env` | Model registry: key, HF reference, real size, note |
| `pi/` | pi config (`models.json`, `settings.json`) and `setup-pi.sh`, which installs it with the aliases |
| `pi-local.sh` | starts pi after unloading Ollama models and checking free RAM |
| `models/` | Put `.gguf` files here for `bench.sh --llama` |
| `results/` | Generated benchmark reports (markdown) |

## Quick start

```bash
cd ~/personal/llm-tests

./setup.sh --dry-run                 # see every command first, change nothing
./setup.sh --set MOE26,LFM24,CODER   # pull just these
./bench.sh --all-pulled --threads 6  # 3 reps each, median (6 is already the Linux default; --threads 0 = Ollama's own)
```

## Leaderboard (M1 Pro, Asahi, 31 GB, 6 threads)

Same session, same prompt, median of 3. This is the table that matters.

| Model | Backend | Active | Size | decode tok/s | prefill | ttft |
|---|---|---|---|---|---|---|
| **LFM2.5-24B-A2B** | CPU (Ollama) | 2B | 14.9 GB | **40.3** | 130 | 1.69 s |
| **Qwen3-Coder-30B-A3B** | CPU (Ollama) | 3.3B | 18.6 GB | **29.5** | 100 | 2.21 s |
| Qwen3.5-35B-A3B | CPU (Ollama) | 3B | 20.7 GB | 22.0 | 122 | 1.82 s |
| Gemma 4 26B-A4B | CPU (Ollama) | 4B | 17.0 GB | 19.0 | 80 | 2.85 s |
| ~~Qwen3.5-9B~~ (dense, deleted) | CPU (Ollama) | 9B | 5.7 GB | 15.7 | 80 | 2.76 s |

CPU vs Vulkan GPU, measured with `llama-bench` (same binary for both): see
[CPU vs GPU](#cpu-vs-gpu-llama-bench) below.

Two controls from the same session: Gemma 4 at 10 threads (Ollama's default)
collapsed to **9.8 tok/s**, and the `local-lfm24-t6` alias reproduced **40.3
tok/s** without any flag. Both confirm the thread cap is the effect, not noise.

The whole table is one lesson: **decode speed tracks active parameters, not
model size.** A 24B model runs 2.5x faster than a 9B one because it activates 2B
per token instead of 9B.

## CPU vs GPU (llama-bench)

Same binary for both backends (`llama-bench`, Vulkan build), CPU at 6 threads with the GPU
hidden (`-dev none`), GPU with `HK_SYSMEM=25769803776` (24 GiB heap). tok/s, `@8k` = with an
8192-token prefix in the context. Full table, method and incidents:
[results/gpu-vs-cpu-2026-10-30.md](results/gpu-vs-cpu-2026-10-30.md).

| Model | Backend | Size GiB | prefill | decode | prefill @8k | decode @8k |
|---|---|---|---|---|---|---|
| LFM2.5-24B-A2B | CPU | 13.9 | 118.3 | **46.2** | 73.6 | 31.0 |
| LFM2.5-24B-A2B | GPU | 13.9 | **145.7** | 28.5 | **118.5** | 25.9 |
| Qwen3-Coder-30B-A3B | CPU | 17.3 | 85.5 | 37.8 | 17.9 | 8.3 |
| Gemma 4 26B-A4B | CPU | 15.8 | 82.3 | 21.8 | 39.2 | 11.3 |
| Qwen3.5-35B-A3B | CPU | 19.2 | 127.4 | 24.9 | 54.9 | 18.6 |
| Nemotron 30B-A3B (Q3) | CPU | 19.8 | 119.4 | 28.4 | 72.3 | 21.3 |
| Qwen3.6-35B-A3B | CPU | 20.6 | 110.1 | 24.3 | 51.6 | 17.9 |
| Qwen3.8-27B dense (Q4_K_M) | CPU | 15.3 | 10.7 | 4.9 | - | - |
| Qwen3.8-27B dense (Q3_K_XL) | CPU | 12.2 | 4.0 | 3.2 | - | - |
| Qwen3.8-27B dense (Q3_K_XL) | GPU | 12.2 | 20.1 | 0.7 | 16.4 | - |

- **GPU wins prefill, loses decode.** LFM2.5: prefill +23% (+61% at 8k), decode -38%.
  The dense model: prefill 5x faster, decode 4.4x slower.
- **GPU inference makes the desktop unusable.** `vkcube` took 17-66 s to draw 300 frames
  during a GPU run (2.66 s idle). `GGML_VK_MAX_NODES_PER_SUBMIT` and `-ub` helped a little
  and fixed nothing. On this laptop, use the CPU backend; a headless box is another matter.
- Only LFM2.5 and the dense Q3 were measured on GPU. The other models were not run there.
- `-ngl 0` alone is not a CPU test on a Vulkan build (large-batch prefill still goes to the
  GPU). Use `-dev none`.
- llama-bench numbers are higher than the Ollama table above (no server overhead). Compare
  within a table, not across.

## Thread count is the single biggest cheap win

Same model (LFM2.5-24B-A2B), same session, only `num_thread` changed:

| threads | decode tok/s |
|---|---|
| 6 | **38.6** |
| 8 | 35.9 |
| 10 (Ollama default) | **18.5** |

**Ollama defaults to every core, including the 2 E-cores, and it costs you half
your throughput on MoE models.** Always pass `--threads 6` (MoE) or `--threads 8`
(dense). Create a permanent alias with:

```bash
./setup.sh --threads 6              # creates local-lfm24-t6 from the LFM24 key
./setup.sh --threads 8 --alias MOE26   # same, for any other registry key
# --threads without --set/--all builds only the alias: no sudo, no env rewrite
# then: ollama run local-lfm24-t6    -> 40.3 tok/s, no flags needed
```

The alias bakes `num_thread` into the model, so every client (TUI, OpenWebUI,
your editor plugin) gets the fast path without remembering the flag. Verify with
`ps -eo args | grep llama-server | tr ' ' '\n' | grep -A1 '^-t$'`.

## Reading the benchmark

`bench.sh` reports three numbers per model, and they are not interchangeable:

- **decode** — first token to last token, timed client-side. The number that
  matters for chat.
- **steady** — second half of the same generation. Well below decode means
  throttling.
- **prefill** — prompt tokens divided by time-to-first-token. How fast it reads
  your input.

Every prompt gets a unique nonce. Without it, Ollama serves the prompt from its
KV cache and prefill becomes fiction — I measured 44 to 590 tok/s for the same
prompt before adding it.

Numbers drift ~20% between sessions (CPU state, background load). **Only compare
within a single run**, which is why the leaderboard above is one session.

## Gotchas

**Thread count**
- Ollama launches `llama-server` with no `-t`, so it uses all 10 cores including
  the 2 E-cores. On MoE that halves throughput. Use `--threads 6`.

**Reasoning models**
- Models like gpt-oss stream tokens into the `thinking` channel with an empty
  `response` field. `measure.py` counts both, but be aware a "40 tok/s" model
  that thinks for 300 tokens still feels slow.

**Asahi Linux**
- No Metal, no CUDA. CPU is the reliable path; Honeykrisp Vulkan is experimental.
- Vulkan reports only **50% of RAM** as GPU heap (15.55 GiB on 32 GB). Raise it
  with `HK_SYSMEM=<bytes>` (24 GiB = `25769803776`); `vulkaninfo` confirms.
  Ollama also needs `OLLAMA_IGPU_ENABLE=1` or it drops the integrated GPU and
  runs on CPU. `setup.sh` writes both into the systemd drop-in.
- Watch `free -h` while generating. 8 GB of zram swap will mask memory pressure
  until the machine crawls.

**macOS**
- Default GPU wired limit is ~65-75% of RAM. On 32 GB that is ~21-24 GB. Run
  `./wired-limit.sh 26624`.
- Do not push the limit to the max; it can hard-freeze the machine.
- `launchctl setenv` values are per-login-session. `env.local` is for the CLI.

**Both**
- 32 GB is the model-size ceiling, not the speed ceiling. A 70B will not fit.
- A 20 GB model plus browser on a 31 GB machine is ~1 GB from swapping. Close
  things before benchmarking the big ones.

## pi coding agent (local models)

[pi](https://github.com/earendil-works/pi) is a terminal coding agent: it reads and edits files and runs
commands in your project. Use it for work on code, and use the `chat/` app for questions and research.

Setup on this machine (already done on the Asahi box):

```bash
# 1. install without root (the global npm prefix /usr/local needs sudo)
npm install -g --ignore-scripts --prefix ~/.local @earendil-works/pi-coding-agent

# 2. a 32k-context alias; it reuses the Qwen3 Coder weights, so nothing is downloaded.
#    RENDERER/PARSER are required for reliable tool calls (see "Tool calls" below).
cat > /tmp/m <<'EOF'
FROM hf.co/unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF:Q4_K_M
RENDERER qwen3-coder
PARSER qwen3-coder
PARAMETER num_thread 6
PARAMETER num_ctx 32768
PARAMETER temperature 0.7
PARAMETER top_p 0.8
PARAMETER top_k 20
PARAMETER repeat_penalty 1.05
EOF
ollama create local-coder-t6-32k-fix -f /tmp/m
```

The two config files live in `~/.pi/agent/`:
- `models.json` adds an `ollama` provider at `http://127.0.0.1:11434/v1` (dummy key, with `supportsDeveloperRole` and
  `supportsReasoningEffort` set to false) and three models. The default is `local-coder-t6-32k-fix`. `local-lfm24-t6` and
  `local-moe26-t6` are also listed, at 16k.
- `settings.json` sets the default provider and model, and `compaction.reserveTokens` to 8192, so pi summarises old
  history at about 24k instead of half the window. The 16k models have smaller reserves.

**Models in pi.** Everything reuses weights you already have, nothing is downloaded. All have a 24k context
(`num_ctx 24576`); the `-gpu0` ones run on the Vulkan server with the weights in RAM so the GPU reads the prompt.

| Model | CPU (`ollama/…`) | GPU prefill (`ollama-gpu/…`) | Notes |
|---|---|---|---|
| Qwen3.5 35B | `local-qwen35-t6-24k` (default) | `local-qwen35-t6-24k-gpu0` | thinks; pi's thinking level is sent as `reasoning_effort` (default `low`); barely slows down with context |
| Qwen3 Coder 30B | `local-coder-t6-24k` | `local-coder-t6-24k-gpu0` | no thinking, but 85 → 18 tok/s prompt reading at 8k |
| LFM 2.5 24B | `local-lfm24-t6-24k` | `local-lfm24-t6-24k-gpu0` | lightest (14 GB), thinks on every call |
| Gemma 4 26B | `local-moe26-t6-24k` | `local-moe26-t6-24k-gpu0` | thinks on every call |

`local-coder-t6-32k-fix` and `local-qwen35-t6-32k` stay available for long sessions. The pi picker shows only these
local models: `enabledModels` in `settings.json` limits cycling to `ollama/*` and `ollama-gpu/*`, and `pi-local.sh`
hides the AWS credentials from pi (otherwise ~200 Bedrock models appear). `PI_KEEP_AWS=1 pi` brings them back.

**Setting it up on a new machine.** The pi config lives in `pi/` (`models.json`, `settings.json`) and one script does the rest:

```bash
git clone https://github.com/Ykherbache/llm-tests && cd llm-tests
./setup.sh                              # Ollama itself, once (see Quick start)
./pi/setup-pi.sh --install-pi           # pi, the base models, the aliases, ~/.pi/agent/*.json
./pi/setup-pi.sh --only qwen35,coder    # or just some models (coder, qwen35, lfm24, moe26)
./pi/setup-pi.sh --dry-run              # prints every command first, changes nothing
```

It pulls the models that are missing (14-21 GB each, sizes in `models.env`), creates the 24k aliases (CPU and `-gpu0`, plus the
32k ones for Qwen3.5 and Qwen3 Coder), skips aliases that already exist (`--force` recreates them) and backs up any
`models.json` or `settings.json` it replaces. Last, add the alias it prints to your shell config:
`alias pi="$HOME/personal/llm-tests/pi-local.sh"`. Start the Vulkan server (`./ollama-vulkan.sh start`) only if you want the
`ollama-gpu` models. `pi/settings.json` has no machine-specific values, so it can be copied as is.

- The registry line `QWEN35` carries `qwen3.5` as renderer/parser. Without it Ollama drops the `tools` and `thinking`
  capabilities of the import (`qwen35`, without the dot, is accepted by `ollama create` but loses them just the same).
- `num_gpu` can't be sent through `/v1`, so it is fixed in the `-gpu0` alias. The GPU server is optional: the Asahi desktop can
  stutter while the GPU is busy, and `llama-bench` measured only 1.2-1.5x faster prompt reading there, so CPU stays the default.

Run it with `cd your-project && ./path/to/llm-tests/pi-local.sh` (pick another model with `/model`), or one-shot with
`pi-local.sh -p "..."`. `pi-local.sh` is `pi` plus a memory guard, see [Memory](#memory-and-pi-local) below.

Why these choices:
- **32k context, not 16k.** pi's own instructions and tool definitions take about **5,950 tokens**. Ollama silently
  truncates anything longer than the alias's `num_ctx`, so `contextWindow` in models.json must match it exactly
  (32768).
- **Qwen3 Coder by default.** It is trained for tool use and doesn't think first (about 33 tok/s). LFM and Gemma spend
  thousands of thinking tokens on every call, which an agent makes many of.
- **Memory.** At 32k, `ollama ps` shows 22 GB for Qwen3 Coder. See [Memory](#memory-and-pi-local): it only fits if nothing else is pinned.

### Memory and pi-local

The default is now `local-coder-t6-24k` (Qwen3 Coder, `num_ctx 24576`); the 32k aliases stay for long sessions.

**What fills the RAM is the model, not the context.** Qwen3.5 only has 10 attention layers (about 11 KB of KV cache per token
at q8_0), so 32k to 24k saves about 0.1 GB; Qwen3 Coder about 52 KB per token, so about 0.4 GB. The 18-20 GB of weights are what
counts. 24k still leaves about 18k tokens after pi's own ~6k of instructions.

**The real trap is the Vulkan server.** On Asahi the GPU's memory is pinned (`grep Unevictable /proc/meminfo`). Whatever the
Vulkan Ollama on :11435 holds (the chat's Prefill GPU / Hybrid / GPU modes, or an `ollama-gpu/…` pi model) stays pinned for its
whole `keep_alive`, the CPU server on :11434 can't see it, and loading a 20 GB model next to it gets the kernel OOM-killer to kill
Ollama. `pi-local.sh` unloads every resident model on both servers, waits for the memory to come back, checks that the model fits
(file size + 3 GB) and only then starts pi; `--force` skips the check. With the model loaded, about 8 GB stays free for the desktop.

**Speed on this machine (Asahi = CPU only, `ollama ps` shows 100% CPU).** Reading the prompt runs at about **42 tok/s**:
- The **first pi session after the model loads takes about 2½ minutes**, because those 5.9k instruction tokens have to be read.
- After that the instructions are cached: a second session finished in **10 s**.
- Each file pi reads still costs prompt time, roughly 50 s per 2k-token file.
- The cache is lost when the model is unloaded or another prompt takes its place, for example after using the chat app.
  Switching between the chat app (16k aliases) and pi (32k alias) also reloads the model (10–40 s).
- On the M1 Max (macOS, Metal) prompt reading is much faster, so pi is far more comfortable there.

**Tool calls (why the alias needs `RENDERER` and `PARSER`).** A plain `FROM hf.co/...` import of the Qwen3 Coder GGUF
gets a generic Hermes-style chat template. That template prints each tool schema as a Go struct dump
(`{object <nil> <nil> [path content]…`) instead of JSON, and asks for a `<tool_call>{json}</tool_call>` format that
Qwen3-Coder wasn't trained on. The model then copies the garbled format back as plain text, pi never sees a tool call,
and the session "stops". Ollama ships a `qwen3-coder` renderer and parser, and the Modelfile lines
`RENDERER qwen3-coder` / `PARSER qwen3-coder` switch both on. Same weights, so no download.
Short tests hide the problem: with a short prompt and 1-2 tools the old alias still worked. With a pi-sized
prompt (7 tools, long system prompt) 2 of 5 first replies on `/v1` came back as raw `<tool_call>` text, and the
fixed alias made 5 of 5 structured calls on both `/v1` and the native API.
In a pi A/B on a small 4-file project (read-only tools), the old alias stopped after 2 tool calls every time ("Let me check
the other files…" and then nothing), while the fixed alias finished 3 of 3 runs on its own (13–15 tool calls each). Tool
calling works now, but answer quality is still the model's: it found one of the two unused functions and missed the other,
so check its conclusions.

The chat app's 16k alias `local-coder-t6` was recreated the same way (renderer + parser, no `num_ctx`), so its web-search tool calls
use the right format too. `./setup.sh --threads 6 --alias CODER [--ctx 32768]` now writes the same `RENDERER`/`PARSER` lines (the
renderer name is the optional 5th field of the `CODER` line in `models.env`), so it no longer needs the manual `ollama create`.

**pi has no permission system:** it runs commands with your user's rights. Use it in a git repo so its changes
are easy to review and revert, or in a container (see pi's `docs/containerization.md`).

## Troubleshooting

```bash
curl -s http://127.0.0.1:11434/api/version    # server up?
ollama ps                                     # what is loaded, CPU or GPU?
journalctl -u ollama -n 200 | grep -E 'prompt eval time|eval time'
free -h                                       # Linux
vm_stat                                       # macOS
```

The journal is authoritative — it is llama.cpp's own timer, and it should agree
with `bench.sh` within a few percent. If it does not, the benchmark is measuring
cache hits rather than work.
