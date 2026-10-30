"use client";

import { useCallback, useSyncExternalStore } from "react";

export type Theme = "dark" | "light";
const KEY = "theme";

// The <html> class is set before paint by the inline script in app/layout.tsx;
// this hook reads it and keeps it in sync with localStorage.
function subscribe(cb: () => void) {
  const obs = new MutationObserver(cb);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => obs.disconnect();
}

function snapshot(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, snapshot, () => "light" as Theme);

  const setTheme = useCallback((t: Theme) => {
    document.documentElement.classList.toggle("dark", t === "dark");
    document.documentElement.style.colorScheme = t;
    try {
      localStorage.setItem(KEY, t);
    } catch {
      // private mode: theme just won't persist
    }
  }, []);

  const toggle = useCallback(() => setTheme(snapshot() === "dark" ? "light" : "dark"), [setTheme]);

  return { theme, setTheme, toggle };
}
