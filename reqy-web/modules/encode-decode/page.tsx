"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  transform,
  CODEC_MODES,
  decodeJwt,
  verifyJwt,
  detect,
  hashText,
  uuidv4,
  randomHexBytes,
  randomBase64,
  utf8ByteLength,
  HASH_ALGOS,
  type CodecMode,
  type HashAlgorithm,
} from "./codec";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { JsonTreeViewer } from "@/components/json-tree-viewer";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  Copy,
  ArrowDownUp,
  Eraser,
  Binary,
  Check,
  KeyRound,
  Fingerprint,
  Dices,
  Clock,
  History,
  TriangleAlert,
  Trash2,
  Sparkles,
  ShieldCheck,
  ShieldAlert,
  FileUp,
  Download,
} from "lucide-react";

const HISTORY_KEY = "reqly_codec_history";
const MAX_HISTORY = 12;

interface HistoryEntry {
  mode: CodecMode;
  input: string;
  output: string;
  at: number;
}

function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? (JSON.parse(raw) as HistoryEntry[]) : [];
  } catch {
    return [];
  }
}

function CopyButton({ value, label = "Copier" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      variant="ghost"
      className="h-6 gap-1 text-xs"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard refusé */
        }
      }}
      disabled={!value}
    >
      {copied ? <Check className="size-3 text-success" /> : <Copy className="size-3" />}
      {copied ? "Copié" : label}
    </Button>
  );
}

function ByteCount({ value }: { value: string }) {
  if (!value) return null;
  return (
    <span className="text-[10px] tabular-nums text-muted-foreground/70">
      {value.length} car. · {utf8ByteLength(value)} octets
    </span>
  );
}

function countdownLabel(exp: number, nowMs: number): { label: string; expired: boolean } {
  const secondsLeft = exp - Math.floor(nowMs / 1000);
  if (secondsLeft <= 0) {
    return { label: `Expiré depuis ${Math.abs(secondsLeft)}s`, expired: true };
  }
  const m = Math.floor(secondsLeft / 60);
  const h = Math.floor(m / 60);
  const label =
    h > 0 ? `${h}h ${m % 60}min` : m > 0 ? `${m}min ${secondsLeft % 60}s` : `${secondsLeft}s`;
  return { label: `Expire dans ${label}`, expired: false };
}

// ── Transformer tab ──────────────────────────────────────────────────────

function TransformerTab({ onDetectJwt }: { onDetectJwt: (token: string) => void }) {
  const [mode, setMode] = useState<CodecMode>("b64-encode");
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory);
  const [detected, setDetected] = useState<string | null>(null);

  const result = useMemo(() => transform(mode, input), [mode, input]);

  const pushHistory = useCallback((input: string, output: string) => {
    if (!output) return;
    setHistory((h) => {
      const next = [{ mode, input, output, at: Date.now() }, ...h].slice(0, MAX_HISTORY);
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
      } catch {
        /* storage plein */
      }
      return next;
    });
  }, [mode]);

  const output = result.ok ? result.output : "";

  const handleDetect = () => {
    const res = detect(input);
    if (res.kind === "jwt") {
      onDetectJwt(input.trim());
      setDetected("JWT détecté → onglet JWT");
      return;
    }
    if (res.mode) {
      setMode(res.mode);
      setDetected(`Détecté : ${res.kind}`);
    } else {
      setDetected(res.kind === "plain" ? "Texte brut — aucun encodage évident." : null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Opération</Label>
          <Select value={mode} onValueChange={(v) => setMode(v as CodecMode)}>
            <SelectTrigger className="w-60">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CODEC_MODES.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-9 gap-1.5 text-xs"
          onClick={handleDetect}
          disabled={!input.trim()}
        >
          <Sparkles className="size-3" /> Détecter automatiquement
        </Button>
        <Button size="sm" variant="outline" className="h-9 gap-1.5 text-xs" onClick={() => pushHistory(input, output)} disabled={!output}>
          <History className="size-3" /> Enregistrer
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-9 gap-1.5 text-xs"
          onClick={() => {
            setInput("");
          }}
        >
          <Eraser className="size-3" /> Vider
        </Button>
      </div>

      {detected && (
        <Badge variant="outline" className="gap-1.5 text-xs">
          <Sparkles className="size-3 text-primary" />
          {detected}
        </Badge>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-xs text-muted-foreground">Entrée</Label>
            <ByteCount value={input} />
          </div>
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              mode.startsWith("json")
                ? 'Collez un JSON… ex: {"id":42,"nom":"Kévin"}'
                : mode === "json-to-csv"
                  ? '[{"id":1,"nom":"A"},{"id":2,"nom":"B"}]'
                  : mode === "csv-to-json"
                    ? "id,nom\n1,A\n2,B"
                    : "Collez le texte à transformer…"
            }
            className="min-h-40 font-mono text-xs"
            aria-label="Entrée"
          />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-xs text-muted-foreground">Sortie</Label>
            <div className="flex items-center gap-2">
              <ByteCount value={output} />
              <CopyButton value={output} />
            </div>
          </div>
          <Textarea
            value={result.ok ? result.output : ""}
            readOnly
            placeholder="La sortie apparaît ici automatiquement…"
            className={cn(
              "min-h-40 font-mono text-xs",
              !result.ok && "border-destructive/50 text-destructive",
            )}
            aria-label="Sortie"
          />
          {!result.ok && (
            <p className="flex items-center gap-1.5 text-xs text-destructive">
              <TriangleAlert className="size-3" />
              {result.error}
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {output && (
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 text-xs"
            onClick={() => setInput(output)}
          >
            <ArrowDownUp className="size-3" /> Utiliser la sortie comme entrée
          </Button>
        )}
      </div>

      {history.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-medium text-muted-foreground">Historique récent</Label>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 gap-1 text-xs text-destructive"
              onClick={() => {
                setHistory([]);
                localStorage.removeItem(HISTORY_KEY);
              }}
            >
              <Trash2 className="size-3" /> Vider
            </Button>
          </div>
          <div className="space-y-1">
            {history.map((h, i) => (
              <div
                key={h.at + "-" + i}
                className="flex items-center gap-2 rounded-lg border border-border bg-muted/20 px-3 py-1.5 text-xs"
              >
                <Badge variant="outline" className="font-mono shrink-0">{h.mode}</Badge>
                <button
                  className="min-w-0 flex-1 truncate text-left font-mono text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    setMode(h.mode);
                    setInput(h.input);
                  }}
                  title={`Réutiliser : ${h.input}`}
                >
                  {h.input}
                </button>
                <span className="shrink-0 text-muted-foreground/50">
                  {new Date(h.at).toLocaleTimeString()}
                </span>
                <CopyButton value={h.output} label="Copier" />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── JWT tab ──────────────────────────────────────────────────────────────

function JwtTab({ token, onTokenChange }: { token: string; onTokenChange: (t: string) => void }) {
  const [secret, setSecret] = useState("");
  const [verifyState, setVerifyState] = useState<"idle" | "checking" | "done">("idle");
  const [verifyResult, setVerifyResult] = useState<{ valid: boolean; error?: string; alg?: string } | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const jwt = useMemo(() => decodeJwt(token), [token]);
  const headerText = jwt.ok && jwt.header ? JSON.stringify(jwt.header, null, 2) : "";
  const payloadText = jwt.ok && jwt.payload ? JSON.stringify(jwt.payload, null, 2) : "";

  const handleVerify = async () => {
    if (!token.trim() || !secret) return;
    setVerifyState("checking");
    const res = await verifyJwt(token, secret);
    setVerifyResult(res);
    setVerifyState("done");
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Token JWT</Label>
        <Textarea
          value={token}
          onChange={(e) => onTokenChange(e.target.value)}
          placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.…"
          className="min-h-24 font-mono text-xs"
          aria-label="Token JWT"
        />
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-48 flex-1 space-y-1">
          <Label className="text-xs text-muted-foreground">Secret HMAC (vérification)</Label>
          <Input
            type="password"
            value={secret}
            onChange={(e) => {
              setSecret(e.target.value);
              setVerifyState("idle");
              setVerifyResult(null);
            }}
            placeholder="Votre secret signé…"
            className="h-8 font-mono text-xs"
            aria-label="Secret HMAC"
          />
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-8 gap-1.5 text-xs"
          onClick={handleVerify}
          disabled={!token.trim() || !secret || verifyState === "checking"}
        >
          {verifyState === "checking" ? "Vérification…" : "Vérifier la signature"}
        </Button>
      </div>

      {verifyResult &&
        (verifyResult.valid ? (
          <Badge variant="outline" className="gap-1.5 text-success">
            <ShieldCheck className="size-3" /> Signature valide
            {verifyResult.alg ? ` (${verifyResult.alg})` : ""}
          </Badge>
        ) : (
          <Badge variant="outline" className="gap-1.5 border-destructive/40 text-destructive">
            <ShieldAlert className="size-3" /> {verifyResult.error ?? "Signature invalide"}
          </Badge>
        ))}

      {!token.trim() && (
        <p className="text-xs text-muted-foreground">
          Collez un JWT pour décoder header et payload. Entrez le secret pour vérifier la signature
          (HS256/384/512, calcul local).
        </p>
      )}

      {token.trim() && !jwt.ok && (
        <p className="flex items-center gap-1.5 text-xs text-destructive">
          <TriangleAlert className="size-3" />
          {jwt.error}
        </p>
      )}

      {jwt.ok && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="font-mono">
              {String(jwt.header?.alg ?? "?")}
            </Badge>
            {jwt.exp && (
              <Badge
                variant="outline"
                className={cn(
                  "gap-1",
                  countdownLabel(jwt.exp, now).expired
                    ? "border-destructive/40 text-destructive"
                    : "text-success",
                )}
              >
                <Clock className="size-3" />
                {countdownLabel(jwt.exp, now).label}
              </Badge>
            )}
            <Badge variant="outline">Signature : {jwt.signatureHex?.slice(0, 16)}…</Badge>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="border-muted">
              <CardHeader className="pb-1 pt-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">Header</CardTitle>
                  <CopyButton value={headerText} />
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="max-h-64 overflow-auto">
                  <JsonTreeViewer data={jwt.header} />
                </div>
              </CardContent>
            </Card>
            <Card className="border-muted">
              <CardHeader className="pb-1 pt-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">Payload</CardTitle>
                  <CopyButton value={payloadText} />
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="max-h-64 overflow-auto">
                  <JsonTreeViewer data={jwt.payload} />
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

// ── Hash tab ─────────────────────────────────────────────────────────────

function HashTab() {
  const [input, setInput] = useState("");
  const [expected, setExpected] = useState("");
  const [hashes, setHashes] = useState<Record<HashAlgorithm, string>>({
    "SHA-1": "",
    "SHA-256": "",
    "SHA-384": "",
    "SHA-512": "",
  });

  useEffect(() => {
    let cancelled = false;
    const compute = async () => {
      const next = {} as Record<HashAlgorithm, string>;
      for (const algo of HASH_ALGOS) {
        try {
          next[algo.id] = input ? await hashText(algo.id, input) : "";
        } catch {
          next[algo.id] = "";
        }
      }
      if (!cancelled) setHashes(next);
    };
    const id = setTimeout(compute, 150);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [input]);

  const expectedNorm = expected.trim().toLowerCase();

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground">Entrée</Label>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 gap-1 text-xs"
            onClick={() => setInput("")}
          >
            <Eraser className="size-3" /> Vider
          </Button>
        </div>
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Texte à hacher (ou données à signer)…"
          className="min-h-28 font-mono text-xs"
          aria-label="Texte à hacher"
        />
      </div>

      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">
          Hash attendu (comparaison) — facultatif
        </Label>
        <Input
          value={expected}
          onChange={(e) => setExpected(e.target.value)}
          placeholder="Ex : 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
          className="h-8 font-mono text-xs"
          aria-label="Hash attendu"
        />
      </div>

      {input && (
        <div className="space-y-1.5">
          {HASH_ALGOS.map((algo) => {
            const value = hashes[algo.id];
            const matches = expectedNorm && value ? value.toLowerCase() === expectedNorm : null;
            return (
              <div
                key={algo.id}
                className={cn(
                  "flex items-center gap-3 rounded-lg border px-3 py-2",
                  matches === true && "border-success/40 bg-success/5",
                  matches === false && "border-destructive/40 bg-destructive/5",
                  matches === null && "border-border bg-muted/20",
                )}
              >
                <Badge variant="outline" className="w-20 justify-center shrink-0 font-mono">
                  {algo.label}
                </Badge>
                <code className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
                  {value}
                </code>
                {matches !== null && (
                  <span className={cn("shrink-0 text-xs", matches ? "text-success" : "text-destructive")}>
                    {matches ? "✓ correspond" : "✗ différent"}
                  </span>
                )}
                <CopyButton value={value} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Generator tab ────────────────────────────────────────────────────────

interface GeneratorItem {
  id: string;
  label: string;
  hint: string;
  generate: () => string;
}

function GeneratorTab() {
  const [values, setValues] = useState<Record<string, string>>({});

  const items: GeneratorItem[] = [
    { id: "uuid", label: "UUID v4", hint: "Identifiant unique", generate: () => uuidv4() },
    {
      id: "timestamp",
      label: "Timestamp (s)",
      hint: "Epoch Unix secondes",
      generate: () => String(Math.floor(Date.now() / 1000)),
    },
    {
      id: "iso",
      label: "Date ISO",
      hint: "ISO 8601 / UTC",
      generate: () => new Date().toISOString(),
    },
    {
      id: "hex32",
      label: "Hex aléatoire (32 o)",
      hint: "Clé secrète / seed",
      generate: () => randomHexBytes(32),
    },
    {
      id: "b64",
      label: "Base64 aléatoire (24 o)",
      hint: "Token opaque",
      generate: () => randomBase64(24),
    },
  ];

  const generate = (id: string) => {
    const item = items.find((i) => i.id === id);
    if (!item) return;
    setValues((v) => ({ ...v, [id]: item.generate() }));
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Générez des valeurs prêtes à copier pour vos tests et payloads.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {items.map((item) => (
          <div
            key={item.id}
            className="flex flex-col gap-2 rounded-lg border border-border bg-muted/20 p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium">{item.label}</p>
                <p className="text-xs text-muted-foreground">{item.hint}</p>
              </div>
              <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => generate(item.id)}>
                <Dices className="size-3" /> Générer
              </Button>
            </div>
            <div className="flex items-center gap-2 rounded-md bg-background px-2 py-1.5">
              <code className="min-w-0 flex-1 truncate font-mono text-xs">
                {values[item.id] ?? "—"}
              </code>
              <CopyButton value={values[item.id] ?? ""} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── File tab ─────────────────────────────────────────────────────────────

function FileTab() {
  const [name, setName] = useState("");
  const [mime, setMime] = useState("");
  const [size, setSize] = useState(0);
  const [base64, setBase64] = useState("");
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const readFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // FileReader.readAsDataURL gives "data:mime;base64,...."
      const comma = result.indexOf(",");
      setName(file.name);
      setMime(file.type || "application/octet-stream");
      setSize(file.size);
      setBase64(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="space-y-4">
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file) readFile(file);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors",
          dragging
            ? "border-primary bg-primary/5 text-primary"
            : "border-border bg-muted/20 text-muted-foreground hover:border-primary/50 hover:text-foreground",
        )}
      >
        <FileUp className="size-8" />
        <p className="text-sm font-medium">Glissez-déposez un fichier ou cliquez pour choisir</p>
        <p className="text-xs text-muted-foreground">
          Le fichier est converti en Base64 localement — jamais envoyé sur le réseau.
        </p>
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) readFile(file);
          }}
        />
      </div>

      {base64 && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="outline">{name}</Badge>
            <Badge variant="outline">{mime}</Badge>
            <Badge variant="outline">{(size / 1024).toFixed(2)} Ko</Badge>
            <Badge variant="outline">Base64 : {(base64.length / 1024).toFixed(2)} Ko</Badge>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={() => navigator.clipboard.writeText(base64).catch(() => {})}>
              <Copy className="size-3" /> Copier le Base64
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 text-xs"
              onClick={() => {
                try {
                  const bin = atob(base64);
                  const bytes = new Uint8Array(bin.length);
                  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                  const blob = new Blob([bytes], { type: mime });
                  const a = document.createElement("a");
                  a.href = URL.createObjectURL(blob);
                  a.download = name;
                  a.click();
                  URL.revokeObjectURL(a.href);
                } catch {
                  /* blob invalide */
                }
              }}
            >
              <Download className="size-3" /> Télécharger le fichier original
            </Button>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">Base64</Label>
              <CopyButton value={base64} />
            </div>
            <Textarea
              value={base64}
              readOnly
              className="min-h-32 font-mono text-xs"
              aria-label="Base64 du fichier"
            />
          </div>
        </>
      )}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────

export function EncodeDecodePage() {
  const [activeTab, setActiveTab] = useState("transform");
  const [jwtToken, setJwtToken] = useState("");

  const handleDetectJwt = (token: string) => {
    setJwtToken(token);
    setActiveTab("jwt");
  };

  return (
    <main className="flex-1 overflow-auto p-6 hide-scrollbar" data-testid="encode-decode-page">
      <div className="mx-auto max-w-5xl space-y-6">
        <header>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Binary className="size-6 text-primary" />
            Encodeur / Décodeur
          </h1>
          <p className="text-sm text-muted-foreground">
            Transformez, décryptez des JWT, hachez, convertissez et générez — tout reste local, rien
            n'est envoyé sur le réseau.
          </p>
        </header>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="flex-wrap">
            <TabsTrigger value="transform">
              <ArrowDownUp className="size-4" /> Transformer
            </TabsTrigger>
            <TabsTrigger value="jwt">
              <KeyRound className="size-4" /> JWT
            </TabsTrigger>
            <TabsTrigger value="hash">
              <Fingerprint className="size-4" /> Hachage
            </TabsTrigger>
            <TabsTrigger value="generate">
              <Dices className="size-4" /> Générateur
            </TabsTrigger>
            <TabsTrigger value="file">
              <FileUp className="size-4" /> Fichier
            </TabsTrigger>
          </TabsList>

          <TabsContent value="transform">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Binary className="size-4 text-muted-foreground" />
                  Base64 · URL · Hex · JSON · HTML · CSV
                </CardTitle>
              </CardHeader>
              <CardContent>
                <TransformerTab onDetectJwt={handleDetectJwt} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="jwt">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <KeyRound className="size-4 text-muted-foreground" />
                  Décodeur JWT + vérification HMAC
                </CardTitle>
              </CardHeader>
              <CardContent>
                <JwtTab token={jwtToken} onTokenChange={setJwtToken} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="hash">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Fingerprint className="size-4 text-muted-foreground" />
                  Empreinte SHA + comparaison
                </CardTitle>
              </CardHeader>
              <CardContent>
                <HashTab />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="generate">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Dices className="size-4 text-muted-foreground" />
                  Générateur
                </CardTitle>
              </CardHeader>
              <CardContent>
                <GeneratorTab />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="file">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <FileUp className="size-4 text-muted-foreground" />
                  Fichier → Base64
                </CardTitle>
              </CardHeader>
              <CardContent>
                <FileTab />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <Separator />
        <p className="text-xs text-muted-foreground">
          Astuce : « Détecter automatiquement » reconnaît un JWT, du JSON, du Base64, une URL
          encodée ou de l'hex. Le décodage JWT lit header + payload ; la vérification HMAC calcule
          la signature localement avec votre secret.
        </p>
      </div>
    </main>
  );
}
