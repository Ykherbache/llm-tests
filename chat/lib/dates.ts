import type { ConversationMeta } from "./types";

export const DATE_GROUPS = ["Today", "Yesterday", "Previous 7 days", "Older"] as const;
export type DateGroup = (typeof DATE_GROUPS)[number];

function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function dateGroup(updatedAt: number, now = Date.now()): DateGroup {
  const today = startOfDay(now);
  const day = 24 * 60 * 60 * 1000;
  if (updatedAt >= today) return "Today";
  if (updatedAt >= today - day) return "Yesterday";
  if (updatedAt >= today - 7 * day) return "Previous 7 days";
  return "Older";
}

export function groupConversations(
  convs: readonly ConversationMeta[],
  now = Date.now(),
): { group: DateGroup; items: ConversationMeta[] }[] {
  const sorted = [...convs].sort((a, b) => b.updatedAt - a.updatedAt);
  return DATE_GROUPS.map((group) => ({
    group,
    items: sorted.filter((c) => dateGroup(c.updatedAt, now) === group),
  })).filter((g) => g.items.length > 0);
}

/** Title from the first user message, no model call. */
export function makeTitle(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return "New chat";
  return flat.length > 50 ? `${flat.slice(0, 50).trimEnd()}…` : flat;
}
