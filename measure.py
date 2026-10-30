#!/usr/bin/env python3
"""Measure one Ollama generation and print a JSON line.

Why this exists: Ollama reports prompt_eval_count for the *whole* prompt but
prompt_eval_duration only for the part it actually re-evaluated. Divide the
two and you get a fantasy number whenever a prefix was cached. So we stream
the response and time tokens ourselves, and only use the server's prefill
figures as a cross-check.

Client-side we can measure, honestly:
  decode_tok_s  - first token to last token
  steady_tok_s  - second half of the generation only (shows throttling)
  ttft_s        - request sent to first token

Usage:
  measure.py --model TAG --prompt TEXT --np 128 [--threads 8] [--api URL]
"""

import argparse
import json
import sys
import time
import urllib.request


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", default="http://127.0.0.1:11434")
    ap.add_argument("--model", required=True)
    ap.add_argument("--prompt", required=True)
    ap.add_argument("--np", type=int, default=128)
    ap.add_argument("--threads", type=int, default=0)
    args = ap.parse_args()

    options = {"num_predict": args.np}
    if args.threads:
        options["num_thread"] = args.threads

    body = {
        "model": args.model,
        "prompt": args.prompt,
        "stream": True,
        "keep_alive": "15m",
        "options": options,
    }
    req = urllib.request.Request(
        args.api.rstrip("/") + "/api/generate",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
    )

    start = time.monotonic()
    first = None
    stamps = []
    final = {}

    try:
        with urllib.request.urlopen(req, timeout=900) as resp:
            for raw in resp:
                raw = raw.strip()
                if not raw:
                    continue
                obj = json.loads(raw)
                if obj.get("error"):
                    print(f"ollama: {obj['error']}", file=sys.stderr)
                    return 1
                if obj.get("response") or obj.get("thinking"):
                    now = time.monotonic()
                    if first is None:
                        first = now
                    stamps.append(now)
                if obj.get("done"):
                    final = obj
                    break
    except Exception as exc:  # noqa: BLE001 - surface any transport failure
        print(f"request failed: {exc}", file=sys.stderr)
        return 1

    n = len(stamps)
    decode = steady = 0.0
    if n >= 2:
        span = stamps[-1] - stamps[0]
        decode = (n - 1) / span if span > 0 else 0.0
        half = n // 2
        span_half = stamps[-1] - stamps[half]
        steady = (n - 1 - half) / span_half if span_half > 0 else decode
    elif n == 0:
        # Reasoning models stream into "thinking"; anything else means the
        # model produced no usable output at all.
        print(f"{args.model}: no tokens produced "
              f"(done_reason={final.get('done_reason')!r})", file=sys.stderr)
        return 1

    pc = int(final.get("prompt_eval_count") or 0)
    pd = (final.get("prompt_eval_duration") or 0) / 1e9
    ec = int(final.get("eval_count") or 0)
    ed = (final.get("eval_duration") or 0) / 1e9

    print(json.dumps({
        "model": args.model,
        "threads": args.threads or 0,
        "prompt_tokens": pc,
        "eval_tokens": ec,
        "ttft_s": round((first - start) if first else 0.0, 3),
        # Client-derived: prompt tokens actually processed before token 1.
        # More trustworthy than the server's prompt_eval_duration, which
        # excludes cache-hit tokens but still reports their count.
        "prefill_tok_s": round(pc / (first - start), 1) if first and first > start and pc else 0.0,
        "server_prefill_tok_s": round(pc / pd, 1) if pd > 0 else 0.0,
        "prompt_cached": int(final.get("prompt_eval_cached_count") or 0),
        "decode_tok_s": round(decode, 2),
        "steady_tok_s": round(steady, 2),
        "server_decode_tok_s": round(ec / ed, 2) if ed > 0 else 0.0,
    }))
    return 0


if __name__ == "__main__":
    sys.exit(main())
