"use client";

import type React from "react";

/* Chaque outil a sa propre couleur d'accent */
const tools: {
  name: string;
  mono?: boolean;
  icon: string;
  color: string; // classe Tailwind pour le texte de l'icône
  bg: string; // classe pour le fond de l'icône
  glow: string; // couleur du glow en hover (box-shadow inline)
}[] = [
  {
    name: "Postman",
    icon: "P",
    color: "text-orange-300",
    bg: "bg-orange-500/15",
    glow: "rgba(249,115,22,0.35)",
  },
  {
    name: "OpenAPI / Swagger",
    icon: "OA",
    color: "text-lime-300",
    bg: "bg-lime-500/15",
    glow: "rgba(132,204,22,0.35)",
  },
  {
    name: "Bruno",
    icon: "B",
    color: "text-amber-300",
    bg: "bg-amber-500/15",
    glow: "rgba(245,158,11,0.35)",
  },
  {
    name: "GitHub",
    icon: "GH",
    color: "text-zinc-200",
    bg: "bg-zinc-500/15",
    glow: "rgba(161,161,170,0.35)",
  },
  {
    name: "GitLab",
    icon: "GL",
    color: "text-fuchsia-300",
    bg: "bg-fuchsia-500/15",
    glow: "rgba(217,70,239,0.35)",
  },
  {
    name: "cURL",
    icon: "⌘",
    mono: true,
    color: "text-sky-300",
    bg: "bg-sky-500/15",
    glow: "rgba(14,165,233,0.35)",
  },
  {
    name: "JSON Schema",
    icon: "{}",
    mono: true,
    color: "text-teal-300",
    bg: "bg-teal-500/15",
    glow: "rgba(20,184,166,0.35)",
  },
  {
    name: "SSE",
    icon: "SSE",
    color: "text-mint-300",
    bg: "bg-mint-500/15",
    glow: "rgba(52,211,153,0.35)",
  },
];

export function Integrations() {
  const doubled = [
    ...tools.map((t) => ({ ...t, clone: false })),
    ...tools.map((t) => ({ ...t, clone: true })),
  ];

  return (
    <section id="integrations" className="scroll-mt-20 border-y border-ink-700/60 bg-ink-900 py-10">
      <p className="mb-6 text-center text-xs font-medium uppercase tracking-[0.2em] text-zinc-500">
        Imports &amp; exports natifs
      </p>
      <div className="animate-marquee-paused relative overflow-hidden">
        <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-24 bg-gradient-to-r from-ink-900 to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-24 bg-gradient-to-l from-ink-900 to-transparent" />
        <div className="animate-marquee flex w-max items-center gap-3 pr-3">
          {doubled.map((t, i) => (
            <BadgeItem key={i} tool={t} aria-hidden={t.clone || undefined} />
          ))}
        </div>
      </div>
    </section>
  );
}

function BadgeItem({
  tool,
  "aria-hidden": ariaHidden,
}: {
  tool: (typeof tools)[0] & { clone: boolean };
  "aria-hidden"?: boolean;
}) {
  return (
    <span
      aria-hidden={ariaHidden || undefined}
      className="group flex cursor-default items-center gap-2.5 rounded-lg border border-ink-700 bg-ink-850 px-3.5 py-2 text-sm text-zinc-400 transition-all duration-200 hover:border-transparent hover:text-zinc-100"
      style={
        {
          "--glow": tool.glow,
        } as React.CSSProperties
      }
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.boxShadow =
          `0 0 0 1px ${tool.glow}, 0 4px 18px -4px ${tool.glow}`;
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.boxShadow = "";
      }}
    >
      <span
        aria-hidden="true"
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${tool.bg} text-[10px] font-bold ${tool.color} ${
          tool.mono ? "font-mono" : ""
        } transition-transform duration-200 group-hover:scale-110`}
      >
        {tool.icon}
      </span>
      {tool.name}
    </span>
  );
}
