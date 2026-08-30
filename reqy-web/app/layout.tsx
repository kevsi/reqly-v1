import type { Metadata } from "next";
import { headers } from "next/headers";
import Script from "next/script";
import { Geist } from "next/font/google";
import { Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

// The CSP nonce is generated per request by proxy.ts. Dynamic rendering is
// required so Next can propagate that nonce to inline RSC bootstrap scripts;
// static prerendered HTML cannot carry a request-specific nonce.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Reqly - API Playground",
  description: "Professional API endpoint testing and management platform",
  generator: "v0.app",
  icons: {
    icon: "/icon.png",
    apple: "/icon.png",
  },
};

import { SidebarProvider } from "@/contexts/sidebar-context";
import { Toaster } from "@/components/ui/toaster";
import { ErrorBoundary } from "@/components/error-boundary";
import { ClientLayoutShell } from "@/components/client-layout-shell";
import { AiShortcutBridge } from "@/src/ai/components/ai-shortcut-bridge";
import { StoreInitializer } from "@/components/store-initializer";
import { SessionBootstrap } from "@/components/session-bootstrap";
import { I18nProvider } from "@/components/i18n-provider";

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // The CSP nonce comes from proxy.ts. Passing it explicitly to <Script> keeps
  // the server and client render in sync (hydration) and lets the inline
  // theme script pass the strict `script-src 'nonce-…'` policy.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="fr" suppressHydrationWarning>
      <head>
        <Script id="theme-init" strategy="beforeInteractive" nonce={nonce} suppressHydrationWarning>
          {`(function(){try{var t=localStorage.getItem("reqly-theme");var v=["light","dark","emerald","ocean","sunset","purple","midnight"];if(!t||!v.includes(t)){t=window.matchMedia("(prefers-color-scheme:dark)").matches?"dark":"light"}document.documentElement.classList.add(t);if(t==="midnight"){document.documentElement.classList.add("dark")}var c=t==="dark"||t==="midnight"?"dark":"light";document.documentElement.style.colorScheme=c;var m=document.querySelector("meta[name=theme-color]");if(m){m.content=c==="dark"?"#0a0a0b":"#ffffff"}var l=localStorage.getItem("reqly-language");if(l!=="fr"&&l!=="en"){l=(navigator.language||"fr").toLowerCase().indexOf("en")===0?"en":"fr"}document.documentElement.lang=l}catch(e){}})()`}
        </Script>
        <meta name="color-scheme" content="light dark" />
        <meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)" />
        <meta name="theme-color" content="#0a0a0b" media="(prefers-color-scheme: dark)" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased bg-background text-foreground`}
      >
        <I18nProvider>
          <ThemeProvider>
            <ErrorBoundary>
              <SidebarProvider>
                <ClientLayoutShell>
                  <StoreInitializer />
                  <SessionBootstrap />
                  {children}
                </ClientLayoutShell>
              </SidebarProvider>
              <AiShortcutBridge />
              <Toaster />
            </ErrorBoundary>
          </ThemeProvider>
        </I18nProvider>
        {process.env.NODE_ENV === "production" && <Analytics />}
      </body>
    </html>
  );
}
