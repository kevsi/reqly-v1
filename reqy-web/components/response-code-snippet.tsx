"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const languages = [
  { id: "python", label: "Python" },
  { id: "javascript", label: "JavaScript" },
  { id: "curl", label: "cURL" },
  { id: "php", label: "PHP" },
  { id: "go", label: "Go" },
];

interface CodeSnippetProps {
  method?: string;
  url?: string;
  queryParams?: Array<{ key: string; value: string }>;
  requestHeaders?: Array<{ key: string; value: string }>;
  body?: string;
  bodyType?: string;
  authType?: string;
  authToken?: string;
}

export function CodeSnippet({
  method = "GET",
  url = "",
  queryParams = [],
  requestHeaders = [],
  body = "",
  bodyType = "none",
  authType = "none",
  authToken = "",
}: CodeSnippetProps) {
  const [selectedLang, setSelectedLang] = useState("python");
  const [copied, setCopied] = useState(false);

  const generateCodeSnippet = (language: string) => {
    const headersObj = requestHeaders.reduce(
      (acc, header) => {
        if (header.key && header.value) {
          acc[header.key] = header.value;
        }
        return acc;
      },
      {} as Record<string, string>,
    );

    if (authType === "bearer" && authToken) {
      headersObj["Authorization"] = `Bearer ${authToken}`;
    } else if (authType === "basic" && authToken) {
      headersObj["Authorization"] = `Basic ${authToken}`;
    }

    const headersString =
      Object.keys(headersObj).length > 0
        ? Object.entries(headersObj)
            .map(([k, v]) => `"${k}": "${v}"`)
            .join(",\n      ")
        : "";

    const queryStr = url.includes("?") ? url.split("?")[1] : "";
    const baseUrl = url.split("?")[0];

    switch (language) {
      case "python": {
        const pythonHeaders =
          Object.keys(headersObj).length > 0
            ? `headers = {\n${Object.entries(headersObj)
                .map(([k, v]) => `    "${k}": "${v}"`)
                .join(",\n")}\n}\n\n`
            : "";
        const pythonParams = queryStr
          ? `params = {\n${queryStr
              .split("&")
              .map((p) => {
                const [k, v] = p.split("=");
                return `    "${k}": "${decodeURIComponent(v || "")}"`;
              })
              .join(",\n")}\n}\n\n`
          : "";
        const pythonBody = body && bodyType !== "none" ? `data = """${body}"""\n\n` : "";

        return (
          <>
            <span className="text-blue-600 dark:text-blue-400">import</span>
            <span className="text-code-text"> requests</span>
            {"\n\n"}
            <span className="text-code-text">url = </span>
            <span className="text-emerald-600 dark:text-emerald-400">"{baseUrl}"</span>
            {"\n"}
            {pythonParams && (
              <>
                <span className="text-code-text">{pythonParams}</span>
              </>
            )}
            {pythonHeaders && (
              <>
                <span className="text-code-text">{pythonHeaders}</span>
              </>
            )}
            {pythonBody && (
              <>
                <span className="text-code-text">{pythonBody}</span>
              </>
            )}
            <span className="text-code-text">response = requests.</span>
            <span className="text-yellow-600 dark:text-yellow-400">{method.toLowerCase()}</span>
            <span className="text-code-text">(url</span>
            {pythonParams && <span className="text-code-text">, params=params</span>}
            {pythonHeaders && <span className="text-code-text">, headers=headers</span>}
            {pythonBody && <span className="text-code-text">, data=data</span>}
            <span className="text-code-text">)</span>
            {"\n"}
            <span className="text-code-text">print(response.</span>
            <span className="text-yellow-600 dark:text-yellow-400">json</span>
            <span className="text-code-text">())</span>
          </>
        );
      }

      case "javascript": {
        const jsHeaders = headersString ? `const headers = {\n      ${headersString}\n    };` : "";
        const jsParams = queryStr
          ? `const params = new URLSearchParams({\n      ${queryStr
              .split("&")
              .map((p) => {
                const [k, v] = p.split("=");
                return `"${k}": "${decodeURIComponent(v || "")}"`;
              })
              .join(",\n      ")}\n    });`
          : "";
        const jsBody = body && bodyType !== "none" ? `const body = \`${body}\`;` : "";

        return (
          <>
            <span className="text-blue-600 dark:text-blue-400">const</span>
            <span className="text-code-text"> url = </span>
            <span className="text-emerald-600 dark:text-emerald-400">`{baseUrl}</span>
            {queryStr && <span className="text-emerald-600 dark:text-emerald-400">?{queryStr}</span>}
            <span className="text-emerald-600 dark:text-emerald-400">`</span>
            <span className="text-code-text">;</span>
            {"\n"}
            {jsParams && (
              <>
                <span className="text-code-text">{jsParams}</span>
                {"\n"}
              </>
            )}
            {jsHeaders && (
              <>
                <span className="text-code-text">{jsHeaders}</span>
                {"\n"}
              </>
            )}
            {jsBody && (
              <>
                <span className="text-code-text">{jsBody}</span>
                {"\n"}
              </>
            )}
            <span className="text-code-text">fetch(url, {"{"}</span>
            {"\n"}
            <span className="text-code-text"> method: </span>
            <span className="text-emerald-600 dark:text-emerald-400">"{method}"</span>
            <span className="text-code-text">,</span>
            {"\n"}
            {jsHeaders && (
              <>
                <span className="text-code-text"> headers,</span>
                {"\n"}
              </>
            )}
            {jsBody && (
              <>
                <span className="text-code-text"> body,</span>
                {"\n"}
              </>
            )}
            <span className="text-code-text">
              {"}"}).then(response {"=>"} response.
            </span>
            <span className="text-yellow-600 dark:text-yellow-400">json</span>
            <span className="text-code-text">{"()).then(data => console."}</span>
            <span className="text-yellow-600 dark:text-yellow-400">log</span>
            <span className="text-code-text">(data));</span>
          </>
        );
      }

      case "curl": {
        const curlHeaders = Object.entries(headersObj)
          .map(([k, v]) => `-H "${k}: ${v}"`)
          .join(" \\\n  ");
        const curlBody = body && bodyType !== "none" ? `-d '${body}'` : "";
        const curlParams = queryStr
          ? queryStr
              .split("&")
              .filter(Boolean)
              .map((p) => {
                const [k, v] = p.split("=");
                return `${encodeURIComponent(decodeURIComponent(k))}=${encodeURIComponent(decodeURIComponent(v || ""))}`;
              })
              .join("&")
          : "";
        const curlUrl = curlParams ? url + (url.includes("?") ? "&" : "?") + curlParams : url;

        return (
          <>
            <span className="text-yellow-600 dark:text-yellow-400">curl</span>
            <span className="text-code-text"> -X {method} \</span>
            {"\n"}
            <span className="text-code-text"> </span>
            <span className="text-emerald-600 dark:text-emerald-400">"{curlUrl}"</span>
            {curlHeaders && (
              <>
                <span className="text-code-text"> \</span>
                {"\n"}
                <span className="text-code-text"> {curlHeaders}</span>
              </>
            )}
            {curlBody && (
              <>
                <span className="text-code-text"> \</span>
                {"\n"}
                <span className="text-code-text"> {curlBody}</span>
              </>
            )}
          </>
        );
      }

      case "php": {
        const phpHeaders = Object.entries(headersObj)
          .map(([k, v]) => `    "${k}: ${v}",`)
          .join("\n");
        const phpBody = body && bodyType !== "none" ? `$body = '${body}';\n\n` : "";

        return (
          <>
            <span className="text-blue-600 dark:text-blue-400">&lt;?php</span>
            {"\n\n"}
            <span className="text-code-text">$url = </span>
            <span className="text-emerald-600 dark:text-emerald-400">'{url}'</span>
            <span className="text-code-text">;</span>
            {"\n"}
            {phpBody}
            <span className="text-code-text">$options = [</span>
            {"\n"}
            <span className="text-code-text">{"    'http' => ["}</span>
            {"\n"}
            <span className="text-code-text">{"        'method' => "}</span>
            <span className="text-emerald-600 dark:text-emerald-400">'{method}'</span>
            <span className="text-code-text">,</span>
            {"\n"}
            <span className="text-code-text">{"        'header' => ["}</span>
            {"\n"}
            {phpHeaders && (
              <>
                <span className="text-code-text">{phpHeaders}</span>
                {"\n"}
              </>
            )}
            <span className="text-code-text"> ],</span>
            {"\n"}
            {phpBody && (
              <>
                <span className="text-code-text">{"        'content' => $body,"}</span>
                {"\n"}
              </>
            )}
            <span className="text-code-text"> ]</span>
            {"\n"}
            <span className="text-code-text">];</span>
            {"\n\n"}
            <span className="text-code-text">$context = stream_context_create($options);</span>
            {"\n"}
            <span className="text-code-text">
              $response = file_get_contents($url, false, $context);
            </span>
            {"\n"}
            <span className="text-blue-600 dark:text-blue-400">echo</span>
            <span className="text-code-text"> $response;</span>
            {"\n\n"}
            <span className="text-blue-600 dark:text-blue-400">?&gt;</span>
          </>
        );
      }

      case "go": {
        const goHeaders = Object.entries(headersObj)
          .map(([k, v]) => `    "${k}": "${v}",`)
          .join("\n");
        const goBody =
          body && bodyType !== "none" ? `body := strings.NewReader(\`${body}\`)\n\n    ` : "";

        return (
          <>
            <span className="text-blue-600 dark:text-blue-400">package</span>
            <span className="text-code-text"> main</span>
            {"\n\n"}
            <span className="text-blue-600 dark:text-blue-400">import</span>
            <span className="text-code-text"> (</span>
            {"\n"}
            <span className="text-code-text"> </span>
            <span className="text-emerald-600 dark:text-emerald-400">"fmt"</span>
            {"\n"}
            <span className="text-code-text"> </span>
            <span className="text-emerald-600 dark:text-emerald-400">"io"</span>
            {"\n"}
            {goBody && (
              <>
                <span className="text-code-text"> </span>
                <span className="text-emerald-600 dark:text-emerald-400">"strings"</span>
                {"\n"}
              </>
            )}
            <span className="text-code-text"> </span>
            <span className="text-emerald-600 dark:text-emerald-400">"net/http"</span>
            {"\n"}
            <span className="text-code-text">)</span>
            {"\n\n"}
            <span className="text-blue-600 dark:text-blue-400">func</span>
            <span className="text-code-text"> main() {"{"}</span>
            {"\n"}
            <span className="text-code-text"> url := </span>
            <span className="text-emerald-600 dark:text-emerald-400">"{url}"</span>
            {"\n"}
            {goBody}
            <span className="text-code-text">req, err := http.NewRequest(</span>
            <span className="text-emerald-600 dark:text-emerald-400">"{method}"</span>
            <span className="text-code-text">, url, </span>
            {goBody ? (
              <span className="text-code-text">body</span>
            ) : (
              <span className="text-blue-600 dark:text-blue-400">nil</span>
            )}
            <span className="text-code-text">)</span>
            {"\n"}
            <span className="text-code-text"> </span>
            <span className="text-blue-600 dark:text-blue-400">if</span>
            <span className="text-code-text"> err != </span>
            <span className="text-blue-600 dark:text-blue-400">nil</span>
            <span className="text-code-text"> {"{"}</span>
            {"\n"}
            <span className="text-code-text"> fmt.Println(err)</span>
            {"\n"}
            <span className="text-code-text"> </span>
            <span className="text-blue-600 dark:text-blue-400">return</span>
            {"\n"}
            <span className="text-code-text"> {"}"}</span>
            {"\n\n"}
            {goHeaders && (
              <>
                <span className="text-code-text"> req.Header.Set(</span>
                <span className="text-emerald-600 dark:text-emerald-400">"Content-Type"</span>
                <span className="text-code-text">, </span>
                <span className="text-emerald-600 dark:text-emerald-400">"application/json"</span>
                <span className="text-code-text">)</span>
                {"\n\n"}
              </>
            )}
            <span className="text-code-text"> client := &http.Client{"{}"}</span>
            {"\n"}
            <span className="text-code-text"> resp, err := client.Do(req)</span>
            {"\n"}
            <span className="text-code-text"> </span>
            <span className="text-blue-600 dark:text-blue-400">if</span>
            <span className="text-code-text"> err != </span>
            <span className="text-blue-600 dark:text-blue-400">nil</span>
            <span className="text-code-text"> {"{"}</span>
            {"\n"}
            <span className="text-code-text"> fmt.Println(err)</span>
            {"\n"}
            <span className="text-code-text"> </span>
            <span className="text-blue-600 dark:text-blue-400">return</span>
            {"\n"}
            <span className="text-code-text"> {"}"}</span>
            {"\n"}
            <span className="text-code-text"> </span>
            <span className="text-blue-600 dark:text-blue-400">defer</span>
            <span className="text-code-text"> resp.Body.Close()</span>
            {"\n\n"}
            <span className="text-code-text"> body, err := io.ReadAll(resp.Body)</span>
            {"\n"}
            <span className="text-code-text"> </span>
            <span className="text-blue-600 dark:text-blue-400">if</span>
            <span className="text-code-text"> err != </span>
            <span className="text-blue-600 dark:text-blue-400">nil</span>
            <span className="text-code-text"> {"{"}</span>
            {"\n"}
            <span className="text-code-text"> fmt.Println(err)</span>
            {"\n"}
            <span className="text-code-text"> </span>
            <span className="text-blue-600 dark:text-blue-400">return</span>
            {"\n"}
            <span className="text-code-text"> {"}"}</span>
            {"\n"}
            <span className="text-code-text"> fmt.Println(string(body))</span>
            {"\n"}
            <span className="text-code-text">{"}"}</span>
          </>
        );
      }

      default:
        return <span className="text-code-text">Code generation not available for {language}</span>;
    }
  };

  const handleCopy = async () => {
    try {
      const snippet = generateCodeSnippet(selectedLang);
      const text =
        typeof snippet === "string"
          ? snippet
          : (document.querySelector("[data-code-snippet]")?.textContent ?? "");
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden animate-fade-in">
      <div className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1">
          <ToggleGroup
            type="single"
            value={selectedLang}
            onValueChange={(value) => value && setSelectedLang(value)}
          >
            {languages.map((lang) => (
              <ToggleGroupItem key={lang.id} value={lang.id} className="text-xs">
                {lang.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "h-7 gap-1.5 text-xs font-medium transition-all duration-200",
            copied && "border-success/30 text-success bg-success/10",
          )}
          onClick={handleCopy}
        >
          {copied ? (
            <>
              <Check />
              Copied!
            </>
          ) : (
            <>
              <Copy />
              Copy
            </>
          )}
        </Button>
      </div>

      <div
        className="min-h-0 flex-1 overflow-auto code-scrollbar rounded-xl border border-border/50 bg-code-bg shadow-inner"
        data-code-snippet
      >
        <div className="flex items-center justify-between bg-code-header-bg px-4 py-2 border-b border-border/30">
          <div className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full bg-destructive/70" />
            <span className="size-2.5 rounded-full bg-warning/70" />
            <span className="size-2.5 rounded-full bg-success/70" />
          </div>
          <span className="text-[10px] font-mono text-muted-foreground/40">{selectedLang}</span>
        </div>
        <pre className="p-4 text-sm leading-relaxed font-mono overflow-auto">
          <code>{generateCodeSnippet(selectedLang)}</code>
        </pre>
      </div>
    </div>
  );
}
