"use client";

import { useMemo, useState, useEffect } from "react";
import { Trash2 } from "lucide-react";

import { Text } from "@/components/ui/text";
import type { AuthType } from "@/lib/request-executor";
import { Input } from "@/components/ui/input";

import { AutocompleteInput, type AutocompleteGroup } from "@/components/ui/autocomplete-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";

interface AuthSectionProps {
  authType: AuthType;
  authToken: string;
  onAuthChange: (type: AuthType, token: string) => void;
  environmentVariableNames?: string[];
}

const authTypeLabels: Record<AuthType, string> = {
  none: "No Auth",
  bearer: "Bearer Token",
  basic: "Basic Auth",
  "api-key": "API Key",
  oauth2: "OAuth 2.0",
};

export function AuthSection({
  authType,
  authToken,
  onAuthChange,
  environmentVariableNames,
}: AuthSectionProps) {
  const authVarSuggestions = useMemo((): AutocompleteGroup[] => {
    const vars = environmentVariableNames?.filter(Boolean) ?? [];
    if (vars.length === 0) return [];
    return [
      {
        label: "Variables",
        items: vars.map((name) => ({
          id: `var-${name}`,
          label: `{{${name}}}`,
          value: `{{${name}}}`,
          description: "variable",
        })),
      },
    ];
  }, [environmentVariableNames]);

  // Basic Auth: split the stored base64 token back into username/password for display.
  // We store "base64(username:password)" in authToken, same as before — the fields
  // just make encoding automatic so users never have to do it manually.
  const [basicUsername, setBasicUsername] = useState(() => {
    if (authType !== "basic" || !authToken) return "";
    try {
      const decoded = atob(authToken);
      const colon = decoded.indexOf(":");
      return colon === -1 ? decoded : decoded.slice(0, colon);
    } catch {
      return "";
    }
  });
  const [basicPassword, setBasicPassword] = useState(() => {
    if (authType !== "basic" || !authToken) return "";
    try {
      const decoded = atob(authToken);
      const colon = decoded.indexOf(":");
      return colon === -1 ? "" : decoded.slice(colon + 1);
    } catch {
      return "";
    }
  });

  // Re-sync when authToken changes externally (e.g. loading a saved request).
  useEffect(() => {
    if (authType !== "basic") return;
    if (!authToken) {
      setBasicUsername("");
      setBasicPassword("");
      return;
    }
    try {
      const decoded = atob(authToken);
      const colon = decoded.indexOf(":");
      setBasicUsername(colon === -1 ? decoded : decoded.slice(0, colon));
      setBasicPassword(colon === -1 ? "" : decoded.slice(colon + 1));
    } catch {
      /* authToken may already be raw (legacy) — leave fields unchanged */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authToken]);

  const handleBasicChange = (username: string, password: string) => {
    setBasicUsername(username);
    setBasicPassword(password);
    // Encode immediately so the rest of the app (buildHeaders) keeps working unchanged.
    const encoded = btoa(`${username}:${password}`);
    onAuthChange("basic", encoded);
  };

  return (
    <AccordionItem value="auth" className="border border-border rounded-lg px-4 ">
      <AccordionTrigger className="py-3 text-xs font-semibold uppercase tracking-wider hover:no-underline [&[data-state=open]>svg]:rotate-180">
        <span className="flex items-center gap-2">
          Auth
          {authType !== "none" && (
            <span className="text-[10px] font-mono font-normal text-muted-foreground/70">
              — {authTypeLabels[authType]}
            </span>
          )}
        </span>
      </AccordionTrigger>
      <AccordionContent>
        <div className="space-y-4">
          <div className="space-y-2">
            <Text variant="label" asChild>
              <label>Authentication Type</label>
            </Text>
            <Select
              value={authType}
              onValueChange={(value) => onAuthChange(value as AuthType, authToken)}
            >
              <SelectTrigger className="w-full h-10 border-input bg-muted/20 text-sm transition-all duration-200 hover:border-muted-foreground/30">
                <SelectValue placeholder="Select auth type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No Auth</SelectItem>
                <SelectItem value="bearer">Bearer Token</SelectItem>
                <SelectItem value="basic">Basic Auth</SelectItem>
                <SelectItem value="api-key">API Key</SelectItem>
                <SelectItem value="oauth2">OAuth 2.0</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {authType !== "none" && (
            <div className="space-y-2 animate-slide-up">
              {authType === "basic" ? (
                /* ── Basic Auth: username + password fields ─────────────────── */
                <div className="space-y-3">
                  <div className="space-y-2">
                    <Text variant="label" asChild>
                      <label>Username</label>
                    </Text>
                    <Input
                      type="text"
                      value={basicUsername}
                      onChange={(e) => handleBasicChange(e.target.value, basicPassword)}
                      placeholder="username"
                      className="h-10 bg-muted/20 border-input font-mono text-sm transition-all duration-200 focus:bg-muted/40"
                      autoComplete="off"
                    />
                  </div>
                  <div className="space-y-2">
                    <Text variant="label" asChild>
                      <label>Password</label>
                    </Text>
                    <div className="relative">
                      <Input
                        type="password"
                        value={basicPassword}
                        onChange={(e) => handleBasicChange(basicUsername, e.target.value)}
                        placeholder="password"
                        className="h-10 bg-muted/20 border-input pr-10 font-mono text-sm transition-all duration-200 focus:bg-muted/40"
                        autoComplete="current-password"
                      />
                      {(basicUsername || basicPassword) && (
                        <button
                          type="button"
                          onClick={() => handleBasicChange("", "")}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-destructive transition-colors"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                /* ── Bearer / API Key / OAuth2: single token field ─────────── */
                <>
                  <Text variant="label" asChild>
                    <label>
                      {authType === "bearer"
                        ? "Bearer Token"
                        : authType === "api-key"
                          ? "API Key"
                          : "OAuth2 Token"}
                    </label>
                  </Text>
                  <div className="relative">
                    <AutocompleteInput
                      type="password"
                      value={authToken}
                      onChange={(value) => onAuthChange(authType, value)}
                      placeholder={
                        authType === "bearer"
                          ? "eyJhbGciOiJIUzI1NiIs..."
                          : authType === "api-key"
                            ? "sk-..."
                            : "ya29.a0AfH6S..."
                      }
                      className="h-10 bg-muted/20 border-input pr-10 font-mono text-sm transition-all duration-200 focus:bg-muted/40"
                      suggestions={authVarSuggestions}
                      emptyMessage="Aucune variable"
                    />
                    {authToken && (
                      <button
                        type="button"
                        onClick={() => onAuthChange(authType, "")}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-destructive transition-colors"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          <div className="rounded-lg border border-border bg-muted/20 p-4 transition-all duration-200">
            <div className="flex items-start gap-3">
              <div className="size-2 mt-1 rounded-full bg-muted-foreground/30 shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground/80 leading-relaxed">
                  Authorization header will be automatically attached to every request.
                </p>
                {authType !== "none" && authToken && (
                  <div className="mt-2 rounded-md bg-code-bg px-3 py-2 font-mono text-[11px] leading-relaxed">
                    <span className="text-muted-foreground/50">{"> "}</span>
                    <span className="text-code-text">
                      {authType === "basic"
                        ? `Authorization: Basic ${basicUsername}:${"•".repeat(Math.min(basicPassword.length, 8))} (base64 encoded)`
                        : authType === "api-key"
                          ? `x-api-key: ${authToken.slice(0, 30)}${authToken.length > 30 ? "..." : ""}`
                          : `Authorization: Bearer ${authToken.slice(0, 30)}${authToken.length > 30 ? "..." : ""}`}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}
