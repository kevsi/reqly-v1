"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { listen } from "@tauri-apps/api/event";
import { useSessionStore } from "@/lib/session-store";

/**
 * Listen for GitHub OAuth completion events from the Rust loopback server.
 *
 * Flow on desktop:
 * 1. User clicks "Login with GitHub"
 * 2. Rust starts a local HTTP server on port 18234
 * 3. Opens system browser with redirect_uri=http://127.0.0.1:18234/callback
 * 4. GitHub auth → redirects to local server
 * 5. Rust exchanges code for token, fetches user profile, creates session
 * 6. Rust emits "github-oauth-complete" event with {user, token} JSON
 * 7. This hook receives it, updates the session store and navigates home
 *
 * NOTE: uses client-side navigation (router.push), NOT a full page reload —
 * the session token lives only in Zustand memory, a reload would wipe it.
 */
export function useGitHubLoginDeepLink() {
  const router = useRouter();

  useEffect(() => {
    console.log("[github-login] Hook initialized, listening for OAuth completion...");

    const unlistenComplete = listen<string>("github-oauth-complete", (event) => {
      console.log("[github-login] OAuth complete event received:", event.payload);

      try {
        const data = JSON.parse(event.payload);
        const { user, token } = data;

        if (user && token) {
          useSessionStore.setState({ user, token, status: "authenticated" });
          console.log("[github-login] Logged in as", user.email, "→ navigating to /");
          router.push("/");
        } else {
          console.error("[github-login] Missing user or token in event payload");
        }
      } catch (err) {
        console.error("[github-login] Failed to parse OAuth completion data:", err);
      }
    });

    const unlistenError = listen<string>("github-oauth-error", (event) => {
      console.error("[github-login] OAuth error event:", event.payload);
    });

    return () => {
      console.log("[github-login] Cleaning up listeners");
      unlistenComplete.then((fn) => fn());
      unlistenError.then((fn) => fn());
    };
  }, [router]);
}
