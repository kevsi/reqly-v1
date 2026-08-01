"use client";

import React from "react";
import {
  Eye,
  Code,
  FileImage,
  FileText,
  Music,
  Video,
  BarChart3,
  Check,
  Copy,
  ListTree,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import DOMPurify from "dompurify";
import {
  type ResponseFormat,
  getContentType,
  isJson,
  isXml,
  isHtml,
  isImage,
  isPdf,
  isAudio,
  isVideo,
  isBinary,
  highlightJson,
  extractVideoUrls,
  extractImageUrls,
} from "./response-utils";
import { JsonTreeViewer } from "./json-tree-viewer";

const formatOptions: Array<{
  value: ResponseFormat;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { value: "pretty", label: "Pretty", icon: Eye },
  { value: "raw", label: "Raw", icon: Code },
  { value: "preview", label: "Preview", icon: Eye },
  { value: "visualize", label: "Visualize", icon: BarChart3 },
  { value: "json", label: "JSON", icon: Code },
  { value: "tree", label: "Tree", icon: ListTree },
  { value: "xml", label: "XML", icon: Code },
  { value: "html", label: "HTML", icon: Code },
  { value: "image", label: "Image", icon: FileImage },
  { value: "pdf", label: "PDF", icon: FileText },
  { value: "binary", label: "Binary", icon: FileImage },
  { value: "audio", label: "Audio", icon: Music },
  { value: "video", label: "Video", icon: Video },
];

interface ResponseContentRendererProps {
  responseBody?: string;
  responseData?: string | Blob;
  responseHeaders?: Record<string, string>;
  responseFormat: ResponseFormat;
  onFormatChange: (format: ResponseFormat) => void;
  mediaUrl: string | null;
}

export function ResponseContentRenderer({
  responseBody,
  responseData,
  responseHeaders,
  responseFormat,
  onFormatChange,
  mediaUrl,
}: ResponseContentRendererProps) {
  const safeBody = responseBody ?? "";
  const [copied, setCopied] = React.useState(false);

  if (!safeBody && !responseData) return null;

  const renderRaw = () => (
    <div className="bg-code-bg h-full overflow-auto code-scrollbar">
      <pre className="p-4 text-sm leading-relaxed text-code-text whitespace-pre-wrap break-words font-mono">
        <code>{safeBody}</code>
      </pre>
    </div>
  );

  /** Shared plain code block — no syntax highlighting. */
  const codeBlock = (content: string, textColor = "text-code-text") => (
    <div className="bg-code-bg h-full overflow-auto code-scrollbar">
      <pre
        className={
          "p-4 text-sm leading-relaxed whitespace-pre-wrap break-words font-mono " + textColor
        }
      >
        <code>{content}</code>
      </pre>
    </div>
  );

  /** Shared highlighted code block — for JSON with syntax colours. Same base style as codeBlock. */
  const codeBlockHighlighted = (html: string) => (
    <div className="bg-code-bg h-full overflow-auto code-scrollbar">
      <pre
        className="p-4 text-sm leading-relaxed whitespace-pre-wrap break-words font-mono text-code-text"
        dangerouslySetInnerHTML={{
          __html: DOMPurify.sanitize(html, {
            ALLOWED_TAGS: ["span"],
            ALLOWED_ATTR: ["class"],
          }),
        }}
      />
    </div>
  );

  const renderJson = () => {
    if (isJson(safeBody, responseHeaders)) {
      try {
        const parsed = JSON.parse(safeBody);
        const formatted = JSON.stringify(parsed, null, 2);
        return codeBlockHighlighted(highlightJson(formatted));
      } catch {
        return codeBlock("Error parsing JSON", "text-destructive");
      }
    }
    return codeBlock(safeBody);
  };

  const renderJsonTree = () => {
    if (isJson(safeBody, responseHeaders)) {
      try {
        const parsed = JSON.parse(safeBody);
        return <JsonTreeViewer data={parsed} />;
      } catch {
        return codeBlock("Error parsing JSON", "text-destructive");
      }
    }
    return codeBlock(safeBody);
  };

  const renderXml = () => codeBlock(safeBody);

  const renderHtml = () => codeBlock(safeBody);

  const renderPreview = () => {
    if (isHtml(safeBody, responseHeaders)) {
      return (
        <iframe
          srcDoc={DOMPurify.sanitize(safeBody)}
          sandbox=""
          className="w-full h-full border-0 bg-background"
          title="HTML Preview"
        />
      );
    }
    if (
      isImage(responseData, responseHeaders) ||
      isPdf(responseData, responseHeaders) ||
      isAudio(responseData, responseHeaders) ||
      isVideo(responseData, responseHeaders)
    ) {
      if (responseData instanceof Blob && mediaUrl) {
        if (isImage(responseData, responseHeaders)) {
          return (
            <div className="flex h-full items-center justify-center bg-code-bg">
              <img
                src={mediaUrl}
                alt="Response image"
                loading="lazy"
                className="max-h-full max-w-full object-contain"
              />
            </div>
          );
        }
        if (isPdf(responseData, responseHeaders)) {
          return <iframe src={mediaUrl} className="w-full h-full border-0" title="PDF Preview" />;
        }
        if (isAudio(responseData, responseHeaders)) {
          return (
            <div className="flex items-center justify-center h-full bg-code-bg">
              <audio controls className="w-full max-w-lg">
                <source src={mediaUrl} />
              </audio>
            </div>
          );
        }
        if (isVideo(responseData, responseHeaders)) {
          return (
            <div className="flex items-center justify-center h-full bg-code-bg">
              <video controls className="w-full max-w-lg">
                <source src={mediaUrl} />
              </video>
            </div>
          );
        }
      }
    }
    if (isJson(safeBody, responseHeaders)) {
      try {
        const parsed = JSON.parse(safeBody);
        const videoUrls = extractVideoUrls(parsed);
        if (videoUrls.length > 0) {
          return (
            <div className="grid gap-4 p-4 grid-cols-1 sm:grid-cols-2 bg-code-bg min-h-full">
              {videoUrls.map((url: string, index: number) => (
                <div
                  key={`${url}-${index}`}
                  className="overflow-hidden rounded-lg border border-border/50 bg-black/50"
                >
                  <video controls className="h-48 w-full bg-black">
                    <source src={url} type={url.endsWith(".webm") ? "video/webm" : "video/mp4"} />
                  </video>
                </div>
              ))}
            </div>
          );
        }
        const imageUrls = extractImageUrls(parsed);
        if (imageUrls.length > 0) {
          return (
            <div className="grid gap-4 p-4 grid-cols-1 sm:grid-cols-2 bg-code-bg min-h-full">
              {imageUrls.map((url: string, index: number) => (
                <div
                  key={`${url}-${index}`}
                  className="overflow-hidden rounded-lg border border-border/50 bg-black/50"
                >
                  <img
                    src={url}
                    alt={`Preview image ${index + 1}`}
                    loading="lazy"
                    className="h-48 w-full object-cover"
                  />
                </div>
              ))}
            </div>
          );
        }
        const formatted = JSON.stringify(parsed, null, 2);
        return (
          <div className="bg-code-bg h-full overflow-auto code-scrollbar">
            <pre className="p-4 text-sm leading-relaxed text-code-text whitespace-pre-wrap break-words font-mono">
              <code>{formatted}</code>
            </pre>
          </div>
        );
      } catch {
        return (
          <div className="flex items-center justify-center h-full text-muted-foreground bg-code-bg">
            <p>Preview not available for this content type</p>
          </div>
        );
      }
    }
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground bg-code-bg">
        <p>Preview not available for this content type</p>
      </div>
    );
  };

  const renderVisualize = () => {
    if (isJson(safeBody, responseHeaders)) {
      try {
        const data = JSON.parse(safeBody);
        if (Array.isArray(data)) {
          return (
            <div className="rounded-lg border p-4 h-full overflow-auto hide-scrollbar">
              <div className="mb-4">
                <h3 className="text-lg font-semibold">Array Visualization ({data.length} items)</h3>
              </div>
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b bg-muted/50">
                    {Object.keys(data[0] || {}).map((key) => (
                      <th key={key} className="text-left p-3 font-medium border-r last:border-r-0">
                        {key}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.slice(0, 20).map((item, index) => (
                    <tr key={index} className="border-b hover:bg-muted/30">
                      {Object.values(item as Record<string, unknown>).map((value: unknown, i) => (
                        <td
                          key={i}
                          className="p-3 border-r last:border-r-0 max-w-xs truncate"
                          title={String(value)}
                        >
                          {typeof value === "object" ? JSON.stringify(value) : String(value)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {data.length > 20 && (
                <p className="text-xs text-muted-foreground mt-4 text-center">
                  Showing first 20 rows of {data.length} total
                </p>
              )}
            </div>
          );
        }
        return (
          <div className="rounded-lg border p-4 h-full overflow-auto hide-scrollbar">
            <div className="mb-4">
              <h3 className="text-lg font-semibold">Object Visualization</h3>
            </div>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {Object.entries(data).map(([key, value]) => (
                <div key={key} className="border rounded-lg p-4 bg-card">
                  <div className="font-medium text-sm text-muted-foreground mb-2">{key}</div>
                  <div className="text-sm break-words">
                    {typeof value === "object" ? (
                      <pre className="text-xs bg-muted p-2 rounded overflow-auto hide-scrollbar max-h-32">
                        {JSON.stringify(value, null, 2)}
                      </pre>
                    ) : (
                      String(value)
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      } catch {
        return (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <p>Cannot visualize this data</p>
          </div>
        );
      }
    }
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <p>Visualization not available for this content type</p>
      </div>
    );
  };

  const renderImage = () => {
    if (responseData instanceof Blob && mediaUrl) {
      return (
        <div className="flex h-full items-center justify-center">
          <img
            src={mediaUrl}
            alt="Response image"
            loading="lazy"
            className="max-h-full max-w-full object-contain"
          />
        </div>
      );
    }
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <FileImage className="size-12 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">No image available</p>
      </div>
    );
  };

  const renderPdf = () => {
    if (responseData instanceof Blob && mediaUrl) {
      return (
        <div className="flex h-full flex-col">
          <iframe src={mediaUrl} className="h-full w-full border-0" title="PDF Preview" />
        </div>
      );
    }
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <FileText className="size-12 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">No PDF available</p>
      </div>
    );
  };

  const renderBinary = () => {
    if (responseData instanceof Blob && mediaUrl) {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-4">
          <FileImage className="size-12 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Binary content ({responseData.size} bytes)
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const a = document.createElement("a");
              a.href = mediaUrl;
              a.download = "response";
              a.click();
            }}
          >
            Download
          </Button>
        </div>
      );
    }
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <FileImage className="size-12 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Binary content</p>
        <Button variant="outline" size="sm" disabled>
          Download
        </Button>
      </div>
    );
  };

  const renderAudioVideo = () => {
    if (responseData instanceof Blob && mediaUrl) {
      if (isAudio(responseData, responseHeaders)) {
        return (
          <div className="flex items-center justify-center h-full">
            <audio controls className="w-full max-w-md">
              <source src={mediaUrl} />
            </audio>
          </div>
        );
      }
      if (isVideo(responseData, responseHeaders)) {
        return (
          <div className="flex items-center justify-center h-full">
            <video controls className="w-full max-w-md">
              <source src={mediaUrl} />
            </video>
          </div>
        );
      }
    }
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <p>Media playback not available</p>
      </div>
    );
  };

  const renderContent = () => {
    switch (responseFormat) {
      case "raw":
        return renderRaw();
      case "pretty":
      case "tree":
        return renderJsonTree();
      case "json":
        return renderJson();
      case "xml":
        return renderXml();
      case "html":
        return renderHtml();
      case "preview":
        return renderPreview();
      case "visualize":
        return renderVisualize();
      case "image":
        return renderImage();
      case "pdf":
        return renderPdf();
      case "binary":
        return renderBinary();
      case "audio":
      case "video":
        return renderAudioVideo();
      default:
        return renderRaw();
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(safeBody);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 flex items-center justify-between gap-3 border-b border-border/50 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground/50">
            View
          </span>
          <Select
            value={responseFormat}
            onValueChange={(value: ResponseFormat) => onFormatChange(value)}
          >
            <SelectTrigger className="h-8 w-36 border-input bg-muted/20 text-xs font-medium transition-all duration-200 hover:border-muted-foreground/30">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {formatOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  <div className="flex items-center gap-2">
                    <option.icon className="size-3.5" />
                    <span>{option.label}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "h-8 gap-1.5 text-xs font-medium transition-all duration-200",
            copied && "border-success/30 text-success bg-success/10",
          )}
          onClick={handleCopy}
        >
          {copied ? (
            <>
              <Check className="size-3.5" />
              Copied!
            </>
          ) : (
            <>
              <Copy className="size-3.5" />
              Copy
            </>
          )}
        </Button>
      </div>
      <div className="flex-1 overflow-auto code-scrollbar">{renderContent()}</div>
    </div>
  );
}
