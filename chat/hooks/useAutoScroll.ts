"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const BOTTOM_SLACK_PX = 80;

/**
 * Keeps a scroll container pinned to the bottom while content grows, unless
 * the user scrolls up; scrolling back to the bottom re-pins it.
 */
export function useAutoScroll<C extends HTMLElement, I extends HTMLElement>() {
  const containerRef = useRef<C>(null);
  const contentRef = useRef<I>(null);
  const pinned = useRef(true);
  const [atBottom, setAtBottom] = useState(true);

  const scrollToBottom = useCallback((smooth = false) => {
    const el = containerRef.current;
    if (!el) return;
    pinned.current = true;
    setAtBottom(true);
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    const content = contentRef.current;
    if (!el || !content) return;

    // Pinning follows the user's scroll direction, not the distance from the
    // bottom: moving up unpins, reaching the bottom while moving down re-pins.
    // A scroll caused by content shrinking (plain text -> markdown) is ignored.
    let lastTop = el.scrollTop;
    let lastHeight = el.scrollHeight;
    const gapOf = () => el.scrollHeight - el.scrollTop - el.clientHeight;

    const onScroll = () => {
      const top = el.scrollTop;
      const shrank = el.scrollHeight < lastHeight;
      if (top < lastTop - 1 && !shrank) pinned.current = false;
      else if (gapOf() <= BOTTOM_SLACK_PX) pinned.current = true;
      lastTop = top;
      lastHeight = el.scrollHeight;
      setAtBottom(gapOf() <= BOTTOM_SLACK_PX);
    };
    const ro = new ResizeObserver(() => {
      if (pinned.current) el.scrollTop = el.scrollHeight;
      lastTop = el.scrollTop;
      lastHeight = el.scrollHeight;
      setAtBottom(gapOf() <= BOTTOM_SLACK_PX);
    });

    el.addEventListener("scroll", onScroll, { passive: true });
    ro.observe(content);
    // The viewport shrinks when the composer grows or a banner appears.
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
    };
  }, []);

  return { containerRef, contentRef, atBottom, scrollToBottom };
}
