"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { placementText } from "@/lib/backend";
import { modelLabel } from "@/lib/models";
import { unloadModels, type HealthInfo } from "@/lib/ollama";
import { cn } from "@/lib/utils";

type Tone = "ready" | "warn" | "off";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  health: HealthInfo | null;
  /** The setting behind the composer's globe button. */
  toolsOn: boolean;
  /** Tool-calling support of the selected model; null = not reported. */
  modelTools: boolean | null;
  model: string;
  /** A GPU run was requested but Ollama kept the model on the CPU. */
  gpuIgnored: boolean;
  /** A reply is streaming: unloading now would cut it, so the button waits. */
  generating: boolean;
  /** Called after models were unloaded, to refresh the pills. */
  onUnloaded: () => void;
}

const TONE: Record<Tone, string> = {
  ready: "bg-mint text-black",
  warn: "bg-marigold text-black",
  off: "bg-muted text-foreground",
};

function Pill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span className={cn("shrink-0 rounded-full border-2 border-ink px-2 py-0.5 text-xs font-semibold", TONE[tone])}>
      {children}
    </span>
  );
}

function Row({ title, note, pill, tone }: { title: React.ReactNode; note?: string; pill: string; tone: Tone }) {
  return (
    <li className="flex items-start justify-between gap-3 py-2">
      <div className="min-w-0">
        <p className="font-semibold break-words">{title}</p>
        {note && <p className="text-xs text-muted-foreground break-all">{note}</p>}
      </div>
      <Pill tone={tone}>{pill}</Pill>
    </li>
  );
}

/** Why the web tools are, or aren't, being offered to the selected model. */
function webToolState(
  health: HealthInfo | null,
  toolsOn: boolean,
  modelTools: boolean | null,
): { tone: Tone; pill: string; note: string } {
  if (!health) return { tone: "off", pill: "Checking", note: "Waiting for the first health check." };
  if (!health.search) {
    return { tone: "warn", pill: "Not loaded", note: "SearXNG isn't reachable. Start it with scripts/searxng.sh." };
  }
  if (!toolsOn) return { tone: "off", pill: "Off", note: "Turn on the globe button next to the message box." };
  if (modelTools === false) return { tone: "warn", pill: "Not loaded", note: "The selected model doesn't support tool calling." };
  return { tone: "ready", pill: "Loaded", note: "The model can call this tool." };
}

export function StatusPanel({ open, onOpenChange, health, toolsOn, modelTools, model, gpuIgnored, generating, onUnloaded }: Props) {
  const [unloading, setUnloading] = useState(false);
  const web = webToolState(health, toolsOn, modelTools);
  const loaded = new Set(health?.loaded ?? []);
  const placement = new Map((health?.placement ?? []).map((p) => [p.tag, p]));
  // Loaded models first, then by size, so what is using memory is at the top.
  const models = [...(health?.installedModels ?? [])].sort(
    (a, b) => Number(loaded.has(b.tag)) - Number(loaded.has(a.tag)) || a.sizeBytes - b.sizeBytes,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{"What's loaded"}</DialogTitle>
          <DialogDescription>Refreshes every 15 seconds and after each reply.</DialogDescription>
        </DialogHeader>

        <section>
          <h3 className="text-sm font-bold">Web tools</h3>
          <ul className="divide-y-2 divide-ink">
            <Row title={<code className="font-mono text-sm">web_search</code>} note={web.note} pill={web.pill} tone={web.tone} />
            <Row
              title={<code className="font-mono text-sm">fetch_url</code>}
              note={web.tone === "ready" ? "The model can read pages it finds." : web.note}
              pill={web.pill}
              tone={web.tone}
            />
          </ul>
        </section>

        <section>
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-bold">Models in Ollama</h3>
            <Button
              size="xs"
              variant="outline"
              disabled={loaded.size === 0 || unloading || generating}
              title={generating ? "Wait for the reply to finish" : "Free the memory held by every loaded model"}
              onClick={async () => {
                setUnloading(true);
                await unloadModels();
                setUnloading(false);
                onUnloaded();
              }}
            >
              {unloading ? "Unloading…" : "Unload all"}
            </Button>
          </div>
          {health && !health.ok && <p className="text-sm">{health.message ?? "Ollama is unreachable."}</p>}
          <ul className="divide-y-2 divide-ink">
            {models.map((m) => {
              const isLoaded = loaded.has(m.tag);
              const where = placementText(placement.get(m.tag));
              return (
                <Row
                  key={m.tag}
                  title={modelLabel(m.tag)}
                  note={[m.tag === model ? "selected" : "", isLoaded ? `${(m.sizeBytes / 1e9).toFixed(1)} GB in memory` : "", m.tag]
                    .filter(Boolean)
                    .join(" · ")}
                  pill={isLoaded ? `Loaded${where ? ` · ${where}` : ""}` : "Not loaded"}
                  tone={isLoaded ? "ready" : "off"}
                />
              );
            })}
          </ul>
        </section>

        {gpuIgnored && (
          <p role="alert" className="rounded-md border-2 border-ink bg-marigold p-2 text-xs font-semibold text-black">
            A GPU run was requested but Ollama kept the model on the CPU. The system Ollama (port 11434) has no GPU
            backend. Run ../ollama-vulkan.sh start and point OLLAMA_BASE_URL at port 11435.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
