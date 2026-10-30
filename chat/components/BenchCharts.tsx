"use client";

import { useCallback, useState, type FocusEvent, type PointerEvent } from "react";
import { CPU_ROWS, LAG_IDLE_S, LAG_MAX_S, LAG_ROWS } from "@/lib/benchmarks";

interface Tip {
  left: number;
  top: number;
  title: string;
  value: string;
  note?: string;
}

const TIP_W = 220;

type TipContent = Pick<Tip, "title" | "value" | "note">;

/** Keeps the tooltip inside the viewport; only ever called from event handlers. */
function placeTip(x: number, y: number, c: TipContent): Tip {
  return { left: Math.max(8, Math.min(x + 14, window.innerWidth - TIP_W - 8)), top: y + 16, ...c };
}

/** One tooltip for a whole chart. Pointer and keyboard focus show the same content. */
function useTip() {
  const [tip, setTip] = useState<Tip | null>(null);
  const onPointer = useCallback((c: TipContent) => (e: PointerEvent) => setTip(placeTip(e.clientX, e.clientY, c)), []);
  const onFocus = useCallback(
    (c: TipContent) => (e: FocusEvent<HTMLElement>) => {
      const r = e.currentTarget.getBoundingClientRect();
      setTip(placeTip(r.left + r.width / 2, r.bottom - 8, c));
    },
    [],
  );
  const hide = useCallback(() => setTip(null), []);
  return { tip, onPointer, onFocus, hide };
}

function Tooltip({ tip }: { tip: Tip | null }) {
  if (!tip) return null;
  return (
    <div
      role="tooltip"
      className="pointer-events-none fixed z-50 rounded-md border-2 border-ink bg-popover p-2.5 text-popover-foreground shadow-brutal-sm"
      style={{ left: tip.left, top: tip.top, width: TIP_W }}
    >
      <p className="text-xs text-muted-foreground">{tip.title}</p>
      <p className="text-base leading-tight font-semibold">{tip.value}</p>
      {tip.note && <p className="mt-0.5 text-xs text-muted-foreground">{tip.note}</p>}
    </div>
  );
}

function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className="inline-block h-2.5 w-4 rounded-[2px]" style={{ background: color }} aria-hidden />
      {label}
    </span>
  );
}

const DECODE_MAX = 56; // leaves room for the value label after the longest bar

function DecodeBar({
  value,
  color,
  title,
  note,
  api,
}: {
  value: number;
  color: string;
  title: string;
  note?: string;
  api: ReturnType<typeof useTip>;
}) {
  const pct = (value / DECODE_MAX) * 100;
  const content = { title, value: `${value.toFixed(1)} tok/s`, note };
  return (
    <div
      className="viz-row relative h-3.5"
      tabIndex={0}
      role="img"
      aria-label={`${title}: ${value.toFixed(1)} tokens per second`}
      onPointerMove={api.onPointer(content)}
      onPointerLeave={api.hide}
      onFocus={api.onFocus(content)}
      onBlur={api.hide}
    >
      <div className="viz-bar h-full" style={{ width: `${pct}%`, background: color }} />
      <span
        className="absolute top-1/2 -translate-y-1/2 text-xs text-muted-foreground"
        style={{ left: `calc(${pct}% + 6px)` }}
      >
        {value.toFixed(1)}
      </span>
    </div>
  );
}

/** Decode speed per model on the CPU: empty context vs 8k tokens deep. */
export function DecodeChart() {
  const api = useTip();
  return (
    <figure className="viz-root rounded-xl border-2 border-ink bg-card p-4 shadow-brutal-sm">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <Swatch color="var(--viz-1)" label="Empty context" />
        <Swatch color="var(--viz-2)" label="8,192 tokens already in context" />
      </div>
      <ul className="mt-4 space-y-4">
        {CPU_ROWS.map((r) => (
          <li key={r.id} className="grid grid-cols-[7.5rem_1fr] items-center gap-3 sm:grid-cols-[13rem_1fr]">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium" title={r.name}>
                {r.name}
              </p>
              <p className="text-xs text-muted-foreground">{r.sizeGiB.toFixed(1)} GiB</p>
            </div>
            <div className="space-y-0.5 border-l border-(--viz-axis)">
              <DecodeBar value={r.d} color="var(--viz-1)" title={`${r.name}, empty context`} note={`Prefill ${r.p.toFixed(1)} tok/s`} api={api} />
              {r.d8k !== null ? (
                <DecodeBar
                  value={r.d8k}
                  color="var(--viz-2)"
                  title={`${r.name}, 8k deep`}
                  note={r.p8k !== null ? `Prefill ${r.p8k.toFixed(1)} tok/s` : undefined}
                  api={api}
                />
              ) : (
                <p className="h-3.5 pl-1.5 text-xs leading-3.5 text-muted-foreground">8k not measured (too slow)</p>
              )}
            </div>
          </li>
        ))}
      </ul>
      <figcaption className="mt-4 text-xs text-muted-foreground">
        Decode speed in tokens per second, CPU with 6 threads. Longer bar is better.
      </figcaption>
      <Tooltip tip={api.tip} />
    </figure>
  );
}

const TICKS = Array.from({ length: LAG_MAX_S / 10 + 1 }, (_, i) => i * 10);
const lagPct = (s: number) => (s / LAG_MAX_S) * 100;

function ratio(s: number) {
  const r = s / LAG_IDLE_S;
  return r < 10 ? r.toFixed(1) : r.toFixed(0);
}

/** Every desktop-lag probe, one dot each, against the idle line. */
export function LagStrip() {
  const api = useTip();
  return (
    <figure className="viz-root rounded-xl border-2 border-ink bg-card p-4 shadow-brutal-sm">
      <div className="grid grid-cols-[7.5rem_1fr] gap-3 sm:grid-cols-[13rem_1fr]">
        <div />
        <div className="relative h-5 text-[11px] text-muted-foreground" aria-hidden>
          {TICKS.map((t) => (
            <span key={t} className="absolute -translate-x-1/2" style={{ left: `${lagPct(t)}%` }}>
              {t}s
            </span>
          ))}
        </div>
      </div>
      <ul className="mt-1">
        {LAG_ROWS.map((row) => (
          <li key={row.label} className="grid grid-cols-[7.5rem_1fr] items-center gap-3 sm:grid-cols-[13rem_1fr]">
            <div className="min-w-0 py-2">
              <p className="text-sm font-medium">{row.label}</p>
              <p className="truncate text-xs text-muted-foreground" title={row.detail}>
                {row.detail}
              </p>
            </div>
            <div
              className="relative h-12 border-b border-(--viz-grid)"
              style={{
                backgroundImage: "linear-gradient(to right, var(--viz-grid) 1px, transparent 1px)",
                backgroundSize: `${100 / (LAG_MAX_S / 10)}% 100%`,
              }}
            >
              <div
                className="absolute inset-y-0 w-px bg-(--viz-axis)"
                style={{ left: `${lagPct(LAG_IDLE_S)}%`, boxShadow: "0 0 0 0.5px var(--viz-axis)" }}
                aria-hidden
              />
              {row.probes.map((s, i) => (
                <button
                  key={i}
                  type="button"
                  className="viz-dot-hit absolute top-1/2 grid size-6 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full"
                  style={{ left: `${lagPct(s)}%` }}
                  aria-label={`${row.label}, probe ${i + 1}: ${s.toFixed(1)} seconds for 300 frames, ${ratio(s)} times slower than idle`}
                  onPointerMove={api.onPointer({
                    title: `${row.label}, probe ${i + 1} of ${row.probes.length}`,
                    value: `${s.toFixed(1)} s per 300 frames`,
                    note: `${ratio(s)}x slower than idle (${LAG_IDLE_S} s)`,
                  })}
                  onPointerLeave={api.hide}
                  onFocus={api.onFocus({
                    title: `${row.label}, probe ${i + 1} of ${row.probes.length}`,
                    value: `${s.toFixed(1)} s per 300 frames`,
                    note: `${ratio(s)}x slower than idle (${LAG_IDLE_S} s)`,
                  })}
                  onBlur={api.hide}
                >
                  <span className="viz-dot" />
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>
      <figcaption className="mt-3 text-xs text-muted-foreground">
        Seconds to draw 300 frames while a GPU benchmark ran. Each dot is one probe. The vertical line marks an idle GPU
        ({LAG_IDLE_S} s). Further right means a laggier desktop.
      </figcaption>
      <Tooltip tip={api.tip} />
    </figure>
  );
}
