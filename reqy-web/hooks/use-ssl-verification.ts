"use client";

import { useEffect, useState } from "react";
import { persistence } from "@/lib/persistence";

const SSL_VERIFICATION_KEY = "reqly_ssl_verification_enabled";

/**
 * Controls whether the desktop (Tauri) HTTP client verifies TLS certificates.
 *
 * When set to `false`, the `insecure` reqwest client (built with
 * `danger_accept_invalid_certs(true)`) is used instead of the default one.
 * This is intended for testing local APIs with self-signed certificats.
 *
 * Default is `true` (verification on), matching standard browser behaviour.
 */
export function useSslVerification() {
  const [enabled, setEnabledState] = useState(true);

  useEffect(() => {
    const v = persistence.getItem<boolean>("reqly_ssl_verification_enabled");
    if (typeof v === "boolean") setEnabledState(v);
  }, []);

  const setEnabled = async (value: boolean) => {
    setEnabledState(value);
    try {
      await persistence.setItem(SSL_VERIFICATION_KEY, value);
    } catch {
      /* ignore persistence failure */
    }
  };

  return { enabled, setEnabled };
}
