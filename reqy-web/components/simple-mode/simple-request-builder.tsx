"use client";

import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
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
import { askAIText } from "@/src/ai/ask-ai-text";
import { useRequestStore } from "@/hooks/use-request-store";
import { toast } from "@/hooks/use-toast";
import { generateRequestFromNL, type SavableRequestItem } from "@/lib/simple-mode/nl-to-request";

const DRAFTS_NAME = "Drafts";

/**
 * "Mode simple" — a natural-language guided request builder for non-developers.
 *
 * The "Générer" action runs a text completion (`askAIText`, cloud-engine)
 * via `generateRequestFromNL`. The produced args are mapped into a
 * `RequestItem` and, on "Crérer la requête", persisted via the app's
 * `addRequestToCollection` path (into the Drafts collection).
 */
export function SimpleRequestBuilder() {
  const { t } = useTranslation();
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
      setError(t("simpleMode.describeFirst"));
      return;
    }
    setLoading(true);
    setError(null);
    setPreview(null);
    try {
      const askAI = (prompt: string) => askAIText(prompt);
      const req = await generateRequestFromNL(text, askAI);
      setPreview(req);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("simpleMode.generationFailed"));
    } finally {
      setLoading(false);
    }
  }, [description, t]);

  const handleCreate = useCallback(() => {
    if (!preview) return;
    const drafts = collections.find((c) => c.name === DRAFTS_NAME) ?? null;
    const targetId = drafts
      ? drafts.id
      : addCollection({
          name: DRAFTS_NAME,
          description: t("simpleMode.draftsDescription"),
          color: "slate",
          icon: "folder",
        });
    addRequestToCollection(targetId, preview);
    toast({
      title: t("simpleMode.requestCreated"),
      description: t("simpleMode.requestCreatedDesc", {
        method: preview.method,
        url: preview.url,
        collection: DRAFTS_NAME,
      }),
    });
    setPreview(null);
    setDescription("");
  }, [preview, collections, addCollection, addRequestToCollection, t]);

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col gap-4 overflow-auto p-6">
      <div className="flex items-center gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
          <Sparkles className="size-5 text-primary" />
        </div>
        <div className="space-y-1">
          <CardTitle className="text-base">{t("simpleMode.title")}</CardTitle>
          <CardDescription>{t("simpleMode.description")}</CardDescription>
        </div>
        <Badge variant="secondary" className="ml-auto">
          {t("simpleMode.beta")}
        </Badge>
      </div>

      <Card>
        <CardHeader>
          <Label htmlFor="simple-desc" className="text-sm font-medium">
            {t("simpleMode.naturalLanguageDesc")}
          </Label>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            id="simple-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={5}
            placeholder={t("simpleMode.descriptionPlaceholder")}
          />
          <Button onClick={handleGenerate} disabled={loading} className="w-full">
            {loading ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" /> {t("simpleMode.generating")}
              </>
            ) : (
              <>
                <Sparkles className="mr-2 size-4" /> {t("simpleMode.generate")}
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
            <CardTitle className="text-sm">{t("simpleMode.preview")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center gap-2">
              <Badge variant="outline">{preview.method}</Badge>
              <code className="break-all rounded bg-muted px-2 py-1">{preview.url}</code>
            </div>
            {preview.headers && Object.keys(preview.headers).length > 0 && (
              <div>
                <p className="mb-1 font-medium text-muted-foreground">{t("simpleMode.headers")}</p>
                <pre className="overflow-auto rounded bg-muted p-2 text-xs">
                  {JSON.stringify(preview.headers, null, 2)}
                </pre>
              </div>
            )}
            {preview.body ? (
              <div>
                <p className="mb-1 font-medium text-muted-foreground">{t("simpleMode.body")}</p>
                <pre className="overflow-auto rounded bg-muted p-2 text-xs">{preview.body}</pre>
              </div>
            ) : null}
          </CardContent>
          <Separator />
          <CardFooter className="pt-4">
            <Button onClick={handleCreate} className="w-full">
              <Plus className="mr-2 size-4" /> {t("simpleMode.createRequest")}
            </Button>
          </CardFooter>
        </Card>
      )}

      <p className="text-center text-xs text-muted-foreground">{t("simpleMode.footerHint")}</p>
    </div>
  );
}
