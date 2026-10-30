"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export function useCopy(resetMs = 1500) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);

  const copy = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        if (timer.current) window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setCopied(false), resetMs);
      } catch {
        // Clipboard API needs a secure context (localhost counts) and focus.
        setCopied(false);
      }
    },
    [resetMs],
  );

  return { copied, copy };
}
