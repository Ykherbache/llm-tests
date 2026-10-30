"use client";

import { useEffect, useRef } from "react";

interface Handlers {
  onStop: () => void;
  onNewChat: () => void;
  onFocusModel: () => void;
}

/** Global shortcuts. Enter / Shift+Enter live in the composer itself. */
export function useHotkeys(handlers: Handlers) {
  const ref = useRef(handlers);
  useEffect(() => {
    ref.current = handlers;
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      const target = e.target instanceof Element ? e.target : null;
      // Esc inside a dialog, menu or text field belongs to that element.
      const owned = target?.closest('[role="dialog"], [role="alertdialog"], [role="listbox"], input');
      if (e.key === "Escape" && !e.defaultPrevented && !owned) {
        ref.current.onStop();
      } else if (mod && !e.shiftKey && key === "k") {
        e.preventDefault();
        ref.current.onNewChat();
      } else if (mod && e.shiftKey && key === "o") {
        e.preventDefault();
        ref.current.onFocusModel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
