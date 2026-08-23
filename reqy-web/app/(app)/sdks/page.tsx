"use client";
import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Package,
  Download,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Sparkles,
  Layers,
  Code2,
  Settings2,
  FileCode2,
  FolderArchive,
  Check,
  Globe,
  Cpu,
} from "lucide-react";
import { useRequestStore } from "@/hooks/use-request-store";
import { generateOpenApiSpec } from "@/lib/openapi-export";
import {
  generateSdk,
  GENERATORS,
  AVAILABLE_LANGUAGES,
  OPENAPI_GEN_URL,
} from "@/lib/openapi-gen/generator";
import { isTauriAvailable, saveBlobToDisk } from "@/lib/tauri";
import { cn } from "@/lib/utils";

const LANGUAGE_DETAILS: Record<string, { desc: string; manifest: string; tag: string }> = {
  TypeScript: {
    desc: "Fetch API & ESM module",
    manifest: "package.json, tsconfig.json",
    tag: "TS 5.0+",
  },
  Python: { desc: "Pydantic v2 & urllib3 client", manifest: "pyproject.toml", tag: "Python >=3.8" },
  Go: { desc: "Go 1.21 module client", manifest: "go.mod", tag: "Go 1.21" },
  Rust: { desc: "Reqwest & Tokio async client", manifest: "Cargo.toml", tag: "Rust 2021" },
  Java: { desc: "OkHttp 4 & Gson Maven project", manifest: "pom.xml", tag: "Java 11+" },
  "C#": { desc: ".NET 8.0 strongly-typed client", manifest: "csproj", tag: ".NET 8.0" },
  Kotlin: { desc: "Gradle & OkHttp client", manifest: "build.gradle.kts", tag: "Kotlin 1.9" },
  Swift: { desc: "Swift Package Manager module", manifest: "Package.swift", tag: "Swift 5.9" },
  PHP: { desc: "Guzzle 7 & PSR-4 composer library", manifest: "composer.json", tag: "PHP >=8.1" },
  Ruby: { desc: "Faraday 2.0 Gem package", manifest: "gemspec", tag: "Ruby 3+" },
  Dart: { desc: "Dart 3 HTTP client library", manifest: "pubspec.yaml", tag: "Dart 3.0" },
};

const LANGUAGE_OPTIONS = AVAILABLE_LANGUAGES.map((label) => ({
  label,
  id: GENERATORS[label],
  ...(LANGUAGE_DETAILS[label] ?? { desc: "Client library", manifest: "manifest", tag: "SDK" }),
}));

export default function SdksPage() {
  const { collections, history } = useRequestStore();
  const [selectedCollectionId, setSelectedCollectionId] = useState<string>("");
  const [language, setLanguage] = useState<string>("typescript-fetch");
  const [endpoint, setEndpoint] = useState<string>(OPENAPI_GEN_URL);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const selectedCollection = useMemo(
    () => collections.find((c) => c.id === selectedCollectionId) ?? collections[0],
    [collections, selectedCollectionId],
  );

  const currentLabel = useMemo(
    () => Object.entries(GENERATORS).find(([, id]) => id === language)?.[0] ?? language,
    [language],
  );

  const currentDetails = useMemo(
    () =>
      LANGUAGE_DETAILS[currentLabel] ?? { desc: "Client SDK", manifest: "manifest", tag: "SDK" },
    [currentLabel],
  );

  const historyItems = useMemo(
    () =>
      history
        .map((h) => ({ requestId: h.id, responseBody: h.responseBody }))
        .filter((x) => x.responseBody != null),
    [history],
  );

  const hasCapturedResponses = historyItems.length > 0;

  const generate = async () => {
    if (!selectedCollection) return;
    setGenerating(true);
    setError(null);
    setSuccess(null);

    try {
      const spec = generateOpenApiSpec([selectedCollection], {
        enableInference: true,
        historyItems,
      });
      const result = await generateSdk(spec, language, selectedCollection.name, {
        baseUrl: endpoint.trim() || undefined,
        generatorOptions: language === "typescript-fetch" ? { supportsES6: true } : {},
      });

      // In a Tauri Webview, anchor downloads / showSaveFilePicker don't work;
      // use the native Save As dialog + Rust write instead.
      if (isTauriAvailable()) {
        const outcome = await saveBlobToDisk(result.filename, result.blob);
        if (outcome === "saved") {
          setSuccess(`SDK enregistré dans ${result.filename}`);
        }
        return;
      }

      // Stream blob directly into save dialog if available
      if (typeof window !== "undefined" && "showSaveFilePicker" in window) {
        try {
          const handle = await (
            window as unknown as {
              showSaveFilePicker: (opts: {
                suggestedName?: string;
                types?: Array<{
                  description: string;
                  accept: Record<string, string[]>;
                }>;
              }) => Promise<{
                createWritable: () => Promise<{
                  write: (chunk: BufferSource | Blob) => Promise<void>;
                  close: () => Promise<void>;
                }>;
              }>;
            }
          ).showSaveFilePicker({
            suggestedName: result.filename,
            types: [
              {
                description: "Archive ZIP SDK",
                accept: { "application/zip": [".zip"] },
              },
            ],
          });
          const writable = await handle.createWritable();
          await writable.write(result.blob);
          await writable.close();
          setSuccess(`SDK enregistré dans ${result.filename}`);
          return;
        } catch {
          // User cancelled — do nothing
          return;
        }
      }

      // Fallback: download via anchor click
      const url = URL.createObjectURL(result.blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = result.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setSuccess(`SDK téléchargé : ${result.filename}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Échec de la génération";
      setError(msg);
      console.error("SDK generation failed:", err);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <main className="flex-1 overflow-auto p-6 bg-background/50" data-testid="sdks-page">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header Hero */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2 border-b border-border/40">
          <div className="flex items-start gap-3.5">
            <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/20 shrink-0">
              <Package className="size-5 text-primary" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight text-foreground">
                  Générateur de SDK Client
                </h1>
                <Badge
                  variant="outline"
                  className="text-[10px] font-mono border-primary/30 text-primary bg-primary/5"
                >
                  OpenAPI v3.0
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Générez des SDKs clients natifs typés avec leurs manifestes de build dans 11
                langages de programmation.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="gap-1.5 py-1 px-2.5 text-xs">
              <Sparkles className="size-3.5 text-amber-500" />
              Manifestes prêts à l&apos;emploi
            </Badge>
          </div>
        </div>

        {collections.length === 0 && (
          <Card className="border-dashed">
            <CardContent className="py-12 text-center text-sm text-muted-foreground space-y-3">
              <div className="flex size-12 items-center justify-center rounded-full bg-muted mx-auto">
                <Layers className="size-6 text-muted-foreground/50" />
              </div>
              <p className="font-semibold text-foreground">Aucune collection disponible</p>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                Rendez-vous dans la section <strong>Collections</strong> pour créer ou importer des
                requêtes avant de générer votre premier SDK.
              </p>
            </CardContent>
          </Card>
        )}

        {collections.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Colonne de gauche: Sélection & Grille des langages */}
            <div className="lg:col-span-8 space-y-6">
              {/* Carte Sélection Collection */}
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <Layers className="size-4 text-primary" />
                      Collection Source
                    </CardTitle>
                    {hasCapturedResponses ? (
                      <Badge
                        variant="outline"
                        className="text-[10px] gap-1 border-success/30 text-success bg-success/5"
                      >
                        <CheckCircle2 className="size-3 text-success" />
                        Inférence Réponse Activée ({historyItems.length} réponses)
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px] text-muted-foreground">
                        Inférence basique
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Select
                    value={selectedCollection?.id ?? ""}
                    onValueChange={setSelectedCollectionId}
                  >
                    <SelectTrigger
                      id="source-collection"
                      data-testid="source-collection-select"
                      className="h-10"
                    >
                      <SelectValue placeholder="Sélectionnez une collection" />
                    </SelectTrigger>
                    <SelectContent>
                      {collections.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          <span className="font-medium">{c.name}</span>
                          <span className="ml-2 text-xs text-muted-foreground">
                            ({c.requests?.length ?? 0} requêtes)
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {!hasCapturedResponses && (
                    <p className="text-[11px] text-muted-foreground bg-muted/30 p-2.5 rounded-md border border-border/40">
                      💡 <strong>Astuce :</strong> Exécutez vos requêtes au moins une fois dans
                      Reqly. Les modèles de réponse de votre SDK seront automatiquement typés à
                      partir des réponses JSON réelles.
                    </p>
                  )}
                </CardContent>
              </Card>

              {/* Grille des Langages */}
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-sm font-semibold flex items-center gap-2">
                        <Code2 className="size-4 text-primary" />
                        Langage Cible ({AVAILABLE_LANGUAGES.length} disponibles)
                      </CardTitle>
                      <CardDescription className="text-xs">
                        Sélectionnez la technologie client à générer pour votre projet.
                      </CardDescription>
                    </div>

                    {/* Hidden Select kept for test-compatibility */}
                    <div className="hidden">
                      <Select value={language} onValueChange={setLanguage}>
                        <SelectTrigger id="target-language" data-testid="language-select">
                          <SelectValue placeholder="Select language" />
                        </SelectTrigger>
                        <SelectContent>
                          {LANGUAGE_OPTIONS.map((opt) => (
                            <SelectItem key={opt.id} value={opt.id}>
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </CardHeader>

                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5">
                    {LANGUAGE_OPTIONS.map((opt) => {
                      const isSelected = language === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setLanguage(opt.id)}
                          className={cn(
                            "flex flex-col items-start text-left p-3 rounded-lg border transition-all duration-150 relative group",
                            isSelected
                              ? "border-primary bg-primary/5 ring-1 ring-primary/30 shadow-sm"
                              : "border-border/60 bg-card hover:border-input hover:bg-muted/30",
                          )}
                        >
                          {isSelected && (
                            <span className="absolute top-2.5 right-2.5 flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
                              <Check className="size-2.5 stroke-[3]" />
                            </span>
                          )}

                          <div className="flex items-center gap-1.5 mb-1">
                            <span className="font-semibold text-xs text-foreground group-hover:text-primary transition-colors">
                              {opt.label}
                            </span>
                            <span className="text-[9px] font-mono text-muted-foreground/60 px-1 py-0.2 rounded bg-muted">
                              {opt.tag}
                            </span>
                          </div>

                          <p className="text-[10px] text-muted-foreground leading-tight line-clamp-1">
                            {opt.desc}
                          </p>

                          <div className="mt-2 text-[9px] font-mono text-primary/80 flex items-center gap-1">
                            <FileCode2 className="size-2.5" />
                            {opt.manifest}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>

              {/* Endpoint avancé */}
              <div className="rounded-lg border border-border/40 p-3 bg-muted/10">
                <button
                  type="button"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors w-full"
                >
                  <Settings2 className="size-3.5" />
                  Paramètres avancés du générateur
                  <span className="ml-auto text-[10px] font-mono text-muted-foreground/50">
                    {showAdvanced ? "Masquer" : "Afficher"}
                  </span>
                </button>

                {showAdvanced && (
                  <div className="mt-3 pt-3 border-t border-border/40 space-y-2">
                    <label
                      htmlFor="generator-endpoint"
                      className="text-xs font-medium flex items-center gap-1.5"
                    >
                      <Globe className="size-3 text-muted-foreground" />
                      Endpoint OpenAPI Generator
                    </label>
                    <input
                      id="generator-endpoint"
                      type="url"
                      value={endpoint}
                      onChange={(e) => setEndpoint(e.target.value)}
                      placeholder={OPENAPI_GEN_URL}
                      data-testid="generator-endpoint-input"
                      className="flex h-8 w-full rounded-md border border-input bg-background px-3 py-1 font-mono text-xs shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    />
                    <p className="text-[10px] text-muted-foreground">
                      Par défaut : OpenAPI Generator Cloud. Spécifiez une URL d&apos;instance
                      auto-hébergée pour garder vos specs en réseau privé.
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Colonne de droite: Résumé & Actions */}
            <div className="lg:col-span-4 space-y-6">
              <Card className="sticky top-6">
                <CardHeader className="pb-3 border-b border-border/40 bg-muted/20 rounded-t-lg">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <FolderArchive className="size-4 text-primary" />
                    Résumé du SDK
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-4 space-y-4">
                  <div className="space-y-2.5 text-xs">
                    <div className="flex justify-between py-1 border-b border-border/30">
                      <span className="text-muted-foreground">Collection :</span>
                      <span className="font-medium text-foreground truncate max-w-[150px]">
                        {selectedCollection?.name}
                      </span>
                    </div>

                    <div className="flex justify-between py-1 border-b border-border/30">
                      <span className="text-muted-foreground">Langage :</span>
                      <span className="font-semibold text-primary">{currentLabel}</span>
                    </div>

                    <div className="flex justify-between py-1 border-b border-border/30">
                      <span className="text-muted-foreground">Projet généré :</span>
                      <span className="font-mono text-[11px] text-foreground">
                        {selectedCollection?.name.replace(/\s+/g, "-").toLowerCase()}-{language}.zip
                      </span>
                    </div>

                    <div className="flex justify-between py-1 border-b border-border/30">
                      <span className="text-muted-foreground">Manifeste :</span>
                      <span className="font-mono text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                        {currentDetails.manifest}
                      </span>
                    </div>
                  </div>

                  {/* Messages de Statut */}
                  {error && (
                    <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
                      <AlertCircle className="size-4 shrink-0 mt-0.5" />
                      <div className="space-y-0.5">
                        <p className="font-semibold">Erreur de génération</p>
                        <p className="text-[11px] text-destructive/80 leading-relaxed font-mono">
                          {error}
                        </p>
                      </div>
                    </div>
                  )}

                  {success && (
                    <div className="flex items-start gap-2 rounded-lg border border-success/30 bg-success/10 p-3 text-xs text-success">
                      <CheckCircle2 className="size-4 shrink-0 mt-0.5" />
                      <div className="space-y-0.5">
                        <p className="font-semibold">Succès !</p>
                        <p className="text-[11px] text-success/90 leading-relaxed">{success}</p>
                      </div>
                    </div>
                  )}

                  {/* Bouton Génération */}
                  <Button
                    onClick={generate}
                    disabled={generating || !selectedCollection}
                    size="lg"
                    className="w-full h-11 bg-primary text-primary-foreground font-semibold shadow-sm hover:scale-[1.01] active:scale-[0.99] transition-all duration-150"
                    data-testid="generate-button"
                  >
                    {generating ? (
                      <>
                        <Loader2 className="size-4 mr-2 animate-spin" />
                        Génération du SDK...
                      </>
                    ) : (
                      <>
                        <Download className="size-4 mr-2" />
                        Générer &amp; Télécharger
                      </>
                    )}
                  </Button>

                  <p className="text-[10px] text-center text-muted-foreground">
                    L&apos;archive ZIP contient le code source complet du client, les typages et la
                    configuration de build.
                  </p>
                </CardContent>
              </Card>

              {/* Carte d'Aide & Infos */}
              <Card className="bg-muted/10">
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-semibold flex items-center gap-1.5">
                    <Cpu className="size-3.5 text-primary" />
                    Comment utiliser le SDK ?
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-[11px] text-muted-foreground space-y-2 leading-relaxed">
                  <p>1. Téléchargez et dézippez l&apos;archive.</p>
                  <p>
                    2. Exécutez la commande de build native (ex:{" "}
                    <code className="font-mono text-foreground bg-muted px-1 rounded">
                      npm install &amp;&amp; npm run build
                    </code>
                    ).
                  </p>
                  <p>3. Importez le client typé directement dans votre application.</p>
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
