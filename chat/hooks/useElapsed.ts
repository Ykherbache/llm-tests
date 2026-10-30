"use client";

import { useEffect, useState } from "react";

/** Milliseconds since `since`, re-rendering every `everyMs` while `active`. */
export function useElapsed(since: number, active: boolean, everyMs = 500): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), everyMs);
    return () => window.clearInterval(id);
  }, [active, everyMs, since]);
  return Math.max(0, now - since);
}
