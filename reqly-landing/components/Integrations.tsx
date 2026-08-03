const tools: { name: string; mono?: boolean; icon?: string }[] = [
  { name: "Postman", icon: "P" },
  { name: "OpenAPI / Swagger", icon: "OA" },
  { name: "Bruno", icon: "B" },
  { name: "GitHub", icon: "GH" },
  { name: "GitLab", icon: "GL" },
  { name: "cURL", icon: "⌘", mono: true },
  { name: "JSON Schema", icon: "{}", mono: true },
  { name: "Mockoon", icon: "M" },
  { name: "WebSocket", icon: "WS" },
  { name: "SSE", icon: "SSE" },
];

export function Integrations() {
  // La 2ᵉ moitié n'est qu'un doublon visuel : masquée aux lecteurs d'écran.
  const doubled = [
    ...tools.map((t) => ({ ...t, clone: false })),
    ...tools.map((t) => ({ ...t, clone: true })),
  ];

  return (
    <section
      id="integrations"
      className="scroll-mt-20 border-y border-ink-700/60 bg-ink-900 py-10"
    >
      <p className="mb-6 text-center text-xs font-medium uppercase tracking-[0.2em] text-zinc-500">
        Imports &amp; exports natifs
      </p>
      <div className="animate-marquee-paused relative overflow-hidden">
        <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-24 bg-gradient-to-r from-ink-900 to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-24 bg-gradient-to-l from-ink-900 to-transparent" />
        {/* pr-3 == gap-3 : la boucle à -50 % tombe pile, sans saut. */}
        <div className="animate-marquee flex w-max items-center gap-3 pr-3">
          {doubled.map((t, i) => (
            <span
              key={i}
              aria-hidden={t.clone || undefined}
              className="flex items-center gap-2.5 rounded-lg border border-ink-700 bg-ink-850 px-3.5 py-2 text-sm text-zinc-400 transition-colors hover:border-mint-500/40 hover:text-zinc-200"
            >
              <span
                aria-hidden="true"
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-ink-700 text-[10px] font-bold text-mint-300 ${
                  t.mono ? "font-mono" : ""
                }`}
              >
                {t.icon}
              </span>
              {t.name}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
