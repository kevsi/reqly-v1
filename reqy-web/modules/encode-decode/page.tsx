"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
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

function CopyButton({ value, label }: { value: string; label?: string }) {
  const { t } = useTranslation();
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
          /* clipboard refused */
        }
      }}
      disabled={!value}
    >
      {copied ? <Check className="size-3 text-success" /> : <Copy className="size-3" />}
      {copied ? t("encodeDecode.copied") : (label ?? t("encodeDecode.copy"))}
    </Button>
  );
}

function ByteCount({ value }: { value: string }) {
  if (!value) return null;
  return (
    <span className="text-[10px] tabular-nums text-muted-foreground/70">
      {value.length} chars · {utf8ByteLength(value)} bytes
    </span>
  );
}

function countdownLabel(
  exp: number,
  nowMs: number,
  t: (key: string, opts?: Record<string, unknown>) => string,
): { label: string; expired: boolean } {
  const secondsLeft = exp - Math.floor(nowMs / 1000);
  if (secondsLeft <= 0) {
    return {
      label: t("encodeDecode.countdown.expired", { count: Math.abs(secondsLeft) }),
      expired: true,
    };
  }
  const m = Math.floor(secondsLeft / 60);
  const h = Math.floor(m / 60);
  const label =
    h > 0 ? `${h}h ${m % 60}min` : m > 0 ? `${m}min ${secondsLeft % 60}s` : `${secondsLeft}s`;
  return { label: t("encodeDecode.countdown.expireIn", { time: label }), expired: false };
}

// ── Transformer tab ──────────────────────────────────────────────────────

function TransformerTab({ onDetectJwt }: { onDetectJwt: (token: string) => void }) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<CodecMode>("b64-encode");
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory);
  const [detected, setDetected] = useState<string | null>(null);

  const result = useMemo(() => transform(mode, input), [mode, input]);

  const pushHistory = useCallback(
    (input: string, output: string) => {
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
    },
    [mode],
  );

  const output = result.ok ? result.output : "";

  const handleDetect = () => {
    const res = detect(input);
    if (res.kind === "jwt") {
      onDetectJwt(input.trim());
      setDetected(t("encodeDecode.detectedJwt"));
      return;
    }
    if (res.mode) {
      setMode(res.mode);
      setDetected(t("encodeDecode.detectedKind", { kind: res.kind }));
    } else {
      setDetected(res.kind === "plain" ? t("encodeDecode.detectedPlain") : null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">{t("encodeDecode.operation")}</Label>
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
          <Sparkles className="size-3" /> {t("encodeDecode.detect")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-9 gap-1.5 text-xs"
          onClick={() => pushHistory(input, output)}
          disabled={!output}
        >
          <History className="size-3" /> {t("encodeDecode.save")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-9 gap-1.5 text-xs"
          onClick={() => {
            setInput("");
          }}
        >
          <Eraser className="size-3" /> {t("encodeDecode.clear")}
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
            <Label className="text-xs text-muted-foreground">{t("encodeDecode.input")}</Label>
            <ByteCount value={input} />
          </div>
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              mode.startsWith("json")
                ? t("encodeDecode.inputPlaceholderJson")
                : mode === "json-to-csv"
                  ? t("encodeDecode.inputPlaceholderJsonToCsv")
                  : mode === "csv-to-json"
                    ? t("encodeDecode.inputPlaceholderCsvToJson")
                    : t("encodeDecode.inputPlaceholderDefault")
            }
            className="min-h-40 font-mono text-xs"
            aria-label={t("encodeDecode.input")}
          />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-xs text-muted-foreground">{t("encodeDecode.output")}</Label>
            <div className="flex items-center gap-2">
              <ByteCount value={output} />
              <CopyButton value={output} />
            </div>
          </div>
          <Textarea
            value={result.ok ? result.output : ""}
            readOnly
            placeholder={t("encodeDecode.outputPlaceholder")}
            className={cn(
              "min-h-40 font-mono text-xs",
              !result.ok && "border-destructive/50 text-destructive",
            )}
            aria-label={t("encodeDecode.output")}
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
            <ArrowDownUp className="size-3" /> {t("encodeDecode.useOutputAsInput")}
          </Button>
        )}
      </div>

      {history.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-medium text-muted-foreground">
              {t("encodeDecode.recentHistory")}
            </Label>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 gap-1 text-xs text-destructive"
              onClick={() => {
                setHistory([]);
                localStorage.removeItem(HISTORY_KEY);
              }}
            >
              <Trash2 className="size-3" /> {t("encodeDecode.clear")}
            </Button>
          </div>
          <div className="space-y-1">
            {history.map((h, i) => (
              <div
                key={h.at + "-" + i}
                className="flex items-center gap-2 rounded-lg border border-border bg-muted/20 px-3 py-1.5 text-xs"
              >
                <Badge variant="outline" className="font-mono shrink-0">
                  {h.mode}
                </Badge>
                <button
                  className="min-w-0 flex-1 truncate text-left font-mono text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    setMode(h.mode);
                    setInput(h.input);
                  }}
                  title={t("encodeDecode.reuse", { input: h.input })}
                >
                  {h.input}
                </button>
                <span className="shrink-0 text-muted-foreground/50">
                  {new Date(h.at).toLocaleTimeString()}
                </span>
                <CopyButton value={h.output} />
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
  const { t } = useTranslation();
  const [secret, setSecret] = useState("");
  const [verifyState, setVerifyState] = useState<"idle" | "checking" | "done">("idle");
  const [verifyResult, setVerifyResult] = useState<{
    valid: boolean;
    error?: string;
    alg?: string;
  } | null>(null);
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
        <Label className="text-xs text-muted-foreground">{t("encodeDecode.jwtToken")}</Label>
        <Textarea
          value={token}
          onChange={(e) => onTokenChange(e.target.value)}
          placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.…"
          className="min-h-24 font-mono text-xs"
          aria-label={t("encodeDecode.jwtTokenAria")}
        />
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-48 flex-1 space-y-1">
          <Label className="text-xs text-muted-foreground">{t("encodeDecode.hmacSecret")}</Label>
          <Input
            type="password"
            value={secret}
            onChange={(e) => {
              setSecret(e.target.value);
              setVerifyState("idle");
              setVerifyResult(null);
            }}
            placeholder={t("encodeDecode.secretPlaceholder")}
            className="h-8 font-mono text-xs"
            aria-label={t("encodeDecode.secretAria")}
          />
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-8 gap-1.5 text-xs"
          onClick={handleVerify}
          disabled={!token.trim() || !secret || verifyState === "checking"}
        >
          {verifyState === "checking"
            ? t("encodeDecode.verifying")
            : t("encodeDecode.verifySignature")}
        </Button>
      </div>

      {verifyResult &&
        (verifyResult.valid ? (
          <Badge variant="outline" className="gap-1.5 text-success">
            <ShieldCheck className="size-3" /> {t("encodeDecode.validSignature")}
            {verifyResult.alg ? ` (${verifyResult.alg})` : ""}
          </Badge>
        ) : (
          <Badge variant="outline" className="gap-1.5 border-destructive/40 text-destructive">
            <ShieldAlert className="size-3" />{" "}
            {verifyResult.error ?? t("encodeDecode.invalidSignature")}
          </Badge>
        ))}

      {!token.trim() && (
        <p className="text-xs text-muted-foreground">{t("encodeDecode.jwtDecodeHint")}</p>
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
                  countdownLabel(jwt.exp, now, t).expired
                    ? "border-destructive/40 text-destructive"
                    : "text-success",
                )}
              >
                <Clock className="size-3" />
                {countdownLabel(jwt.exp, now, t).label}
              </Badge>
            )}
            <Badge variant="outline">
              {t("encodeDecode.signature", { hex: jwt.signatureHex?.slice(0, 16) ?? "" })}…
            </Badge>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="border-muted">
              <CardHeader className="pb-1 pt-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">{t("encodeDecode.header")}</CardTitle>
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
                  <CardTitle className="text-sm">{t("encodeDecode.payload")}</CardTitle>
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
  const { t } = useTranslation();
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
          <Label className="text-xs text-muted-foreground">{t("encodeDecode.input")}</Label>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 gap-1 text-xs"
            onClick={() => setInput("")}
          >
            <Eraser className="size-3" /> {t("encodeDecode.clear")}
          </Button>
        </div>
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t("encodeDecode.hashInputPlaceholder")}
          className="min-h-28 font-mono text-xs"
          aria-label={t("encodeDecode.hashInputAria")}
        />
      </div>

      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">{t("encodeDecode.expectedHash")}</Label>
        <Input
          value={expected}
          onChange={(e) => setExpected(e.target.value)}
          placeholder={t("encodeDecode.expectedHashPlaceholder")}
          className="h-8 font-mono text-xs"
          aria-label={t("encodeDecode.expectedHashAria")}
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
                  <span
                    className={cn(
                      "shrink-0 text-xs",
                      matches ? "text-success" : "text-destructive",
                    )}
                  >
                    {matches ? t("encodeDecode.matches") : t("encodeDecode.different")}
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
  const { t } = useTranslation();
  const [values, setValues] = useState<Record<string, string>>({});

  const items: GeneratorItem[] = [
    { id: "uuid", label: "UUID v4", hint: t("encodeDecode.genHintUuid"), generate: () => uuidv4() },
    {
      id: "timestamp",
      label: "Timestamp (s)",
      hint: t("encodeDecode.genHintTimestamp"),
      generate: () => String(Math.floor(Date.now() / 1000)),
    },
    {
      id: "iso",
      label: "Date ISO",
      hint: t("encodeDecode.genHintIso"),
      generate: () => new Date().toISOString(),
    },
    {
      id: "hex32",
      label: "Random hex (32 B)",
      hint: t("encodeDecode.genHintHex"),
      generate: () => randomHexBytes(32),
    },
    {
      id: "b64",
      label: "Random base64 (24 B)",
      hint: t("encodeDecode.genHintB64"),
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
      <p className="text-xs text-muted-foreground">{t("encodeDecode.generatorIntro")}</p>
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
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1 text-xs"
                onClick={() => generate(item.id)}
              >
                <Dices className="size-3" /> {t("encodeDecode.generate")}
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
  const { t } = useTranslation();
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
        <p className="text-sm font-medium">{t("encodeDecode.fileDragDrop")}</p>
        <p className="text-xs text-muted-foreground">{t("encodeDecode.fileLocalHint")}</p>
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
            <Badge variant="outline">
              {t("encodeDecode.sizeKo", { size: (size / 1024).toFixed(2) })}
            </Badge>
            <Badge variant="outline">
              {t("encodeDecode.base64Size", { size: (base64.length / 1024).toFixed(2) })}
            </Badge>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 text-xs"
              onClick={() => navigator.clipboard.writeText(base64).catch(() => {})}
            >
              <Copy className="size-3" /> {t("encodeDecode.copyBase64")}
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
              <Download className="size-3" /> {t("encodeDecode.downloadFile")}
            </Button>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">
                {t("encodeDecode.base64Label")}
              </Label>
              <CopyButton value={base64} />
            </div>
            <Textarea
              value={base64}
              readOnly
              className="min-h-32 font-mono text-xs"
              aria-label={t("encodeDecode.base64Aria")}
            />
          </div>
        </>
      )}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────

export function EncodeDecodePage() {
  const { t } = useTranslation();
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
            {t("encodeDecode.title")}
          </h1>
          <p className="text-sm text-muted-foreground">{t("encodeDecode.subtitle")}</p>
        </header>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="flex-wrap">
            <TabsTrigger value="transform">
              <ArrowDownUp className="size-4" /> {t("encodeDecode.tabTransformer")}
            </TabsTrigger>
            <TabsTrigger value="jwt">
              <KeyRound className="size-4" /> {t("encodeDecode.tabJwt")}
            </TabsTrigger>
            <TabsTrigger value="hash">
              <Fingerprint className="size-4" /> {t("encodeDecode.tabHash")}
            </TabsTrigger>
            <TabsTrigger value="generate">
              <Dices className="size-4" /> {t("encodeDecode.tabGenerator")}
            </TabsTrigger>
            <TabsTrigger value="file">
              <FileUp className="size-4" /> {t("encodeDecode.tabFile")}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="transform">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Binary className="size-4 text-muted-foreground" />
                  {t("encodeDecode.transformTitle")}
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
                  {t("encodeDecode.jwtTitle")}
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
                  {t("encodeDecode.hashTitle")}
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
                  {t("encodeDecode.generatorTitle")}
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
                  {t("encodeDecode.fileTitle")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <FileTab />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <Separator />
        <p className="text-xs text-muted-foreground">{t("encodeDecode.tip")}</p>
      </div>
    </main>
  );
}
