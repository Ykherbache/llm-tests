"use client";

import { nanoid } from "nanoid";
import { useCallback, useEffect, useRef, useState } from "react";
import { makeTitle } from "@/lib/dates";
import { DEFAULT_MAX_TOKENS, DEFAULT_TEMPERATURE, modelInfo } from "@/lib/models";
import * as store from "@/lib/storage";
import type { ConversationMeta, Message, Settings } from "@/lib/types";

const ACTIVE_KEY = "activeConversation";

function logStorageError(e: unknown) {
  console.error("IndexedDB write failed", e);
}

function readActiveId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}

function writeActiveId(id: string | null) {
  try {
    if (id) localStorage.setItem(ACTIVE_KEY, id);
    else localStorage.removeItem(ACTIVE_KEY);
  } catch {
    // storage blocked; the next load just opens the newest chat
  }
}

export function useConversations() {
  const [conversations, setConversations] = useState<ConversationMeta[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessagesState] = useState<Message[]>([]);
  const [settings, setSettingsState] = useState<Settings>(store.DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);
  /** Conversation whose messages are being read from IndexedDB. */
  const [loadingId, setLoadingId] = useState<string | null>(null);

  // Refs mirror state so async callbacks never write a stale snapshot.
  const convsRef = useRef<ConversationMeta[]>([]);
  const activeRef = useRef<string | null>(null);
  const settingsRef = useRef<Settings>(store.DEFAULT_SETTINGS);
  // Writes before the initial load finishes would save an empty index over
  // the real one, so every mutation is a no-op until then.
  const readyRef = useRef(false);
  const loadingRef = useRef<string | null>(null);

  const mutateConvs = useCallback((fn: (prev: ConversationMeta[]) => ConversationMeta[]) => {
    if (!readyRef.current) return;
    const next = fn(convsRef.current);
    convsRef.current = next;
    setConversations(next);
    // Empty drafts stay in memory only; they appear once a message is sent.
    store.saveIndex(next.filter((c) => c.messageCount > 0)).catch(logStorageError);
  }, []);

  const activate = useCallback((id: string | null) => {
    activeRef.current = id;
    setActiveId(id);
    writeActiveId(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [index, loadedSettings] = await Promise.all([store.loadIndex(), store.loadSettings()]);
      if (cancelled) return;
      const convs = index.filter((c) => c.messageCount > 0);
      const stored = readActiveId();
      const initial = convs.find((c) => c.id === stored) ?? null;
      const msgs = initial ? await store.loadMessages(initial.id) : [];
      if (cancelled) return;
      convsRef.current = convs;
      settingsRef.current = loadedSettings;
      setConversations(convs);
      setSettingsState(loadedSettings);
      setMessagesState(msgs);
      activeRef.current = initial?.id ?? null;
      setActiveId(initial?.id ?? null);
      readyRef.current = true;
      setReady(true);
    })().catch((e) => {
      console.error("Could not read IndexedDB", e);
      if (!cancelled) {
        readyRef.current = true;
        setReady(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const active = conversations.find((c) => c.id === activeId) ?? null;

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    if (!readyRef.current) return;
    const next = { ...settingsRef.current, ...patch };
    settingsRef.current = next;
    setSettingsState(next);
    store.saveSettings(next).catch(logStorageError);
  }, []);

  const createConversation = useCallback((): ConversationMeta | null => {
    if (!readyRef.current) return null;
    const now = Date.now();
    const last = settingsRef.current.lastModel;
    const conv: ConversationMeta = {
      id: nanoid(),
      title: "New chat",
      titleEdited: false,
      createdAt: now,
      updatedAt: now,
      model: modelInfo(last) ? last : store.DEFAULT_SETTINGS.lastModel,
      systemPrompt: null,
      temperature: DEFAULT_TEMPERATURE,
      maxTokens: DEFAULT_MAX_TOKENS,
      messageCount: 0,
      contextTokens: 0,
    };
    mutateConvs((prev) => [conv, ...prev.filter((c) => c.messageCount > 0)]);
    setMessagesState([]);
    activate(conv.id);
    return conv;
  }, [activate, mutateConvs]);

  /** The active conversation, creating a draft if there is none. */
  const ensureConversation = useCallback((): ConversationMeta | null => {
    if (!readyRef.current) return null;
    const current = convsRef.current.find((c) => c.id === activeRef.current);
    return current ?? createConversation();
  }, [createConversation]);

  const selectConversation = useCallback(
    async (id: string) => {
      if (id === activeRef.current) return;
      mutateConvs((prev) => prev.filter((c) => c.messageCount > 0 || c.id === id));
      activate(id);
      setMessagesState([]);
      loadingRef.current = id;
      setLoadingId(id);
      try {
        const msgs = await store.loadMessages(id);
        if (activeRef.current === id) setMessagesState(msgs);
      } finally {
        if (loadingRef.current === id) {
          loadingRef.current = null;
          setLoadingId(null);
        }
      }
    },
    [activate, mutateConvs],
  );

  const updateConversation = useCallback(
    (id: string, patch: Partial<ConversationMeta>) => {
      mutateConvs((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    },
    [mutateConvs],
  );

  const renameConversation = useCallback(
    (id: string, title: string) => {
      const clean = title.trim();
      if (clean) updateConversation(id, { title: clean.slice(0, 120), titleEdited: true });
    },
    [updateConversation],
  );

  const deleteConversation = useCallback(
    (id: string) => {
      mutateConvs((prev) => prev.filter((c) => c.id !== id));
      store.deleteMessages(id).catch(logStorageError);
      if (activeRef.current === id) {
        activate(null);
        setMessagesState([]);
      }
    },
    [activate, mutateConvs],
  );

  /** In-memory only: used for per-frame streaming updates. */
  const setLiveMessages = useCallback((id: string, msgs: Message[]) => {
    if (activeRef.current === id) setMessagesState(msgs);
  }, []);

  /** Autosave: persist messages and refresh the conversation's metadata. */
  const commitMessages = useCallback(
    (id: string, msgs: Message[], patch: Partial<ConversationMeta> = {}) => {
      // Never write over history that hasn't been read yet, and never
      // resurrect a conversation deleted while its reply was streaming.
      if (loadingRef.current === id || !convsRef.current.some((c) => c.id === id)) return;
      setLiveMessages(id, msgs);
      store.saveMessages(id, msgs).catch(logStorageError);
      mutateConvs((prev) =>
        prev.map((c) => {
          if (c.id !== id) return c;
          const firstUser = msgs.find((m) => m.role === "user");
          return {
            ...c,
            ...patch,
            messageCount: msgs.length,
            updatedAt: Date.now(),
            title: c.titleEdited || !firstUser ? c.title : makeTitle(firstUser.content),
          };
        }),
      );
    },
    [mutateConvs, setLiveMessages],
  );

  return {
    ready,
    conversations: conversations.filter((c) => c.messageCount > 0),
    active,
    activeId,
    messages,
    messagesLoading: loadingId !== null && loadingId === activeId,
    settings,
    updateSettings,
    createConversation,
    ensureConversation,
    selectConversation,
    updateConversation,
    renameConversation,
    deleteConversation,
    setLiveMessages,
    commitMessages,
  };
}

export type ConversationsApi = ReturnType<typeof useConversations>;
