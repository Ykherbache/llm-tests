"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { Updates } from "@/hooks/useUpdates";

interface Props {
  updates: Updates | null;
  /** A reply is streaming: restarting now would cut it off. */
  busy: boolean;
}

/** One quiet, non-modal bar that follows an update from "available" to "ready". Never steals focus. */
export function UpdateBanner({ updates, busy }: Props) {
  const [laterFor, setLaterFor] = useState<string | null>(null);
  const [showNotes, setShowNotes] = useState(false);
  const [installNote, setInstallNote] = useState(false);

  useEffect(() => {
    if (!installNote) return;
    const t = setTimeout(() => setInstallNote(false), 5000);
    return () => clearTimeout(t);
  }, [installNote]);

  if (!updates) return null;
  const { state } = updates;

  if (installNote) {
    return (
      <Bar>
        <p className="flex-1">Version {state.version} installs the next time you close the app.</p>
      </Bar>
    );
  }
  if (state.status === "idle" || state.version === null) return null;

  // "Later" hides the bar for this session only; the next launch asks again.
  const dismissed = laterFor === state.version;

  if (state.status === "available") {
    if (dismissed) return null;
    return (
      <Bar>
        <p className="flex-1">Yac shipped version {state.version}.</p>
        {state.notes && (
          <Button size="sm" variant="ghost" aria-expanded={showNotes} onClick={() => setShowNotes((v) => !v)}>
            What&apos;s new
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={() => setLaterFor(state.version)}>
          Later
        </Button>
        <Button size="sm" onClick={() => void updates.download()}>
          Download
        </Button>
        {showNotes && state.notes && (
          <pre className="max-h-40 w-full overflow-y-auto whitespace-pre-wrap font-sans text-xs">{state.notes}</pre>
        )}
      </Bar>
    );
  }

  if (state.status === "downloading") {
    const pct = Math.round(state.percent);
    return (
      <Bar>
        <p className="flex-1">
          Downloading version {state.version}… <span className="tabular-nums">{pct}%</span>
        </p>
        <div
          role="progressbar"
          aria-label="Download progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          className="h-3 w-40 border-2 border-ink bg-muted"
        >
          <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
        </div>
      </Bar>
    );
  }

  if (state.status === "error") {
    return (
      <Bar>
        <p className="flex-1">Download failed. Check your connection.</p>
        <Button size="sm" onClick={() => void updates.download()}>
          Try again
        </Button>
      </Bar>
    );
  }

  // ready
  if (dismissed) return null;
  return (
    <Bar>
      <p className="flex-1">
        {busy
          ? `Version ${state.version} is ready. Restart after this reply finishes.`
          : `Version ${state.version} is ready. Restart to finish updating.`}
      </p>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          setLaterFor(state.version);
          setInstallNote(true);
        }}
      >
        Later
      </Button>
      <Button size="sm" disabled={busy} onClick={() => void updates.install()}>
        Restart now
      </Button>
    </Bar>
  );
}

function Bar({ children }: { children: React.ReactNode }) {
  return (
    <div role="status" className="flex shrink-0 flex-wrap items-center gap-2 border-b-2 border-ink bg-card px-3 py-1.5 text-sm font-semibold">
      {children}
    </div>
  );
}
