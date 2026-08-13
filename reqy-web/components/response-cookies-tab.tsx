"use client";

import { memo, useState } from "react";
import { Cookie, Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { TauriCookie } from "@/lib/tauri";
import { useTranslation } from "react-i18next";

interface ResponseCookiesTabProps {
  responseCookies?: TauriCookie[];
}

export const ResponseCookiesTab = memo(function ResponseCookiesTab({
  responseCookies,
}: ResponseCookiesTabProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      const text = (responseCookies ?? []).map((c) => `${c.name}=${c.value}`).join("; ");
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  if (!responseCookies || responseCookies.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-center p-4">
        <div className="rounded-full bg-muted/30 p-3 mb-3">
          <Cookie className="size-6 text-muted-foreground/30" />
        </div>
        <p className="text-xs text-muted-foreground/60">{t("response.noCookies")}</p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-3 animate-fade-in">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground/50">
          {t("response.cookieCount", { count: responseCookies.length })}
        </span>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "h-7 gap-1.5 text-xs font-medium transition-all duration-200",
            copied && "border-success/30 text-success bg-success/10",
          )}
          onClick={handleCopy}
        >
          {copied ? (
            <>
              <Check className="size-3" />
              {t("common.copied")}
            </>
          ) : (
            <>
              <Copy className="size-3" />
              {t("common.copy")}
            </>
          )}
        </Button>
      </div>
      <div className="space-y-2">
        {responseCookies.map((cookie, i) => (
          <div
            key={`${cookie.name}-${i}`}
            className="rounded-lg border border-border/30 bg-muted/10 px-3.5 py-2.5 transition-all duration-200 hover:bg-muted/20 hover:border-border/60"
          >
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-bold text-foreground/90">{cookie.name}</span>
              <span className="text-[10px] text-muted-foreground/60">=</span>
              <span className="text-xs text-muted-foreground/80 break-all">{cookie.value}</span>
            </div>
            <div className="mt-1.5 flex items-center gap-1.5 flex-wrap text-[10px] text-muted-foreground/60">
              {cookie.domain && (
                <span className="rounded bg-muted-foreground/10 px-1.5 py-0.5 font-mono">
                  Domain: {cookie.domain}
                </span>
              )}
              {cookie.path !== "/" && (
                <span className="rounded bg-muted-foreground/10 px-1.5 py-0.5 font-mono">
                  Path: {cookie.path}
                </span>
              )}
              {cookie.secure && (
                <span className="rounded bg-warning/10 px-1.5 py-0.5 text-warning">Secure</span>
              )}
              {cookie.httpOnly && (
                <span className="rounded bg-blue-500/10 px-1.5 py-0.5 text-blue-600 dark:text-blue-400">
                  HttpOnly
                </span>
              )}
              {cookie.sameSite !== "unspecified" && (
                <span className="rounded bg-muted-foreground/10 px-1.5 py-0.5 font-mono">
                  SameSite={cookie.sameSite}
                </span>
              )}
              {cookie.expires && (
                <span className="rounded bg-muted-foreground/10 px-1.5 py-0.5 font-mono">
                  Expires: {cookie.expires}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
});
