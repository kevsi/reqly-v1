const json = `{
  "users": [
    {
      "id": 1,
      "name": "Ada Lovelace",
      "email": "ada@reqly.dev",
      "role": "admin"
    },
    {
      "id": 2,
      "name": "Grace Hopper",
      "email": "grace@reqly.dev",
      "role": "developer"
    }
  ],
  "total": 2
}`;

/** Visuel décoratif : masqué aux lecteurs d'écran, aucun élément focusable. */
export function EditorMockup() {
  return (
    <div
      aria-hidden="true"
      className="overflow-hidden rounded-xl border border-ink-700 bg-ink-950/95"
    >
      {/* Barre de fenêtre */}
      <div className="flex items-center gap-2 border-b border-ink-700 bg-ink-850 px-4 py-3">
        <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
        <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
        <span className="h-3 w-3 rounded-full bg-[#28c840]" />
        <span className="ml-3 hidden text-xs text-zinc-500 sm:block">
          reqly — localhost:3000
        </span>
      </div>

      {/* Onglets */}
      <div className="flex items-center gap-1 overflow-x-auto border-b border-ink-700 bg-ink-850 px-3 pt-2 hide-scrollbar">
        {[
          { method: "GET", label: "api/users", active: true },
          { method: "POST", label: "api/login" },
          { method: "GQL", label: "graphql/playground" },
        ].map((t, i) => (
          <div
            key={i}
            className={`flex shrink-0 items-center gap-2 rounded-t-lg px-3 py-2 text-xs font-medium ${
              t.active
                ? "border border-b-0 border-ink-600 bg-ink-900 text-zinc-200"
                : "text-zinc-500"
            }`}
          >
            <span
              className={`font-mono text-[10px] font-bold ${
                t.method === "GET"
                  ? "text-mint-400"
                  : t.method === "POST"
                    ? "text-amber-400"
                    : "text-fuchsia-400"
              }`}
            >
              {t.method}
            </span>
            {t.label}
          </div>
        ))}
        <div className="ml-auto mb-1 mr-1 flex h-5 w-5 shrink-0 items-center justify-center rounded text-zinc-600 hover:text-zinc-300">
          +
        </div>
      </div>

      {/* Barre d'URL */}
      <div className="flex items-center gap-2 px-4 py-3">
        <MethodBadge method="GET" />
        <div className="flex flex-1 items-center gap-2 rounded-lg border border-ink-600 bg-ink-850 px-3 py-2">
          <span className="font-mono text-xs text-mint-300">
            https://api.example.com
          </span>
          <span className="font-mono text-xs text-zinc-600">/users</span>
          <div className="ml-auto hidden h-1.5 w-1.5 rounded-full bg-mint-400 sm:block" />
        </div>
        <span className="rounded-lg bg-mint-500 px-4 py-2 text-xs font-semibold text-ink-950">
          Send
        </span>
      </div>

      {/* Contenu : colonnes */}
      <div className="grid grid-cols-1 gap-px bg-ink-700 lg:grid-cols-[1fr_1.15fr]">
        {/* Panneau de gauche : tabs requête */}
        <div className="bg-ink-900 p-4">
          <div className="flex items-center gap-4 border-b border-ink-700 pb-2.5 text-[11px] font-medium">
            {["Params", "Headers", "Body", "Tests"].map((t, i) => (
              <span
                key={t}
                className={
                  i === 2
                    ? "text-white underline decoration-mint-500 decoration-2 underline-offset-8"
                    : "text-zinc-500"
                }
              >
                {t}
              </span>
            ))}
          </div>
          <pre className="mt-4 overflow-x-auto font-mono text-[11.5px] leading-relaxed text-zinc-400 hide-scrollbar">
            {`{`}
            <br />
            <span className="pl-4">
              <span className="text-sky-400">&quot;email&quot;</span>
              <span className="text-zinc-600">: </span>
              <span className="text-mint-300">&quot;ada@reqly.dev&quot;</span>,
            </span>
            <br />
            <span className="pl-4">
              <span className="text-sky-400">&quot;password&quot;</span>
              <span className="text-zinc-600">: </span>
              <span className="text-mint-300">&quot;••••••••••&quot;</span>,
            </span>
            <br />
            <span className="pl-4">
              <span className="text-sky-400">&quot;remember&quot;</span>
              <span className="text-zinc-600">: </span>
              <span className="text-fuchsia-400">true</span>,
            </span>
            <br />
            {`}`}
          </pre>
        </div>

        {/* Panneau de droite : réponse */}
        <div className="bg-ink-900 p-4">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 rounded-md bg-mint-500/15 px-2 py-1 font-mono text-[11px] font-bold text-mint-300 ring-1 ring-mint-500/30">
              <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-mint-400" />
              200 OK
            </span>
            <span className="text-[11px] text-zinc-500">241 ms · 312 B</span>
            <span className="ml-auto inline-flex items-center gap-1 rounded-md border border-ink-600 px-2 py-1 text-[11px] text-zinc-300">
              ✨ Résumé IA
            </span>
          </div>

          <pre className="mt-4 overflow-x-auto font-mono text-[11.5px] leading-relaxed text-zinc-400 hide-scrollbar">
            {json.split("\n").map((line, i) => (
              <div key={i}>{line}</div>
            ))}
          </pre>
        </div>
      </div>
    </div>
  );
}

function MethodBadge({ method }: { method: "GET" | "POST" }) {
  const styles =
    method === "GET"
      ? "bg-mint-500/15 text-mint-300 ring-mint-500/30"
      : "bg-amber-500/15 text-amber-300 ring-amber-500/30";
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-1 font-mono text-[11px] font-bold ring-1 ${styles}`}
    >
      {method}
    </span>
  );
}
