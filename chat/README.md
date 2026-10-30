# Local Chat

A local-first chat UI for your own Ollama server. It's for a single user, with no accounts, no cloud, no API keys and no telemetry.
Conversations live in the browser's IndexedDB.

```
browser ──▶ Next.js /api/chat  (same origin) ──▶ Ollama /api/chat (NDJSON) ──▶ piped straight back
        ──▶ Next.js /api/tools (same origin) ──▶ SearXNG / the page being read   (web tools only)
```

The browser never talks to Ollama directly. See [CORS](#cors) for why.

## Prerequisites

- Node 20+ and npm
- Ollama running on `http://127.0.0.1:11434`
- The three thread-capped aliases, created from the parent `llm-tests/` folder:

  ```bash
  ./setup.sh --threads 6 --alias LFM24    # local-lfm24-t6
  ./setup.sh --threads 6 --alias CODER    # local-coder-t6
  ./setup.sh --threads 6 --alias MOE26    # local-moe26-t6
  ```

  An alias is just a manifest pointing at blobs you already have, so it uses no extra disk.
  If `setup.sh` stops at its sudo step, create the alias directly, for example:
  `printf 'FROM <hf ref from models.env>\nPARAMETER num_thread 6\n' > m && ollama create local-coder-t6 -f m`

Check everything with these three commands:

```bash
curl -s http://127.0.0.1:11434/api/tags | head -c 200          # Ollama is up
ollama list | grep -- '-t6'                                     # all three aliases exist
curl -s http://127.0.0.1:11434/api/chat -d '{"model":"local-lfm24-t6","messages":[{"role":"user","content":"hi"}],"stream":false,"options":{"num_predict":32}}' | head -c 300
```

## Run

```bash
cp .env.local.example .env.local      # OLLAMA_BASE_URL=http://127.0.0.1:11434
npm install
npm run dev                           # http://localhost:3000
# or, for production:
npm run build && npm start
```

`OLLAMA_BASE_URL` is read only on the server, by the route handlers.

### CPU and GPU servers

The system Ollama has no GPU backend, so it is a real CPU-only server. `../ollama-vulkan.sh start` runs a second
Ollama on port 11435 that uses the Vulkan llama.cpp build, and the app picks the server from the **Run on** switch:

| Mode | Server | What runs where |
|---|---|---|
| CPU | `OLLAMA_CPU_BASE_URL` (11434) | everything on the CPU |
| Prefill GPU | `OLLAMA_BASE_URL` (11435), 0 GPU layers | weights in RAM, long prompts read by the GPU, answer written by the CPU |
| Hybrid | `OLLAMA_BASE_URL`, N GPU layers | the first N layers on the GPU, the rest on the CPU, every token through both |
| GPU | `OLLAMA_BASE_URL`, all layers | everything on the GPU |

Switching between CPU and the others unloads the model from the other server first (both holding a 15 GB model does
not fit in 31 GB). If `OLLAMA_CPU_BASE_URL` is unset, every mode uses `OLLAMA_BASE_URL`.

## What you get

- **Streaming.** Tokens stream in as they arrive. React state updates once per animation frame, and markdown is parsed once,
  when the reply finishes. While streaming, the text renders as plain pre-wrap.
- **Thinking.** LFM and Gemma stream most of their output on `message.thinking`. That text goes into a collapsed
  "Thinking" block and never into the answer.
- **Per-reply stats.** Each reply shows tok/s, generated tokens, prompt tokens with a `(cached)` marker, a
  `cold start · loaded in Ns` badge, and `hit the token limit`.
- **Model loading state.** The model loading state comes from `/api/ps`, which says whether the model is resident, and from a real
  first-token timer. It never times out.
- **Message actions.** Stop (Esc), regenerate or retry, edit and resend, copy, delete.
- **Conversations.** Rename, delete, search, and grouping by Today / Yesterday / Previous 7 days / Older.
- **Settings.** A global system prompt plus a per-chat override, temperature, and max tokens. All of it is persisted.
- **Context meter.** It shows the last reply's `prompt_eval_count` against 16384, warns above 80 %, and blocks sending
  above 95 %.
- **Trimming.** History is trimmed to about 12k estimated tokens before sending. The system prompt and the last 6 messages
  are always kept, and stored history is never deleted.
- **Web search.** Models can search the web through a local SearXNG and read result pages. See
  [Web search](#web-search-tool-calling).
- **Keyboard.** Enter sends, Shift+Enter adds a newline, Esc stops, Ctrl/⌘+K starts a new chat, Ctrl/⌘+Shift+O focuses the model picker.
- **Theme and layout.** Dark by default with a light toggle. At narrow widths (down to 380 px) the sidebar becomes a drawer.

## Effort

The gauge button in the composer sets how hard the model works on the next reply. It is saved in the settings and
shown as a badge on every reply. The values live in `lib/effort.ts`.

| | Low | Medium (default) | High | Max |
|---|---|---|---|---|
| Reasoning | asked for almost none, cut at 256 tokens | brief, cut at 1,024 tokens | unlimited | asked to verify |
| Tool rounds | 1, `web_search` only (snippets) | 2 | 4 | 6 |
| Page text | none | 4,000 chars | 8,000 chars | 8,000 chars |
| Max tokens | at most 1,024 | at most 2,048 | your setting | at least 8,192 |

When a round's reasoning goes over its budget, the request is cut and the model is asked to stop thinking and answer
(or make the one tool call it needs). From Medium up, `web_search` also appends the text of the first result that can be
read (a 403 or timeout moves on to the next), so the model rarely needs a `fetch_url` round. Calls made in the same
round run in parallel.

## Web search (tool calling)

All three models support Ollama tool calling. When the **globe** button in the composer is on, the models get two tools:

| Tool | What it does |
|---|---|
| `web_search(query)` | Queries a **local SearXNG** instance, which aggregates Google, Brave, Bing and other engines with no API key. It returns the top 5 results (title, URL, snippet). |
| `fetch_url(url)` | Downloads a page and returns its readable text (extracted with Readability), capped at 8,000 characters (roughly 2.2k tokens) so it fits the 16k context. |

Start SearXNG once (podman on Fedora, docker on macOS):

```bash
./scripts/searxng.sh          # http://127.0.0.1:8888, bound to localhost only
podman stop searxng           # to stop it
```

The script copies `searxng/settings.template.yml` to `searxng/settings.yml`, which is gitignored and holds a generated
secret key. It enables the JSON output format the app needs and mounts the file read-only.
`SEARXNG_URL` in `.env.local` points the app at it. If SearXNG isn't reachable, the globe is disabled and chat works
as before.

How a reply with tools works:

1. The browser sends `tools: true`. The **server** attaches the tool schemas, so the client never sends schemas of its own.
2. When the model returns `tool_calls`, the browser runs each call through `/api/tools`. The server performs the search
   or fetch. The result goes back to the model as a `tool` message, and the model is called again.
3. Each step appears above the answer: "Searched “…” · 5 results" and "Read example.com". Expand a step to see the links.
4. Tools are executed in at most 4 rounds per reply. After that, any further calls get a "tool limit reached, answer now"
   result instead. Calls to tools that don't exist (small models sometimes invent one) get an error that lists the real
   tools.
5. A system preamble gives the models today's date. Without it, Gemma guessed the wrong year for "yesterday".

tok/s for a tool reply is total tokens divided by total decode time across all rounds (`mergeFinal` in `lib/metrics.ts`).

**Network and safety.** This is the only feature that makes outbound requests, and only from the server, only while the
globe is on and the model decides to call a tool.
- `fetch_url` is driven by model output. It **refuses any loopback, private, link-local or multicast address**.
- That check runs inside the socket's own DNS lookup, so DNS rebinding and redirects into your LAN are also blocked,
  as are tricks such as `0x7f000001` or `[::ffff:127.0.0.1]`.
- Fetched page text is untrusted: the preamble tells the model to treat it as data, but a hostile page can still try to
  steer the answer, so read the cited sources before trusting it.
- Images in answers are rendered as links, never loaded automatically, and a Content-Security-Policy
  (`img-src 'self'; connect-src 'self'`) blocks a hostile page from making the answer leak your chat through an image URL.
- `npm run dev` and `npm start` bind to **127.0.0.1 only**. The API routes reject any non-local `Host` header
  (blocking DNS rebinding), cross-site `Origin`s, and non-JSON bodies. To use the app from another machine, you'd need to
  relax both deliberately.
- The SearXNG image is pinned by digest in `scripts/searxng.sh`.

## Troubleshooting

### CORS

Ollama rejects cross-origin browser requests unless `OLLAMA_ORIGINS` is set, which would mean editing the systemd unit and
restarting the service. This app avoids the problem entirely. The browser only calls `/api/chat` and `/api/health` on its
own origin, and the Next.js server forwards those to Ollama. If you see a CORS error, something is calling
`127.0.0.1:11434` from client code. That should never happen.

### Model eviction when switching

With 31 GB of unified memory, only one of these models fits at a time. Selecting another model and sending a message makes
Ollama unload the current one and load the new one. In a chat that already has messages, the app warns you before
switching. The green dot in the model picker means the model is resident right now.

### Slow first token after switching

Loading 15–19 GB of weights takes 10–40 s. During that time the reply shows "Loading <model> into memory…" with a live
timer, and the finished reply gets a `cold start` badge that shows `load_duration`. Later replies are fast while the model
stays resident: requests send `keep_alive: "15m"`.

### Why the thread count is baked into the aliases

On these MoE models, decoding with 10 threads measured about half the speed of 6. Each alias
(`local-*-t6`) pins `PARAMETER num_thread 6`, so every client gets the fast setting automatically. The app deliberately
never sends `num_thread` or `num_ctx`. Changing either one per request forces Ollama to reload the model, which costs a full
cold start and can silently fall back to the slow thread count. Context stays at the server default of 16384
(`OLLAMA_CONTEXT_LENGTH`), so there is no context control in the UI.

### `done_reason: length`

The model hit `num_predict` (the **Max tokens** setting, default 4096 per model call) before it finished. Thinking tokens count toward
that limit. If a reasoning model spends the whole budget thinking, the reply shows "Hit the token limit while still
thinking". Raise max tokens in Settings and press Retry.

### Other errors

| Message | Meaning |
|---|---|
| Ollama isn't running — start it with `ollama serve` | The proxy got `ECONNREFUSED` from `OLLAMA_BASE_URL`. |
| Model `local-…-t6` isn't installed | Ollama returned 404. The error card gives two commands to copy: `ollama pull` for the base weights, then the `setup.sh` command that recreates the alias. |
| The model produced no output | The stream ended with `done_reason: stop` and an empty answer. |
| Retry chip under partial text | The stream failed mid-reply. The partial text is kept. |

## Layout

```
app/api/chat/route.ts     NDJSON proxy to Ollama (validates input, maps errors, pipes the body)
app/api/health/route.ts   /api/tags + /api/ps + SearXNG → installed/resident models, search on/off
app/api/tools/route.ts    runs web_search / fetch_url
lib/tools.ts              tool schemas, limits, preamble
lib/searxng.ts            SearXNG JSON search
lib/fetchPage.ts          guarded page fetch + Readability extraction
lib/chatRound.ts          one streamed model round + tool execution client
lib/ndjson.ts             incremental NDJSON parser
lib/metrics.ts            tok/s and cold-start maths
lib/ollama.ts             client: streamChat(), typed errors, health
lib/tokens.ts             chars/3.6 estimate and history trimming
lib/storage.ts            idb-keyval persistence
hooks/useChat.ts          send / stop / retry / edit, frame-batched streaming
hooks/useConversations.ts conversations, autosave, restore on load
components/               UI (shadcn/ui primitives in components/ui)
```
