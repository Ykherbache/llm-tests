import type { ChatRole, ToolCall } from "./types";

export const TRIM_BUDGET_TOKENS = 12_000;
export const KEEP_LAST_MESSAGES = 6;

export interface WireMessage {
  role: ChatRole;
  content: string;
  /** role "tool": which tool produced this result. */
  tool_name?: string;
  /** role "assistant": calls the model made in this round. */
  tool_calls?: ToolCall[];
}

/** Rough token estimate; ~3.6 chars per token for mixed English and code. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.6);
}

export function estimateMessages(messages: readonly WireMessage[]): number {
  return messages.reduce((n, m) => n + estimateTokens(m.content), 0);
}

/**
 * Drops the oldest messages until the estimate fits the budget, but never
 * drops the system prompt or any of the last KEEP_LAST_MESSAGES messages.
 */
export function trimHistory(
  system: string,
  history: readonly WireMessage[],
  budget = TRIM_BUDGET_TOKENS,
): { messages: WireMessage[]; dropped: number } {
  const rest = [...history];
  let total = estimateTokens(system) + estimateMessages(rest);
  let dropped = 0;
  while (total > budget && rest.length > KEEP_LAST_MESSAGES) {
    const removed = rest.shift();
    if (removed) total -= estimateTokens(removed.content);
    dropped++;
  }
  const messages: WireMessage[] = system.trim()
    ? [{ role: "system", content: system }, ...rest]
    : rest;
  return { messages, dropped };
}
