"use client";

import { useEffect } from "react";
import { requestStore, useRequestStore } from "@/hooks/use-request-store";
import { persistence } from "@/lib/persistence";

export function StoreInitializer() {
  const isLoaded = useRequestStore((state) => state.isLoaded);

  useEffect(() => {
    // Wait for the persistence layer to finish loading from IndexedDB (with
    // a localStorage migration if needed) BEFORE initialising the store.
    //
    // Without this await there is a race window where `initStore` reads
    // `persistence.getItem` synchronously from the in-memory cache. The
    // cache is populated eagerly from localStorage in the `Persistence`
    // constructor, but `init()` will then asynchronously overwrite those
    // entries with the authoritative IndexedDB values (or migrate from
    // localStorage). If `initStore` runs in the gap, the store ends up
    // using stale localStorage data that will be silently replaced a few
    // ms later, causing flash + potential data loss in the first render.
    let cancelled = false;
    let forceLoaded = false;

    // Safety timeout: if persistence or initStore hangs (e.g. IndexedDB
    // unavailable or a migration stalls), force isLoaded after 3 s so the
    // UI doesn't stay stuck on loading screens forever.
    const safeTimer = setTimeout(() => {
      if (cancelled || forceLoaded) return;
      console.warn("[StoreInitializer] init timed out — forcing isLoaded");
      // Use unknown cast to bypass strict setState type — runtime behavior is correct
      (requestStore as unknown as { setState: (s: Record<string, unknown>) => void }).setState({
        isLoaded: true,
      });
    }, 3000);

    void (async () => {
      try {
        await persistence.waitForReady();
      } catch (err) {
        console.warn("[StoreInitializer] persistence wait failed:", err);
      }
      if (cancelled) return;
      const state = requestStore.getState();
      if (state.isLoaded) return;
      try {
        await state.initStore();
        forceLoaded = true;
        clearTimeout(safeTimer);
      } catch (err) {
        console.warn("[StoreInitializer] initStore failed:", err);
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(safeTimer);
    };
  }, []);

  return <span data-testid="store-ready" data-ready={isLoaded ? "true" : "false"} hidden />;
}
