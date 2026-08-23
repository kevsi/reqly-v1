/**
 * 404 page for unmatched routes in the app directory.
 */
import { Button } from "@/components/ui/button";
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="flex flex-col items-center gap-2">
        <span className="text-4xl">404</span>
        <h2 className="text-lg font-semibold text-foreground">Page introuvable</h2>
        <p className="max-w-md text-sm text-muted-foreground">
          Cette page n&apos;existe pas ou a été déplacée.
        </p>
      </div>
      <Button asChild variant="outline">
        <Link href="/">Retour à l&apos;accueil</Link>
      </Button>
    </div>
  );
}
