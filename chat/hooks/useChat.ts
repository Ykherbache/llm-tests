"use client";

import { nanoid } from "nanoid";
import { useCallback, useEffect, useRef, useState } from "react";
import { numGpuFor } from "@/lib/backend";
import { EFFORT, predictFor, STOP_THINKING } from "@/lib/effort";
import { runTool, streamRound, type RoundDelta } from "@/lib/chatRound";
import { computeMetrics, mergeFinal } from "@/lib/metrics";
import { ChatError, isAbortError } from "@/lib/ollama";
import { estimateMessages, estimateTokens, TRIM_BUDGET_TOKENS, trimHistory, type WireMessage } from "@/lib/tokens";
import {
  isToolName,
  TOOL_CONTEXT_CAP,
  TOOL_HISTORY_BUDGET,
  TOOL_LIMIT_REACHED,
  TOOL_NAME_RE,
  toolLabel,
  toolPreamble,
  enablePreamble,
  type ToolName,
  type ToolsMode,
} from "@/lib/tools";
import type { BackendMode, ChatErrorInfo, Effort, ConversationMeta, Message, MessageMetrics, OllamaChunk, ToolStep } from "@/lib/types";
import type { ConversationsApi } from "./useConversations";

/** No first token after this long = assume the weights are being loaded. */
const SLOW_FIRST_TOKEN_MS = 2500;

export type PhaseKind = "idle" | "waiting" | "loading" | "thinking" | "answering" | "tool";
export interface Phase {
  kind: PhaseKind;
  /** While kind is "tool": what is running, e.g. "Searching: ollama release". */
  tool?: string;
  startedAt: number;
  /** First reasoning token; 0 until the model starts thinking. */
  thinkingStartedAt: number;
  model: string;
}
const IDLE: Phase = { kind: "idle", startedAt: 0, thinkingStartedAt: 0, model: "" };

interface Options {
  api: ConversationsApi;
  systemPromptFor: (c: ConversationMeta) => string;
  /** Whether Ollama currently has `model` resident (from /api/ps). */
  isLoaded: (model: string) => boolean;
  onSettled: () => void;
  /** Non-null while sending must not happen (context full, model missing, loading). */
  blockedReason: string | null;
  /** Offer web_search / fetch_url (setting on and SearXNG reachable). */
  toolsEnabled: boolean;
  /** Web search is off: offer enable_web_search so the model can turn it on. */
  offerEnable: boolean;
  /** Where to run the model, and for Hybrid how many layers go to the GPU. */
  backend: BackendMode;
  gpuLayers: number | null;
  /** Layer count of the active model once known (from /api/model). */
  layers: number | null;
  /** How much to think and search for the next reply. */
  effort: Effort;
}


function toWire(history: readonly Message[]): WireMessage[] {
  // Only answers go back to the model; thinking text and failed empty
  // replies would just burn context.
  return history
    .filter((m) => m.content.trim() !== "")
    .map((m): WireMessage => ({ role: m.role, content: m.content }));
}

/** Estimated prompt size, used when no fresh prompt_eval_count is available. */
function estimateContext(system: string, history: readonly Message[]): number {
  return estimateMessages(trimHistory(system, toWire(history)).messages);
}

export function useChat(options: Options) {
  const [phase, setPhase] = useState<Phase>(IDLE);
  const abortRef = useRef<AbortController | null>(null);
  // Latest options/messages behind refs so every returned callback is stable
  // and memoised messages don't re-render on each streamed frame.
  const opts = useRef(options);
  const messagesRef = useRef<Message[]>(options.api.messages);
  useEffect(() => {
    opts.current = options;
    messagesRef.current = options.api.messages;
  });

  const generating = phase.kind !== "idle";

  const run = useCallback(
    async (conv: ConversationMeta, base: Message[]) => {
      if (abortRef.current || opts.current.blockedReason) return;
      const controller = new AbortController();
      abortRef.current = controller;
      const { api, isLoaded, systemPromptFor, toolsEnabled, offerEnable, backend, gpuLayers, layers, effort } = opts.current;
      const profile = EFFORT[effort];
      const numGpu = numGpuFor(backend, layers, gpuLayers);
      const model = conv.model;
      const startedAt = Date.now();

      const assistant: Message = {
        id: nanoid(),
        role: "assistant",
        content: "",
        thinking: "",
        model,
        backend: { mode: backend, numGpu },
        effort,
        createdAt: startedAt,
        status: "streaming",
      };
      // Autosave the user turn right away; the reply is saved when it settles.
      api.commitMessages(conv.id, base);
      let list = [...base, assistant];
      api.setLiveMessages(conv.id, list);

      setPhase({ kind: isLoaded(model) ? "waiting" : "loading", startedAt, thinkingStartedAt: 0, model });
      const slowTimer = window.setTimeout(() => {
        setPhase((p) => (p.kind === "waiting" ? { ...p, kind: "loading" } : p));
      }, SLOW_FIRST_TOKEN_MS);

      // Tokens accumulate here; React state is updated at most once per frame.
      const acc = { content: "", thinking: "", thinkingStart: 0, thinkingMs: 0, needSep: false, steps: [] as ToolStep[] };
      let frame: number | null = null;
      let timer: number | null = null;
      const flush = () => {
        if (frame !== null) cancelAnimationFrame(frame);
        if (timer !== null) window.clearTimeout(timer);
        frame = null;
        timer = null;
        list = list.map((m) =>
          m.id === assistant.id
            ? {
                ...m,
                content: acc.content,
                thinking: acc.thinking,
                thinkingMs: acc.thinkingMs || undefined,
                toolSteps: acc.steps.length ? acc.steps.map((st) => ({ ...st })) : undefined,
              }
            : m,
        );
        api.setLiveMessages(conv.id, list);
      };
      const schedule = () => {
        if (frame !== null || timer !== null) return;
        // rAF is paused in background tabs; fall back to a timer there so the
        // stream keeps being consumed and the message keeps updating.
        if (document.hidden) timer = window.setTimeout(flush, 250);
        else frame = requestAnimationFrame(flush);
      };
      const onDelta = (d: RoundDelta) => {
        if (d.thinking) {
          if (!acc.thinkingStart) acc.thinkingStart = Date.now();
          // Separate the reasoning of successive tool rounds (once, on the round's first delta).
          if (acc.needSep) {
            acc.thinking += "\n\n";
            acc.needSep = false;
          }
          acc.thinking += d.thinking;
          const since = acc.thinkingStart;
          if (!acc.content) {
            setPhase((p) => (p.kind === "thinking" ? p : { ...p, kind: "thinking", thinkingStartedAt: since }));
          }
        }
        if (d.content) {
          if (acc.thinkingStart && !acc.thinkingMs) acc.thinkingMs = Date.now() - acc.thinkingStart;
          acc.content += d.content;
          setPhase((p) => (p.kind === "answering" ? p : { ...p, kind: "answering" }));
        }
        schedule();
      };

      let final: OllamaChunk | null = null;
      let finished = false;
      let status: Message["status"] = "done";
      let error: ChatErrorInfo | undefined;

      try {
        // "enable" = web search is off but the model may turn it on; once it does, the mode becomes true.
        // Low effort gets web_search alone: snippets, no page reading.
        const webMode: ToolsMode = profile.fetch ? true : "search";
        let mode: ToolsMode = toolsEnabled ? webMode : offerEnable ? "enable" : false;
        const build = (m: ToolsMode) => {
          const preamble = m === "enable" ? enablePreamble() : m ? toolPreamble(m === true) : "";
          const system = [preamble, profile.instruction, systemPromptFor(conv)].filter(Boolean).join("\n\n");
          // With tools on, leave room in the 16k window for search results and pages.
          return trimHistory(system, toWire(base), m ? TOOL_HISTORY_BUDGET : undefined).messages;
        };
        let messages = build(mode);
        let baseTokens = estimateMessages(messages);
        // Tool round-trips of THIS reply only; earlier replies are sent as plain answers.
        const turn: WireMessage[] = [];
        // Rounds in which tools ran, and whether the next call must wrap up its thinking.
        let toolRound = 0;
        let wrapUp = false;

        for (;;) {
          acc.needSep = acc.thinking !== "";
          const result = await streamRound(
            {
              model,
              messages: [...messages, ...turn, ...(wrapUp ? [{ role: "user" as const, content: STOP_THINKING }] : [])],
              options: {
                num_predict: predictFor(effort, conv.maxTokens),
                temperature: conv.temperature,
                num_gpu: numGpu,
              },
              tools: mode,
              backend,
            },
            controller.signal,
            onDelta,
            wrapUp ? null : profile.thinkingBudget,
          );
          if (result.final) final = mergeFinal(final, result.final);
          if (result.overBudget) {
            // Reasoned past the budget: ask once more, without a limit, for the answer (or the one tool call).
            wrapUp = true;
            continue;
          }
          wrapUp = false;
          if (!result.final) break;
          const calls = mode ? result.toolCalls : [];
          if (calls.length === 0) {
            finished = true;
            break;
          }
          // Text the model wrote before calling tools belongs to that round, not the answer.
          acc.content = acc.content.slice(0, acc.content.length - result.content.length);
          // ...it goes into the thinking fold with the call itself, so the round can be diagnosed there.
          const callText = result.rawCalls.length
            ? result.rawCalls
            : calls.map((c) => `→ ${c.function.name}(${JSON.stringify(c.function.arguments)})`);
          const note = [result.content.trim(), ...callText].filter(Boolean).join("\n");
          if (!acc.thinkingStart) acc.thinkingStart = Date.now();
          acc.thinking += (acc.thinking ? "\n\n" : "") + note;
          // ...and it didn't end the thinking: keep timing until the real answer starts.
          if (!acc.content) acc.thinkingMs = 0;
          flush();
          const round = toolRound++;
          if (round > profile.toolRounds) {
            error = { code: "stream", message: "The model kept calling tools instead of answering.", model };
            break;
          }
          // Out of rounds, or tool output already fills the context budget.
          const exhausted = round >= profile.toolRounds || baseTokens + estimateMessages(turn) > TOOL_CONTEXT_CAP;

          // Echo the calls back in a shape the proxy accepts, even for invented names.
          const echoed = calls.map((c) => ({
            function: {
              name: TOOL_NAME_RE.test(c.function.name) ? c.function.name : "unknown_tool",
              arguments: c.function.arguments && typeof c.function.arguments === "object" ? c.function.arguments : {},
            },
          }));
          turn.push({ role: "assistant", content: result.content, tool_calls: echoed });
          // Calls that can run are started together; every result is added in the model's order.
          const planned = echoed.map((call) => {
            const name = call.function.name;
            const args = call.function.arguments;
            const skip = (content: string) => ({ name, content, step: null as ToolStep | null, args });
            if (!isToolName(name)) {
              // Small models sometimes invent a tool; say so and let them retry.
              const real = mode === "search" ? "web_search" : "web_search, fetch_url";
              return skip(`Error: there is no tool named "${name}". Available tools: ${real}.`);
            }
            if (exhausted) return skip(TOOL_LIMIT_REACHED);
            if (mode === "enable" && name !== "enable_web_search") {
              return skip("Error: web search is off. Call enable_web_search first.");
            }
            if (mode === "search" && name === "fetch_url") {
              return skip("Error: fetch_url is not available. Answer from the search results.");
            }
            const step: ToolStep = { id: nanoid(), name, args, status: "running" };
            acc.steps.push(step);
            return { name, content: "", step, args };
          });
          const running = planned.filter((c) => c.step);
          if (running.length) {
            const label = running.map((c) => toolLabel(c.name as ToolName, c.args)).join(" · ");
            setPhase((p) => ({ ...p, kind: "tool", tool: label }));
            flush();
          }
          const outs = await Promise.all(
            planned.map(async (c) => {
              if (!c.step) return null;
              const pageChars = c.name === "web_search" ? profile.searchPageChars : profile.pageChars;
              return runTool(c.name as ToolName, c.args, controller.signal, pageChars);
            }),
          );
          planned.forEach((c, i) => {
            const out = outs[i];
            if (!c.step || !out) {
              turn.push({ role: "tool", tool_name: c.name, content: c.content });
              return;
            }
            Object.assign(c.step, {
              status: out.error ? "error" : "done",
              error: out.error,
              hits: out.hits,
              page: out.page,
            });
            turn.push({ role: "tool", tool_name: c.name, content: out.content });
            if (c.name === "enable_web_search" && !out.error) {
              // Web search is up: from the next round on, the model gets the real tools.
              mode = webMode;
              messages = build(mode);
              baseTokens = estimateMessages(messages);
              api.updateSettings({ toolsEnabled: true });
            }
          });
          flush();
          setPhase((p) => ({ ...p, kind: "waiting", tool: undefined, startedAt: Date.now() }));
        }

        if (!finished || !final) {
          status = "error";
          error ??= { code: "stream", message: "The stream ended before the model finished.", model };
        } else if (!acc.content.trim()) {
          status = "error";
          const reason = final.done_reason;
          error = {
            code: "empty",
            model,
            message:
              reason === "length"
                ? acc.thinking
                  ? "Hit the token limit while still thinking — no answer yet. Raise max tokens and retry."
                  : "Hit the token limit before producing any output."
                : acc.thinking
                  ? "The model only produced reasoning and no answer."
                  : "The model produced no output.",
          };
        }
      } catch (e) {
        if (isAbortError(e) || controller.signal.aborted) {
          status = "stopped";
        } else {
          status = "error";
          error =
            e instanceof ChatError
              ? e.info
              : { code: "stream", message: e instanceof Error ? e.message : String(e), model };
        }
      } finally {
        window.clearTimeout(slowTimer);
        if (frame !== null) cancelAnimationFrame(frame);
        if (timer !== null) window.clearTimeout(timer);
        if (acc.thinkingStart && !acc.thinkingMs) acc.thinkingMs = Date.now() - acc.thinkingStart;
        // A stop mid-tool leaves the step "running"; it never finished.
        for (const step of acc.steps) {
          if (step.status === "running") Object.assign(step, { status: "error", error: "Stopped" });
        }

        const metrics: MessageMetrics | undefined = final ? computeMetrics(final) : undefined;
        const settled: Message = {
          ...assistant,
          content: acc.content,
          thinking: acc.thinking,
          thinkingMs: acc.thinkingMs || undefined,
          status,
          metrics,
          error,
          toolSteps: acc.steps.length ? acc.steps.map((st) => ({ ...st })) : undefined,
        };
        list = [...base, settled];
        messagesRef.current = list;
        api.commitMessages(conv.id, list, {
          // A tool reply's last prompt includes search results and pages that later
          // turns never resend, so estimate from the history instead.
          contextTokens:
            metrics && acc.steps.length === 0 ? metrics.promptTokens : estimateContext(systemPromptFor(conv), list),
        });
        abortRef.current = null;
        setPhase(IDLE);
        opts.current.onSettled();
      }
    },
    [],
  );

  const send = useCallback(
    (text: string) => {
      const content = text.trim();
      if (!content || abortRef.current) return;
      if (opts.current.blockedReason) return;
      const conv = opts.current.api.ensureConversation();
      if (!conv) return;
      const user: Message = { id: nanoid(), role: "user", content, createdAt: Date.now() };
      void run(conv, [...messagesRef.current, user]);
    },
    [run],
  );

  /** Re-run the reply at `assistantId` (default: the last one), dropping it and anything after. */
  const retry = useCallback(
    (assistantId?: string) => {
      const conv = opts.current.api.active;
      if (!conv || abortRef.current) return;
      const msgs = messagesRef.current;
      const idx = assistantId
        ? msgs.findIndex((m) => m.id === assistantId)
        : msgs.findLastIndex((m) => m.role === "assistant");
      const base = idx >= 0 ? msgs.slice(0, idx) : msgs;
      if (base.at(-1)?.role !== "user") return;
      void run(conv, base);
    },
    [run],
  );

  const editAndResend = useCallback(
    (userId: string, text: string) => {
      const conv = opts.current.api.active;
      const content = text.trim();
      if (!conv || !content || abortRef.current) return;
      const msgs = messagesRef.current;
      const idx = msgs.findIndex((m) => m.id === userId);
      if (idx < 0) return;
      void run(conv, [...msgs.slice(0, idx), { ...msgs[idx], content, createdAt: Date.now() }]);
    },
    [run],
  );

  const deleteMessage = useCallback(
    (id: string) => {
      const { api, systemPromptFor } = opts.current;
      const conv = api.active;
      if (!conv || abortRef.current || api.messagesLoading) return;
      const kept = messagesRef.current.filter((m) => m.id !== id);
      api.commitMessages(conv.id, kept, { contextTokens: estimateContext(systemPromptFor(conv), kept) });
    },
    [],
  );

  /**
   * Context-meter escape hatch. A prompt that is still >95 % full after
   * trimming means the recent messages themselves are large (or the
   * chars/3.6 estimate undercounts, as it does for code), so keep only as
   * many recent messages as fit in half the trim budget - at least the
   * last exchange.
   */
  const dropOldest = useCallback(() => {
    const { api, systemPromptFor } = opts.current;
    const conv = api.active;
    if (!conv || abortRef.current || api.messagesLoading) return;
    const msgs = messagesRef.current;
    let start = msgs.length;
    let total = 0;
    while (start > 0) {
      const cost = estimateTokens(msgs[start - 1].content);
      if (msgs.length - start >= 2 && total + cost > TRIM_BUDGET_TOKENS / 2) break;
      total += cost;
      start--;
    }
    const kept = msgs.slice(start);
    api.commitMessages(conv.id, kept, { contextTokens: estimateContext(systemPromptFor(conv), kept) });
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // Never leave a request running after unmount.
  useEffect(() => () => abortRef.current?.abort(), []);

  return {
    phase,
    generating,
    send,
    retry,
    editAndResend,
    deleteMessage,
    dropOldest,
    stop,
  };
}
