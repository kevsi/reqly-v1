import * as React from "react";

const MOBILE_BREAKPOINT = 768;

function getMediaQuery(maxWidth: number): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return null;
  }
  return window.matchMedia(`(max-width: ${maxWidth}px)`);
}

function subscribeToViewport(onStoreChange: () => void, maxWidth: number): () => void {
  const mediaQuery = getMediaQuery(maxWidth);
  if (!mediaQuery) return () => {};

  const onChange = () => onStoreChange();
  if (typeof mediaQuery.addEventListener === "function") {
    mediaQuery.addEventListener("change", onChange);
  } else {
    mediaQuery.addListener(onChange);
  }

  return () => {
    if (typeof mediaQuery.removeEventListener === "function") {
      mediaQuery.removeEventListener("change", onChange);
    } else {
      mediaQuery.removeListener(onChange);
    }
  };
}

function getViewportSnapshot(maxWidth: number): boolean {
  return getMediaQuery(maxWidth)?.matches ?? false;
}

function getServerSnapshot(): boolean {
  // Desktop is the stable SSR fallback. On the client, useSyncExternalStore
  // reconciles this with the real media query before notifying subscribers.
  return false;
}

export function useIsMobile(maxWidth = MOBILE_BREAKPOINT): boolean {
  const subscribe = React.useCallback(
    (onStoreChange: () => void) => subscribeToViewport(onStoreChange, maxWidth),
    [maxWidth],
  );
  const getSnapshot = React.useCallback(() => getViewportSnapshot(maxWidth), [maxWidth]);

  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
