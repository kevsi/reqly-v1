import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://reqly.dev"),
  title: {
    default: "Reqly — Client API moderne, open source",
    template: "%s · Reqly",
  },
  description:
    "Reqly est un playground API complet : REST & GraphQL, collections, assistant IA, mock server, CLI et MCP. Open source, local d'abord et auto-hébergeable.",
  keywords: [
    "client API",
    "REST",
    "GraphQL",
    "Postman alternatif",
    "mock server",
    "assistant IA",
    "open source",
  ],
  alternates: { canonical: "/" },
  openGraph: {
    url: "/",
    title: "Reqly — Client API moderne, open source",
    description:
      "REST, GraphQL, collections, assistant IA et automatisation dans un playground unique. Local d'abord, open source.",
    type: "website",
    locale: "fr_FR",
    siteName: "Reqly",
  },
  twitter: {
    card: "summary_large_image",
    title: "Reqly — Client API moderne, open source",
    description:
      "REST, GraphQL, collections, assistant IA et automatisation dans un playground unique.",
  },
};

export const viewport: Viewport = {
  themeColor: "#0b130f",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="fr"
      className={`scroll-smooth ${inter.variable} ${jetbrainsMono.variable}`}
    >
      <head>
        {/* Sans JS, le fade-up ne se déclenche jamais : on force le contenu visible. */}
        <noscript>
          <style>{`[data-reveal]{opacity:1!important;transform:none!important}`}</style>
        </noscript>
      </head>
      <body className="bg-ink-950 text-zinc-300 antialiased">
        <a
          href="#contenu"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-mint-500 focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-ink-950"
        >
          Aller au contenu
        </a>
        {children}
      </body>
    </html>
  );
}
