"use client";

import { Activity, ChartColumn, Download, Menu, Settings2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useChat } from "@/hooks/useChat";
import { useConversations } from "@/hooks/useConversations";
import { useHealth } from "@/hooks/useHealth";
import { useHotkeys } from "@/hooks/useHotkeys";
import { useModelInfo } from "@/hooks/useModelInfo";
import { placementText } from "@/lib/backend";
import { CONTEXT_WINDOW } from "@/lib/models";
import { startSearch } from "@/lib/ollama";
import { IS_DESKTOP } from "@/lib/profile";
import type { ConversationMeta } from "@/lib/types";
import { BackendSwitch } from "./BackendSwitch";
import { Composer, type ComposerHandle } from "./Composer";
import { CONTEXT_BLOCK, CONTEXT_WARN, ContextMeter } from "./ContextMeter";
import { ErrorChip } from "./ErrorChip";
import { MessageList } from "./MessageList";
import { ModelPicker } from "./ModelPicker";
import { ModelsDialog } from "./ModelsDialog";
import { SettingsPanel } from "./SettingsPanel";
import { Sidebar } from "./Sidebar";
import { StatusPanel } from "./StatusPanel";
import { SwitchModelDialog } from "./SwitchModelDialog";
import { ThemeToggle } from "./ThemeToggle";

export function ChatShell() {
  const api = useConversations();
  const { health, refresh } = useHealth(false, api.settings.backend);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [modelsOpen, setModelsOpen] = useState(false);
  const firstRunShown = useRef(false);
  const [pendingModel, setPendingModel] = useState<string | null>(null);
  const pickerRef = useRef<HTMLButtonElement>(null);
  const composerRef = useRef<ComposerHandle>(null);

  const loaded = useMemo(() => new Set(health?.loaded ?? []), [health]);
  const installed = useMemo(() => (health?.ok ? new Set(health.installed) : null), [health]);
  const defaultPrompt = api.settings.defaultSystemPrompt;
  const systemPromptFor = useCallback((c: ConversationMeta) => c.systemPrompt ?? defaultPrompt, [defaultPrompt]);
  const isLoaded = useCallback((m: string) => loaded.has(m), [loaded]);
  const onSettled = useCallback(() => void refresh(), [refresh]);

  // The globe starts SearXNG when it is down, then turns the web tools on.
  const [searchStarting, setSearchStarting] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const startSearxng = useCallback(async () => {
    setSearchStarting(true);
    setSearchError(null);
    const error = await startSearch();
    setSearchError(error);
    if (!error) api.updateSettings({ toolsEnabled: true });
    await refresh();
    setSearchStarting(false);
  }, [api, refresh]);

  const active = api.active;
  const model = active?.model ?? api.settings.lastModel;
  const contextTokens = active?.contextTokens ?? 0;
  const contextRatio = contextTokens / CONTEXT_WINDOW;
  const modelMissing = installed !== null && !installed.has(model);

  // Desktop first run: no Ollama, no models, or the selected model is not downloaded -> open the download screen once.
  useEffect(() => {
    if (!IS_DESKTOP || !health || firstRunShown.current) return;
    if (!health.ok || health.installed.length === 0 || !health.installed.includes(model)) {
      firstRunShown.current = true;
      setModelsOpen(true);
    }
  }, [health, model]);

  let blockedReason: string | null = null;
  if (!api.ready || api.messagesLoading) blockedReason = "Loading chats…";
  else if (modelMissing) blockedReason = `${model} isn't installed in Ollama`;
  else if (contextRatio > CONTEXT_BLOCK) blockedReason = "Context window is full";

  const searchAvailable = health?.search ?? false;
  const toolsEnabled = api.settings.toolsEnabled && searchAvailable;
  const { layers, tools: modelTools } = useModelInfo(model);
  const placement = placementText(health?.placement?.find((p) => p.tag === model));
  // The newest reply that asked for the GPU, and Ollama still has the model on the CPU.
  const lastReply = api.messages.findLast((m) => m.role === "assistant" && m.status === "done");
  const gpuIgnored = !!lastReply?.backend && (lastReply.backend.mode === "hybrid" || lastReply.backend.mode === "gpu") && placement === "CPU";
  const chat = useChat({
    api,
    systemPromptFor,
    isLoaded,
    onSettled,
    blockedReason,
    toolsEnabled,
    offerEnable: !toolsEnabled && modelTools !== false,
    backend: api.settings.backend,
    gpuLayers: api.settings.gpuLayers,
    layers,
    effort: api.settings.effort,
  });
  const { generating, stop } = chat;

  const newChat = useCallback(() => {
    if (generating) stop();
    api.createConversation();
    setDrawerOpen(false);
    composerRef.current?.focus();
  }, [api, generating, stop]);

  const selectChat = useCallback(
    (id: string) => {
      if (generating) stop();
      void api.selectConversation(id);
      setDrawerOpen(false);
    },
    [api, generating, stop],
  );

  const deleteChat = useCallback(
    (id: string) => {
      if (generating && id === api.activeId) stop();
      api.deleteConversation(id);
    },
    [api, generating, stop],
  );

  const applyModel = (tag: string) => {
    if (active) api.updateConversation(active.id, { model: tag });
    api.updateSettings({ lastModel: tag });
  };

  const requestModel = (tag: string) => {
    if (tag === model) return;
    if (api.messages.length > 0) setPendingModel(tag);
    else applyModel(tag);
  };

  useHotkeys({
    onStop: () => {
      if (generating) stop();
    },
    onNewChat: newChat,
    onFocusModel: () => pickerRef.current?.focus(),
  });

  const sidebar = (
    <Sidebar
      conversations={api.conversations}
      activeId={api.activeId}
      onNew={newChat}
      onSelect={selectChat}
      onRename={api.renameConversation}
      onDelete={deleteChat}
    />
  );

  return (
    <div className="flex h-dvh overflow-hidden">
      <aside className="hidden w-64 shrink-0 border-r-2 border-ink md:block">{sidebar}</aside>
      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent side="left" showCloseButton={false} className="w-72 max-w-[85vw] gap-0 p-0">
          <SheetTitle className="sr-only">Chats</SheetTitle>
          {sidebar}
        </SheetContent>
      </Sheet>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-1 border-b-2 border-ink bg-card px-2">
          <Button size="icon" variant="ghost" className="md:hidden" aria-label="Open chats" onClick={() => setDrawerOpen(true)}>
            <Menu />
          </Button>
          <ModelPicker
            value={model}
            disabled={generating}
            installed={installed}
            installedModels={health?.installedModels}
            loaded={loaded}
            onChange={requestModel}
            gpu={health?.gpu}
            onNeedDownload={() => setModelsOpen(true)}
            triggerRef={pickerRef}
          />
          <div className="ml-auto flex items-center gap-1">
            <ContextMeter tokens={contextTokens} />
            <Button size="icon" variant="ghost" aria-label="What's loaded" title="What's loaded" onClick={() => setStatusOpen(true)}>
              <Activity />
            </Button>
            {IS_DESKTOP && (
              <Button size="icon" variant="ghost" aria-label="Models" title="Download models" onClick={() => setModelsOpen(true)}>
                <Download />
              </Button>
            )}
            {!IS_DESKTOP && (
              <Link
                href="/benchmarks"
                aria-label="Model benchmarks"
                title="Model benchmarks"
                className={buttonVariants({ variant: "ghost", size: "icon" })}
              >
                <ChartColumn />
              </Link>
            )}
            <Button
              size="icon"
              variant="ghost"
              aria-label="Settings"
              disabled={!api.ready}
              onClick={() => {
                api.ensureConversation();
                setSettingsOpen(true);
              }}
            >
              <Settings2 />
            </Button>
            <ThemeToggle />
          </div>
        </header>
        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b-2 border-ink bg-muted px-3 py-1.5">
          <span className="text-sm font-bold">Run on</span>
          <BackendSwitch
            mode={api.settings.backend}
            gpuLayers={api.settings.gpuLayers}
            layers={layers}
            placement={api.settings.backend === "prefill" && placement ? "CPU memory, prefill on GPU" : placement}
            gpuIgnored={gpuIgnored}
            disabled={generating}
            onMode={(backend) => api.updateSettings({ backend })}
            onGpuLayers={(gpuLayers) => api.updateSettings({ gpuLayers })}
          />
          {!IS_DESKTOP && api.settings.backend !== "cpu" && (
            <span className="text-xs text-muted-foreground">
              Switching reloads the model (10–40 s). GPU runs can make the desktop stutter.
            </span>
          )}
        </div>

        {health && !health.ok && (
          <div className="mx-auto w-full max-w-3xl px-4 pt-3">
            <ErrorChip
              error={{ code: "ollama_down", message: health.message ?? "Ollama is unreachable" }}
              onRetry={() => void refresh()}
            />
          </div>
        )}

        <MessageList
          conversationId={api.activeId}
          messages={api.messages}
          phase={chat.phase}
          busy={generating || blockedReason !== null}
          model={model}
          onRetry={chat.retry}
          onEdit={chat.editAndResend}
          onDelete={chat.deleteMessage}
        />

        <div className="mx-auto w-full max-w-3xl space-y-2 px-3 sm:px-4">
          {modelMissing && <ErrorChip error={{ code: "model_not_found", message: "", model }} />}
          {!modelMissing && contextRatio > CONTEXT_BLOCK && (
            <div role="alert" className="flex flex-wrap items-center gap-2 rounded-md border-2 border-ink bg-destructive p-3 text-sm font-semibold text-black shadow-brutal-sm">
              <span className="flex-1">
                The last prompt used {Math.round(contextRatio * 100)}% of the {CONTEXT_WINDOW.toLocaleString()}-token context.
              </span>
              <Button size="sm" variant="outline" onClick={newChat}>
                Start a new chat
              </Button>
              <Button size="sm" variant="outline" onClick={chat.dropOldest}>
                Drop oldest messages
              </Button>
            </div>
          )}
          {contextRatio > CONTEXT_WARN && contextRatio <= CONTEXT_BLOCK && (
            <p className="mx-auto w-fit rounded-full border-2 border-ink bg-marigold px-3 py-0.5 text-center text-xs font-semibold text-black">
              Context {Math.round(contextRatio * 100)}% full — older messages will be trimmed from what the model sees.
            </p>
          )}
        </div>

        <Composer
          ref={composerRef}
          generating={generating}
          blockedReason={blockedReason}
          onSend={chat.send}
          onStop={stop}
          toolsOn={api.settings.toolsEnabled}
          effort={api.settings.effort}
          onEffort={(effort) => api.updateSettings({ effort })}
          searchAvailable={searchAvailable}
          searchStarting={searchStarting}
          searchError={searchError}
          onStartSearch={() => void startSearxng()}
          onToggleTools={() => api.updateSettings({ toolsEnabled: !api.settings.toolsEnabled })}
        />
      </main>

      <SettingsPanel
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        globalPrompt={defaultPrompt}
        onGlobalPrompt={(text) => api.updateSettings({ defaultSystemPrompt: text })}
        conversation={active}
        onConversation={(patch) => active && api.updateConversation(active.id, patch)}
      />
      <StatusPanel
        open={statusOpen}
        onOpenChange={setStatusOpen}
        health={health}
        toolsOn={api.settings.toolsEnabled}
        modelTools={modelTools}
        model={model}
        gpuIgnored={gpuIgnored}
      />
      {IS_DESKTOP && (
        <ModelsDialog
          open={modelsOpen}
          onOpenChange={setModelsOpen}
          health={health}
          onPulled={() => void refresh()}
          onUse={(tag) => {
            setModelsOpen(false);
            requestModel(tag);
          }}
        />
      )}
      <SwitchModelDialog
        from={model}
        to={pendingModel}
        onCancel={() => setPendingModel(null)}
        onConfirm={() => {
          if (pendingModel) applyModel(pendingModel);
          setPendingModel(null);
        }}
      />
    </div>
  );
}
