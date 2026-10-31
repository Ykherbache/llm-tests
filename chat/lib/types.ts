import type { SearchHit, ToolName, ToolResult } from "./tools";

export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ToolCall {
  id?: string;
  function: { name: string; arguments: Record<string, unknown> };
}

/** One line of Ollama's /api/chat NDJSON stream. */
export interface OllamaChunk {
  model?: string;
  created_at?: string;
  message?: { role?: string; content?: string; thinking?: string; tool_calls?: ToolCall[] };
  done?: boolean;
  done_reason?: string;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_cached_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
  error?: string;
}

export interface MessageMetrics {
  tokensPerSecond: number;
  evalCount: number;
  evalDurationMs: number;
  promptTokens: number;
  promptCachedTokens: number;
  cached: boolean;
  loadDurationMs: number;
  totalDurationMs: number;
  coldStart: boolean;
  doneReason: string;
}

export type ChatErrorCode =
  | "ollama_down"
  | "model_not_found"
  | "bad_request"
  | "upstream"
  | "stream"
  | "network"
  | "empty";

export interface ChatErrorInfo {
  code: ChatErrorCode;
  message: string;
  model?: string;
}

/** One tool call made while producing an assistant reply. */
export interface ToolStep {
  id: string;
  name: ToolName;
  args: Record<string, unknown>;
  status: "running" | "done" | "error";
  error?: string;
  hits?: SearchHit[];
  page?: ToolResult["page"];
}

/** Where inference is asked to run: all CPU, some layers on the GPU, or all on the GPU. */
export type BackendMode = "cpu" | "prefill" | "hybrid" | "gpu";

export interface BackendUsed {
  mode: BackendMode;
  /** The num_gpu value that was sent (layers offloaded). */
  numGpu: number;
}

/** How much the model is asked to think and search for a reply. */
export type Effort = "low" | "medium" | "high" | "max";

export type MessageStatus = "streaming" | "done" | "stopped" | "error";

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
  /** Assistant only. */
  thinking?: string;
  thinkingMs?: number;
  model?: string;
  /** The backend this reply was requested on, for comparing runs. */
  backend?: BackendUsed;
  effort?: Effort;
  status?: MessageStatus;
  metrics?: MessageMetrics;
  error?: ChatErrorInfo;
  /** Tool calls made for this reply, in order. */
  toolSteps?: ToolStep[];
}

export interface ConversationMeta {
  id: string;
  title: string;
  titleEdited: boolean;
  createdAt: number;
  updatedAt: number;
  model: string;
  /** null = use the global default system prompt. */
  systemPrompt: string | null;
  temperature: number;
  maxTokens: number;
  messageCount: number;
  /** prompt_eval_count of the latest reply (or an estimate after trimming). */
  contextTokens: number;
}

export interface Settings {
  defaultSystemPrompt: string;
  lastModel: string;
  /** Offer web_search / fetch_url to the models. */
  toolsEnabled: boolean;
  backend: BackendMode;
  /** Hybrid only: layers on the GPU. null = half the model. */
  gpuLayers: number | null;
  effort: Effort;
}

export type CatalogSource = "ollama" | "hf";

/** A model found by searching ollama.com or Hugging Face. */
export interface CatalogHit {
  source: CatalogSource;
  /** Ollama library name ("qwen3") or Hugging Face repo ("unsloth/Qwen3.5-4B-GGUF"). */
  name: string;
  description?: string;
  /** tools / vision / thinking... */
  capabilities?: string[];
  /** Parameter sizes the library offers ("8b", "30b"). */
  sizes?: string[];
  downloads?: number;
}

/** One downloadable size/quantisation of a hit; `tag` is what /api/pull takes. */
export interface CatalogVariant {
  tag: string;
  sizeBytes: number;
  note?: string;
}

export type BoardId = "arena" | "livebench_coding" | "aider" | "aa_index";
export type TaskId = "chat" | "coding" | "overall";

/** A model from the leaderboard snapshot: where to download it and how the public boards scored it. */
export interface LbModel {
  id: string;
  /** Names the boards use for it, to match live scores against. */
  names: string[];
  totalB: number;
  activeB: number;
  tags: { ollama?: string; hf?: string };
  sizeBytes: number;
  /** false = the download tag was proposed by the refresh script and not yet checked by hand. */
  verified?: boolean;
  /** Key of the matching row in lib/benchmarks.ts, when this machine measured it. */
  benchId?: string;
  scores: Record<BoardId, number | null>;
  /** Boards whose score here came from a live fetch rather than the snapshot. */
  live?: BoardId[];
}

export interface Recommendations {
  models: LbModel[];
  /** Per board: whether the live fetch worked, and the date of the data. */
  boards: Record<BoardId, { live: boolean; date: string }>;
}
