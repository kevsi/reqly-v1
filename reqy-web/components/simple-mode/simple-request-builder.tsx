"use client";

import { useCallback, useState } from "react";
import { Sparkles, Loader2, Plus, AlertTriangle } from "lucide-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useAIEngine } from "@/src/ai/hooks/use-ai-engine";
import { useRequestStore } from "@/hooks/use-request-store";
import { toast } from "@/hooks/use-toast";
import { generateRequestFromNL, type SavableRequestItem } from "@/lib/simple-mode/nl-to-request";
import { ACTIONS_SYSTEM_PROMPT } from "@/src/ai/cloud-engine/actions";

const DRAFTS_NAME = "Drafts";

/**
 * "Mode simple" — a natural-language guided request builder for non-developers.
 *
 * Reuses the EXISTING AI engine: the "Générer" action calls the engine's text
 * completion (`useAIEngine().sendMessage`, which routes through
 * `callAITextViaStream` with the configured provider) via
 * `generateRequestFromNL`. The produced args are mapped into a `RequestItem`
 * and, on "Crérer la requête", persisted via the app's existing
 * `addRequestToCollection` path (into the Drafts collection).
 */
export function SimpleRequestBuilder() {
  const { sendMessage, buildContext } = useAIEngine();
  const collections = useRequestStore((s) => s.collections);
  const addRequestToCollection = useRequestStore((s) => s.addRequestToCollection);
  const addCollection = useRequestStore((s) => s.addCollection);

  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<SavableRequestItem | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = useCallback(async () => {
    const text = description.trim();
    if (!text) {
      setError("Décris d'abord la requête en langage naturel.");
      return;
    }
    setLoading(true);
    setError(null);
    setPreview(null);
    try {
      const askAI = (prompt: string) => sendMessage(prompt, ACTIONS_SYSTEM_PROMPT, buildContext());
      const req = await generateRequestFromNL(text, askAI);
      setPreview(req);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "La génération a échoué. Vérifie ton provider IA dans Settings.",
      );
    } finally {
      setLoading(false);
    }
  }, [description, sendMessage, buildContext]);

  const handleCreate = useCallback(() => {
    if (!preview) return;
    const drafts = collections.find((c) => c.name === DRAFTS_NAME) ?? null;
    const targetId = drafts
      ? drafts.id
      : addCollection({
          name: DRAFTS_NAME,
          description: "Brouillons",
          color: "slate",
          icon: "folder",
        });
    addRequestToCollection(targetId, preview);
    toast({
      title: "Requête créée",
      description: `${preview.method} ${preview.url} ajoutée à ${DRAFTS_NAME}.`,
    });
    setPreview(null);
    setDescription("");
  }, [preview, collections, addCollection, addRequestToCollection]);

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col gap-4 overflow-auto p-6">
      <div className="flex items-center gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
          <Sparkles className="size-5 text-primary" />
        </div>
        <div className="space-y-1">
          <CardTitle className="text-base">Mode simple — Assistant de requête</CardTitle>
          <CardDescription>
            Décris ce que tu veux faire, l&apos;assistant génère la requête.
          </CardDescription>
        </div>
        <Badge variant="secondary" className="ml-auto">
          Bêta
        </Badge>
      </div>

      <Card>
        <CardHeader>
          <Label htmlFor="simple-desc" className="text-sm font-medium">
            Description en langage naturel
          </Label>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            id="simple-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={5}
            placeholder="Décris la requête en langage naturel, ex : appelle l'API MoMo pour envoyer 1000 FCFA au 07..."
          />
          <Button onClick={handleGenerate} disabled={loading} className="w-full">
            {loading ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" /> Génération…
              </>
            ) : (
              <>
                <Sparkles className="mr-2 size-4" /> Générer
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {preview && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Aperçu de la requête</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center gap-2">
              <Badge variant="outline">{preview.method}</Badge>
              <code className="break-all rounded bg-muted px-2 py-1">{preview.url}</code>
            </div>
            {preview.headers && Object.keys(preview.headers).length > 0 && (
              <div>
                <p className="mb-1 font-medium text-muted-foreground">En-têtes</p>
                <pre className="overflow-auto rounded bg-muted p-2 text-xs">
                  {JSON.stringify(preview.headers, null, 2)}
                </pre>
              </div>
            )}
            {preview.body ? (
              <div>
                <p className="mb-1 font-medium text-muted-foreground">Corps</p>
                <pre className="overflow-auto rounded bg-muted p-2 text-xs">{preview.body}</pre>
              </div>
            ) : null}
          </CardContent>
          <Separator />
          <CardFooter className="pt-4">
            <Button onClick={handleCreate} className="w-full">
              <Plus className="mr-2 size-4" /> Créer la requête
            </Button>
          </CardFooter>
        </Card>
      )}

      <p className="text-center text-xs text-muted-foreground">
        Fonctionnalité bêta — vérifie toujours la requête générée avant de l&apos;envoyer.
      </p>
    </div>
  );
}
