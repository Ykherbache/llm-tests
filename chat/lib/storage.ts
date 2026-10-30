import { del, get, set } from "idb-keyval";
import { DEFAULT_EFFORT } from "./effort";
import { DEFAULT_MODEL } from "./models";
import type { ConversationMeta, Message, Settings } from "./types";

// Layout: one index of conversation metadata, one key per conversation's
// messages (so saving a reply never rewrites every conversation), settings.
const INDEX_KEY = "convs";
const SETTINGS_KEY = "settings";
const msgsKey = (id: string) => `msgs:${id}`;

export const DEFAULT_SETTINGS: Settings = {
  defaultSystemPrompt: "",
  lastModel: DEFAULT_MODEL,
  toolsEnabled: true,
  // CPU first: GPU runs make the Asahi desktop stutter.
  backend: "cpu",
  gpuLayers: null,
  effort: DEFAULT_EFFORT,
};

export async function loadIndex(): Promise<ConversationMeta[]> {
  return (await get<ConversationMeta[]>(INDEX_KEY)) ?? [];
}

export async function saveIndex(convs: ConversationMeta[]): Promise<void> {
  await set(INDEX_KEY, convs);
}

export async function loadMessages(id: string): Promise<Message[]> {
  return (await get<Message[]>(msgsKey(id))) ?? [];
}

export async function saveMessages(id: string, messages: Message[]): Promise<void> {
  await set(msgsKey(id), messages);
}

export async function deleteMessages(id: string): Promise<void> {
  await del(msgsKey(id));
}

export async function loadSettings(): Promise<Settings> {
  return { ...DEFAULT_SETTINGS, ...((await get<Partial<Settings>>(SETTINGS_KEY)) ?? {}) };
}

export async function saveSettings(settings: Settings): Promise<void> {
  await set(SETTINGS_KEY, settings);
}
