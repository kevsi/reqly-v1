import { cn } from "@/lib/utils";
import type { SavedProject } from "../lib/types";

interface RoutePanelProps {
  project: SavedProject;
  onClose: () => void;
}

export function RoutePanel({ project, onClose }: RoutePanelProps) {
  return (
    <aside className="fixed inset-y-0 right-0 w-full max-w-md bg-background border-l border-border p-4 shadow-xl overflow-y-auto">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h2 className="text-xl font-semibold">{project.name}</h2>
          <p className="text-sm text-muted-foreground">
            {project.framework} · {project.routes.length} routes
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-border bg-muted px-3 py-1 text-sm font-medium text-foreground hover:bg-accent"
        >
          Fermer
        </button>
      </div>

      <div className="space-y-4">
        {project.routes.length === 0 ? (
          <div className="rounded-lg border border-border bg-muted p-4 text-sm text-muted-foreground">
            Aucune route détectée pour ce projet.
          </div>
        ) : (
          project.routes.map((route) => (
            <div
              key={`${route.method}-${route.path}`}
              className="rounded-lg border border-border p-4"
            >
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="rounded-full bg-primary/10 px-2 py-1 text-xs font-semibold uppercase text-primary">
                  {route.method}
                </span>
                <span className="text-sm text-muted-foreground">{route.sourceFile}</span>
              </div>
              <p className="text-sm font-medium text-foreground">{route.name || route.path}</p>
              <p className="text-sm text-muted-foreground">{route.path}</p>
              <p className="mt-2 text-sm">{route.description || "Pas de description fournie."}</p>
              <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                {route.bodyType !== "none" && (
                  <span className="rounded-full bg-muted px-2 py-1">Body: {route.bodyType}</span>
                )}
                <span
                  className={cn(
                    "rounded-full px-2 py-1 text-xs font-semibold",
                    route.authRequired ? "bg-success/10 text-success" : "bg-muted",
                  )}
                >
                  Protégé: {route.authRequired ? "Oui" : "Non"}
                </span>
                {/(?:login|register|signin|signup|auth|logout|session)/i.test(route.path) ? (
                  <span className="rounded-full bg-primary/10 px-2 py-1 text-xs font-semibold text-primary">
                    Route auth
                  </span>
                ) : null}
              </div>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
