import type { Effort } from "./types";

export interface EffortProfile {
  label: string;
  /** One line for the picker tooltip. */
  hint: string;
  /** Appended to the system prompt; empty = nothing added. */
  instruction: string;
  /** Thinking tokens allowed per model call before the model is told to stop; null = unlimited. */
  thinkingBudget: number | null;
  /** Rounds in which tool calls are executed. */
  toolRounds: number;
  /** fetch_url is offered next to web_search. */
  fetch: boolean;
  /** Characters of the best readable result that web_search appends, so the model needs no fetch round; 0 = none. */
  searchPageChars: number;
  /** Characters of text fetch_url returns. */
  pageChars: number;
}

export const EFFORTS: readonly Effort[] = ["low", "medium", "high", "max"];
export const DEFAULT_EFFORT: Effort = "medium";

export const EFFORT: Record<Effort, EffortProfile> = {
  low: {
    label: "Low",
    hint: "Answers straight away: almost no reasoning, one search at most, snippets only",
    instruction: "Answer directly and concisely. Do not deliberate: think for a sentence at most.",
    thinkingBudget: 256,
    toolRounds: 1,
    fetch: false,
    searchPageChars: 0,
    pageChars: 4000,
  },
  medium: {
    label: "Medium",
    hint: "Brief reasoning, up to two tool rounds, shorter pages",
    instruction: "Reason briefly (a few sentences), then answer.",
    thinkingBudget: 1024,
    toolRounds: 2,
    fetch: true,
    searchPageChars: 3000,
    pageChars: 4000,
  },
  high: {
    label: "High",
    hint: "Full reasoning, up to four tool rounds",
    instruction: "",
    thinkingBudget: null,
    toolRounds: 4,
    fetch: true,
    searchPageChars: 3000,
    pageChars: 8000,
  },
  max: {
    label: "Max",
    hint: "Takes its time: verifies, up to six tool rounds, larger answers",
    instruction: "Take your time: reason carefully, check your work and cross-check sources before answering.",
    thinkingBudget: null,
    toolRounds: 6,
    fetch: true,
    searchPageChars: 3000,
    pageChars: 8000,
  },
};

/** Asked of the model when its thinking budget runs out. */
export const STOP_THINKING = "Stop reasoning now. Call a tool only if you truly need one, otherwise give your answer.";

/** num_predict for a call: low and medium cap the chat's Max tokens, max raises it, high leaves it alone. */
export function predictFor(effort: Effort, chatMax: number): number {
  if (effort === "low") return Math.min(chatMax, 1024);
  if (effort === "medium") return Math.min(chatMax, 2048);
  if (effort === "max") return Math.max(chatMax, 8192);
  return chatMax;
}
