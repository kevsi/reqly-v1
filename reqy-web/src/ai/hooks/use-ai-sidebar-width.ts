"use client";

import { useState, useRef, useEffect, useCallback } from "react";

const STORAGE_WIDTH_KEY = "ai-sidebar-width";
const DEFAULT_WIDTH = 400;
const MIN_WIDTH = 300;
const MAX_WIDTH = 600;

export function useAiSidebarWidth() {
  const [width, setWidth] = useState(() => {
    if (typeof window === "undefined") return DEFAULT_WIDTH;
    const saved = localStorage.getItem(STORAGE_WIDTH_KEY);
    return saved ? Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Number(saved))) : DEFAULT_WIDTH;
  });
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);

  // Persist width on change
  useEffect(() => {
    localStorage.setItem(STORAGE_WIDTH_KEY, String(width));
  }, [width]);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      e.preventDefault();
      setIsResizing(true);
    },
    [],
  );

  // Mouse/touch move handlers for resizing
  useEffect(() => {
    if (!isResizing) return;

    const getX = (e: MouseEvent | TouchEvent) =>
      "touches" in e ? e.touches[0].clientX : e.clientX;

    const handleMove = (e: MouseEvent | TouchEvent) => {
      if (!sidebarRef.current) return;
      const rect = sidebarRef.current.getBoundingClientRect();
      const x = getX(e);
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, rect.right - x));
      setWidth(newWidth);
    };

    const handleUp = () => setIsResizing(false);

    // Prevent text selection while resizing
    document.body.style.userSelect = "none";

    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleUp);
    document.addEventListener("touchmove", handleMove, { passive: true });
    document.addEventListener("touchend", handleUp);

    return () => {
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleUp);
      document.removeEventListener("touchmove", handleMove);
      document.removeEventListener("touchend", handleUp);
    };
  }, [isResizing]);

  return { width, isResizing, sidebarRef, handleResizeStart };
}
