import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDown, ArrowLeft, ArrowUp } from "lucide-react";
import { DecodeChart, LagStrip } from "@/components/BenchCharts";
import { ThemeToggle } from "@/components/ThemeToggle";
import { buttonVariants } from "@/components/ui/button";
import { CPU_ROWS, GPU_ROWS, LAG_IDLE_S, LAG_ROWS, PICKS, formatChange } from "@/lib/benchmarks";
import "./benchmarks.css";

export const metadata: Metadata = {
  title: "Benchmarks · Local Chat",
  description: "Which local models run best on this MacBook, and why the GPU is not the answer.",
};

const num = (n: number | null) => (n === null ? "–" : n < 10 ? n.toFixed(2).replace(/0$/, "") : n.toFixed(1));

function Change({ cpu, gpu }: { cpu: number | null; gpu: number | null }) {
  const c = formatChange(cpu, gpu);
  if (!c) return <span className="text-muted-foreground">–</span>;
  const Icon = c.better ? ArrowUp : ArrowDown;
  return (
    <span
      className="inline-flex items-center gap-1 font-medium"
      style={{ color: c.better ? "var(--viz-good)" : "var(--viz-bad)" }}
    >
      <Icon className="size-3.5" aria-hidden />
      {c.text}
    </span>
  );
}

function Stat({ value, unit, label }: { value: string; unit?: string; label: string }) {
  return (
    <div className="rounded-xl border-2 border-ink bg-card p-4 shadow-brutal-sm">
      <p className="text-3xl font-extrabold tracking-tight">
        {value}
        {unit && <span className="ml-1 text-base font-normal text-muted-foreground">{unit}</span>}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

function Section({ title, lead, children }: { title: string; lead?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-xl font-extrabold tracking-tight">{title}</h2>
        {lead && <p className="mt-1 max-w-prose text-sm text-muted-foreground">{lead}</p>}
      </div>
      {children}
    </section>
  );
}

const th = "px-3 py-2 text-left text-xs font-medium text-muted-foreground";
const td = "px-3 py-2 align-top";

export default function BenchmarksPage() {
  const metrics = [
    { key: "p", label: "Prefill" },
    { key: "p8k", label: "Prefill, 8k deep" },
    { key: "d", label: "Decode" },
    { key: "d8k", label: "Decode, 8k deep" },
  ] as const;

  return (
    <div className="viz-root min-h-dvh">
      <header className="sticky top-0 z-10 flex h-14 items-center gap-2 border-b-2 border-ink bg-card px-3">
        <Link href="/" className={buttonVariants({ variant: "ghost", size: "sm" })}>
          <ArrowLeft /> Back to chat
        </Link>
        <span className="ml-1 text-sm font-medium">Benchmarks</span>
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-10 px-4 py-8 sm:px-6">
        <div className="space-y-3">
          <h1 className="text-3xl font-extrabold tracking-tight text-balance sm:text-4xl">
            On this MacBook, run your models on the CPU
          </h1>
          <p className="max-w-prose text-muted-foreground">
            I measured nine models with one tool (<code className="font-mono text-sm">llama-bench</code>) on both the CPU
            and the Vulkan GPU of this M1 Pro, 32 GB, running Asahi Linux. The GPU is faster at reading a prompt, slower
            at writing the answer, and it makes the whole desktop stutter while it works.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Stat value="46" unit="tok/s" label="Fastest chat model on the CPU (LFM2.5-24B-A2B)" />
          <Stat value="−38%" label="Decode speed on the GPU vs the CPU for that same model" />
          <Stat value="up to 25×" label="Slower desktop drawing while the GPU runs a model (66 s vs 2.7 s per 300 frames)" />
        </div>

        <Section
          title="Which model for what"
          lead="All on the CPU with 6 threads. I measured speed only, not answer quality, so try them on your own prompts."
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {PICKS.map((p) => (
              <div key={p.use} className="rounded-xl border-2 border-ink bg-card p-4 shadow-brutal-sm">
                <p className="text-xs font-medium text-muted-foreground">{p.use}</p>
                <p className="mt-1 font-semibold">{p.model}</p>
                <p className="mt-0.5 text-2xl font-semibold tracking-tight">{p.headline}</p>
                <p className="mt-2 text-sm text-muted-foreground">{p.why}</p>
              </div>
            ))}
          </div>
          <p className="max-w-prose text-sm text-muted-foreground">
            Skip the dense Qwen3.8-27B models: 3 to 5 tok/s on the CPU, and 0.7 on the GPU for the one I tried there.
            Gemma 4 has the slowest decode of the mixture-of-experts models, so it is the first alias worth replacing.
          </p>
        </Section>

        <Section
          title="How fast each model answers"
          lead="Mixture-of-experts models only use a few billion parameters per token, which is why they decode 4 to 14 times faster than the dense model. Filling the context to 8k tokens slows every model; the coder suffers most."
        >
          <DecodeChart />
        </Section>

        <Section
          title="GPU vs CPU"
          lead="The GPU wins at reading the prompt and loses at generating the answer. Only two models were run on the GPU."
        >
          <div className="overflow-x-auto rounded-xl border-2 border-ink bg-card shadow-brutal-sm">
            <table className="w-full min-w-[30rem] text-sm">
              <thead className="border-b">
                <tr>
                  <th className={th}>Measure (tok/s)</th>
                  <th className={`${th} text-right`}>CPU</th>
                  <th className={`${th} text-right`}>GPU</th>
                  <th className={th}>GPU vs CPU</th>
                </tr>
              </thead>
              {GPU_ROWS.map((g) => (
                <tbody key={g.id} className="border-b last:border-b-0">
                  <tr>
                    <th colSpan={4} scope="colgroup" className="bg-muted/40 px-3 py-1.5 text-left text-xs font-semibold">
                      {g.name}
                    </th>
                  </tr>
                  {metrics.map((m) => (
                    <tr key={m.key} className="border-t first:border-t-0">
                      <td className={td}>{m.label}</td>
                      <td className={`${td} text-right tabular-nums`}>{num(g.cpu[m.key])}</td>
                      <td className={`${td} text-right tabular-nums`}>{num(g.gpu[m.key])}</td>
                      <td className={td}>
                        <Change cpu={g.cpu[m.key]} gpu={g.gpu[m.key]} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
        </Section>

        <Section
          title="The desktop stutters while the GPU works"
          lead="The same Honeykrisp GPU draws your desktop. While a model ran on it, I timed how long a spinning cube took to draw 300 frames. Idle, that takes 2.7 seconds."
        >
          <LagStrip />
          <p className="max-w-prose text-sm text-muted-foreground">
            Smaller GPU submissions and smaller batches reduced the worst stall a little. None brought it near the idle
            line, and smaller batches cost 16% of prefill speed. llama.cpp has no GPU priority setting, so I found nothing
            else to try. This is one model with a few probes each, so treat the exact numbers as rough. The pattern is not.
          </p>
          <details className="rounded-xl border bg-card text-sm">
            <summary className="cursor-pointer px-4 py-2.5 font-medium">Show the probe values as a table</summary>
            <div className="overflow-x-auto px-4 pb-4">
              <table className="w-full min-w-[26rem]">
                <thead className="border-b">
                  <tr>
                    <th className={th}>Setting</th>
                    <th className={th}>Seconds per 300 frames (in order)</th>
                    <th className={`${th} text-right`}>Prefill tok/s</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b">
                    <td className={td}>Idle GPU</td>
                    <td className={`${td} tabular-nums`}>{LAG_IDLE_S}</td>
                    <td className={`${td} text-right`}>–</td>
                  </tr>
                  {LAG_ROWS.map((r) => (
                    <tr key={r.label} className="border-b last:border-b-0">
                      <td className={td}>
                        {r.label} <span className="text-muted-foreground">({r.detail})</span>
                      </td>
                      <td className={`${td} tabular-nums`}>{r.probes.map((s) => s.toFixed(1)).join(", ")}</td>
                      <td className={`${td} text-right tabular-nums`}>{r.prefill}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </Section>

        <Section title="All CPU results" lead="llama-bench, 6 threads, GPU hidden. Tokens per second.">
          <div className="overflow-x-auto rounded-xl border-2 border-ink bg-card shadow-brutal-sm">
            <table className="w-full min-w-[38rem] text-sm">
              <thead className="border-b">
                <tr>
                  <th className={th}>Model</th>
                  <th className={`${th} text-right`}>Size GiB</th>
                  <th className={`${th} text-right`}>Prefill</th>
                  <th className={`${th} text-right`}>Decode</th>
                  <th className={`${th} text-right`}>Prefill 8k</th>
                  <th className={`${th} text-right`}>Decode 8k</th>
                </tr>
              </thead>
              <tbody>
                {CPU_ROWS.map((r) => (
                  <tr key={r.id} className="border-b last:border-b-0">
                    <td className={td}>
                      {r.name}
                      {r.alias && <span className="ml-2 font-mono text-xs text-muted-foreground">{r.alias}</span>}
                    </td>
                    <td className={`${td} text-right tabular-nums`}>{r.sizeGiB.toFixed(1)}</td>
                    <td className={`${td} text-right tabular-nums`}>{num(r.p)}</td>
                    <td className={`${td} text-right tabular-nums`}>{num(r.d)}</td>
                    <td className={`${td} text-right tabular-nums`}>{num(r.p8k)}</td>
                    <td className={`${td} text-right tabular-nums`}>{num(r.d8k)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="What this does not tell you">
          <ul className="max-w-prose list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
            <li>Answer quality. Everything here is speed.</li>
            <li>GPU speed for seven of the nine models. I stopped once the desktop lag made the GPU unusable for daily work.</li>
            <li>Anything beyond 8k tokens of context.</li>
            <li>
              A Mac Studio. A machine with nobody sitting at its desktop could use the GPU freely, and Metal on macOS may
              behave very differently from this Asahi driver.
            </li>
            <li>
              Why one early GPU run froze the whole machine and forced a reboot. Later GPU runs were fine, but I never
              found the cause.
            </li>
          </ul>
          <p className="text-sm text-muted-foreground">
            Method, raw logs and incidents:{" "}
            <code className="font-mono text-xs">results/gpu-vs-cpu-2026-10-30.md</code> in the llm-tests folder.
          </p>
        </Section>
      </main>
    </div>
  );
}
