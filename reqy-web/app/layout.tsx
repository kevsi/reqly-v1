import type { Metadata } from "next";
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <Script id="theme-init" strategy="beforeInteractive">
          {`(function(){try{var t=localStorage.getItem("reqly-theme");var v=["light","dark","emerald","ocean","sunset","purple","midnight"];if(!t||!v.includes(t)){t=window.matchMedia("(prefers-color-scheme:dark)").matches?"dark":"light"}document.documentElement.classList.add(t);if(t==="midnight"){document.documentElement.classList.add("dark")}var c=t==="dark"||t==="midnight"?"dark":"light";document.documentElement.style.colorScheme=c;var m=document.querySelector("meta[name=theme-color]");if(m){m.content=c==="dark"?"#0d1117":"#ffffff"}}catch(e){}})()`}
        </Script>
        <meta name="color-scheme" content="light dark" />
        <meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)" />
        <meta name="theme-color" content="#0d1117" media="(prefers-color-scheme: dark)" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased bg-background text-foreground`}
      >
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
        {process.env.NODE_ENV === "production" && <Analytics />}
      </body>
    </html>
  );
}
