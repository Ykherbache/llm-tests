"use client";

import { useEffect, useState } from "react";
import type { UpdateState, UpdatesBridge } from "@/lib/updates";

export interface Updates {
  state: UpdateState;
  check: UpdatesBridge["check"];
  download: UpdatesBridge["download"];
  install: UpdatesBridge["install"];
}

/** Update state from the Electron main process. Null in a browser, where there is no bridge. */
export function useUpdates(): Updates | null {
  const [bridge, setBridge] = useState<UpdatesBridge | null>(null);
  const [state, setState] = useState<UpdateState | null>(null);

  useEffect(() => {
    const b = window.updates;
    if (!b) return;
    setBridge(b);
    const off = b.onState(setState);
    void b.get().then((s) => setState((prev) => prev ?? s));
    return off;
  }, []);

  if (!bridge || !state) return null;
  return { state, check: bridge.check, download: bridge.download, install: bridge.install };
}
