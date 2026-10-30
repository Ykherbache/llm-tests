import { streamChat, type ChatRequest } from "./ollama";
import { estimateTokens } from "./tokens";
import { extractToolCalls, visibleText } from "./toolCallFallback";
import type { ToolName, ToolResult } from "./tools";
import type { OllamaChunk, ToolCall } from "./types";

export interface RoundDelta {
  content?: string;
  thinking?: string;
}

export interface RoundResult {
  content: string;
  thinking: string;
  toolCalls: ToolCall[];
  /** The text the model wrote for calls that arrived as text, for the thinking fold. */
  rawCalls: string[];
  /** The `done: true` chunk, or null if the stream ended early. */
  final: OllamaChunk | null;
  /** The round was cut because its thinking went over the budget. */
  overBudget: boolean;
}

/**
 * Streams one model call; deltas are reported as they arrive. With tools on, a
 * tool call that the server left as text (<|tool_call_start|>...) is hidden
 * from the deltas and returned as a structured call instead.
 *
 * `thinkingBudget` (estimated tokens) cuts the round once the reasoning alone
 * passes it and no answer has started; the caller then asks the model to stop thinking.
 */
export async function streamRound(
  req: ChatRequest,
  signal: AbortSignal,
  onDelta: (d: RoundDelta) => void,
  thinkingBudget: number | null = null,
): Promise<RoundResult> {
  const out: RoundResult = { content: "", thinking: "", toolCalls: [], rawCalls: [], final: null, overBudget: false };
  const cut = new AbortController();
  const roundSignal = AbortSignal.any([signal, cut.signal]);
  const hide = req.tools;
  const shown = { content: 0, thinking: 0 };
  try {
    for await (const chunk of streamChat(req, roundSignal)) {
      out.thinking += chunk.message?.thinking ?? "";
      out.content += chunk.message?.content ?? "";
      // Ollama sends each tool call whole (parsed arguments), not as fragments.
      if (chunk.message?.tool_calls?.length) out.toolCalls.push(...chunk.message.tool_calls);
      const thinking = (hide ? visibleText(out.thinking) : out.thinking).slice(shown.thinking);
      const content = (hide ? visibleText(out.content) : out.content).slice(shown.content);
      shown.thinking += thinking.length;
      shown.content += content.length;
      if (thinking || content) onDelta({ thinking: thinking || undefined, content: content || undefined });
      if (chunk.done) out.final = chunk;
      if (thinkingBudget !== null && !out.content && estimateTokens(out.thinking) > thinkingBudget) {
        out.overBudget = true;
        cut.abort();
        break;
      }
    }
  } catch (e) {
    // Our own cut is not an error; a Stop from the user still is.
    if (!out.overBudget || signal.aborted) throw e;
  }
  if (!hide || out.overBudget) return out;

  // Text-format calls count only when the server sent no structured ones.
  const viaText = out.toolCalls.length === 0;
  for (const field of ["content", "thinking"] as const) {
    const found = viaText ? extractToolCalls(out[field]) : { calls: [], text: out[field], raw: [] };
    if (found.calls.length > 0) {
      // Keep exactly what was shown; the call itself is no longer text.
      out.toolCalls.push(...found.calls);
      out.rawCalls.push(...found.raw);
      out[field] = visibleText(out[field]);
    } else {
      // Nothing parsed: show whatever was held back for a possible marker.
      const held = out[field].slice(shown[field]);
      if (held) onDelta({ [field]: held });
    }
  }
  return out;
}

/** Runs one tool on the server. A failed tool resolves with `error` set. */
export async function runTool(
  name: ToolName,
  args: Record<string, unknown>,
  signal: AbortSignal,
  pageChars?: number,
): Promise<ToolResult> {
  const res = await fetch("/api/tools", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, arguments: args, pageChars }),
    signal,
  });
  let body: Partial<ToolResult> & { message?: string } = {};
  try {
    body = (await res.json()) as typeof body;
  } catch (e) {
    // A Stop while the body is being read must surface as a stop, not "done".
    if (signal.aborted) throw e;
  }
  if (!res.ok) {
    const message = body.message ?? `Tool request failed with HTTP ${res.status}`;
    return { content: `Error: ${message}`, error: message };
  }
  return { content: body.content ?? "", error: body.error, hits: body.hits, page: body.page };
}
