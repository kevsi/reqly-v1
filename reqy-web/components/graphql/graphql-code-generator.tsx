"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  generateFetchSnippet,
  generateCurlSnippet,
  generateTypeScriptStub,
  type CodegenInput,
} from "@/lib/graphql/codegen";
import { useTranslation } from "react-i18next";

interface Props {
  request: CodegenInput;
  operationName?: string;
}

type Format = "fetch" | "curl" | "typescript";

export function GraphqlCodeGenerator({ request, operationName = "Generated" }: Props) {
  const { t } = useTranslation();
  const [format, setFormat] = useState<Format>("fetch");
  const [copied, setCopied] = useState(false);

  const code =
    format === "fetch"
      ? generateFetchSnippet(request)
      : format === "curl"
        ? generateCurlSnippet(request)
        : generateTypeScriptStub(
            operationName,
            // Best-effort: extract top-level field names from a simple query.
            (request.query.match(/^\s*(\w+)/m)?.[1] ? [operationName] : []) as string[],
          );

  const copy = async () => {
    if (typeof navigator === "undefined") return;
    await navigator.clipboard.writeText(code).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="border-t bg-card p-2" data-testid="graphql-code-generator">
      <div className="flex items-center gap-2 mb-2">
        <Select value={format} onValueChange={(v) => setFormat(v as Format)}>
          <SelectTrigger className="h-7 text-xs w-32" data-testid="graphql-code-format">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="fetch">{t("graphql.codeGenerator.fetch")}</SelectItem>
            <SelectItem value="curl">{t("graphql.codeGenerator.curl")}</SelectItem>
            <SelectItem value="typescript">{t("graphql.codeGenerator.typescript")}</SelectItem>
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs"
          onClick={copy}
          data-testid="graphql-code-copy"
        >
          {copied ? <Check className="w-3 h-3 mr-1" /> : <Copy className="w-3 h-3 mr-1" />}
          {copied ? t("graphql.codeGenerator.copied") : t("graphql.codeGenerator.copy")}
        </Button>
      </div>
      <pre
        className="text-xs font-mono bg-muted/30 p-2 rounded overflow-auto max-h-64 whitespace-pre-wrap"
        data-testid="graphql-code-preview"
      >
        {code}
      </pre>
    </div>
  );
}
