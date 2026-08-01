export type ResponseFormat =
  | "pretty"
  | "raw"
  | "preview"
  | "visualize"
  | "json"
  | "tree"
  | "xml"
  | "html"
  | "image"
  | "pdf"
  | "binary"
  | "audio"
  | "video";

export function getContentType(responseHeaders?: Record<string, string>): string {
  if (!responseHeaders) return "text/plain";
  const contentType =
    responseHeaders["content-type"] || responseHeaders["Content-Type"] || "text/plain";
  return contentType.split(";")[0].toLowerCase();
}

export function isJson(responseBody?: string, responseHeaders?: Record<string, string>): boolean {
  if (!responseBody) return false;
  const contentType = getContentType(responseHeaders);
  if (contentType.includes("json")) return true;
  try {
    JSON.parse(responseBody);
    return true;
  } catch {
    return false;
  }
}

export function isXml(responseBody?: string, responseHeaders?: Record<string, string>): boolean {
  const contentType = getContentType(responseHeaders);
  return (
    contentType.includes("xml") ||
    (!!responseBody && responseBody.trim().startsWith("<") && responseBody.trim().endsWith(">"))
  );
}

export function isHtml(responseBody?: string, responseHeaders?: Record<string, string>): boolean {
  const contentType = getContentType(responseHeaders);
  return (
    contentType === "text/html" ||
    contentType === "application/xhtml+xml" ||
    (!!responseBody &&
      responseBody.toLowerCase().includes("<html") &&
      responseBody.toLowerCase().includes("</html>"))
  );
}

export function isBinary(
  responseData?: string | Blob,
  responseHeaders?: Record<string, string>,
): boolean {
  const type = getContentType(responseHeaders);
  return (
    type.includes("image/") ||
    type.includes("audio/") ||
    type.includes("video/") ||
    type.includes("application/octet-stream") ||
    type.includes("application/pdf") ||
    type.includes("application/zip") ||
    type.includes("multipart/") ||
    type.includes("font/") ||
    type.includes("model/") ||
    responseData instanceof Blob
  );
}

export function isImage(
  responseData?: string | Blob,
  responseHeaders?: Record<string, string>,
): boolean {
  const contentType = getContentType(responseHeaders);
  return (
    contentType.startsWith("image/") ||
    (responseData instanceof Blob && responseData.type.startsWith("image/"))
  );
}

export function isPdf(
  responseData?: string | Blob,
  responseHeaders?: Record<string, string>,
): boolean {
  const contentType = getContentType(responseHeaders);
  return (
    contentType === "application/pdf" ||
    (responseData instanceof Blob && responseData.type === "application/pdf")
  );
}

export function isAudio(
  responseData?: string | Blob,
  responseHeaders?: Record<string, string>,
): boolean {
  const contentType = getContentType(responseHeaders);
  return (
    contentType.includes("audio/") ||
    (responseData instanceof Blob && responseData.type.startsWith("audio/"))
  );
}

export function isVideo(
  responseData?: string | Blob,
  responseHeaders?: Record<string, string>,
): boolean {
  const contentType = getContentType(responseHeaders);
  return (
    contentType.includes("video/") ||
    (responseData instanceof Blob && responseData.type.startsWith("video/"))
  );
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;")
    .replace(/`/g, "&#x60;");
}

export function highlightJson(jsonText: string): string {
  return jsonText.replace(
    /"([^"\\]|\\.)*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g,
    (match) => {
      let cls: string;
      if (/^"/.test(match)) {
        cls = /:\s*$/.test(match) ? "text-sky-300" : "text-amber-300";
      } else if (/true|false/.test(match)) {
        cls = "text-violet-300";
      } else if (/null/.test(match)) {
        cls = "text-orange-300";
      } else {
        cls = "text-rose-300";
      }
      return `<span class="${cls}">${escapeHtml(match)}</span>`;
    },
  );
}

export function highlightMarkup(text: string): string {
  // Prevent pre-escaping from corrupting existing HTML entities (double-escape)
  const entities: string[] = [];
  const textWithoutEntities = text.replace(
    /&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);/g,
    (match) => {
      if (/^&(#[xX]?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);$/.test(match)) {
        entities.push(match);
        return `__ENT_${entities.length - 1}__`;
      }
      return match;
    },
  );

  const escaped = escapeHtml(textWithoutEntities);
  const withEntities = entities.reduce(
    (acc, entity, i) => acc.replace(`__ENT_${i}__`, entity),
    escaped,
  );

  return withEntities
    .replace(/(&lt;!--[\s\S]*?--&gt;)/g, '<span class="text-emerald-300">$1</span>')
    .replace(/(&lt;\/?[a-zA-Z0-9\-:]+)([^&]*?)(&gt;)/g, (_, tagStart, attrs, tagEnd) => {
      const highlightedAttrs = attrs.replace(
        /([a-zA-Z0-9\-:]+)(=)("[^"]*")/g,
        '<span class="text-sky-300">$1</span>$2<span class="text-amber-300">$3</span>',
      );
      return `<span class="text-sky-300">${tagStart}</span>${highlightedAttrs}<span class="text-sky-300">${tagEnd}</span>`;
    });
}

export function extractVideoUrls(value: unknown): string[] {
  const results = new Set<string>();
  const isVideoUrl = (text: string) =>
    /^(https?:)?\/\/.*\.(mp4|webm|ogg|mov|m3u8|flv|avi)(\?.*)?$/i.test(text);

  const collect = (input: unknown) => {
    if (typeof input === "string") {
      if (isVideoUrl(input)) results.add(input);
      return;
    }
    if (Array.isArray(input)) {
      input.forEach(collect);
      return;
    }
    if (input && typeof input === "object") {
      Object.values(input).forEach(collect);
    }
  };

  collect(value);
  return Array.from(results);
}

export function extractImageUrls(value: unknown): string[] {
  const results = new Set<string>();
  const preferredSrcKeys = [
    "medium",
    "large",
    "large2x",
    "original",
    "portrait",
    "landscape",
    "small",
    "tiny",
  ];
  const isImageUrl = (text: string) =>
    /^(https?:)?\/\/.*\.(jpeg|jpg|png|gif|webp|svg|avif)(\?.*)?$/i.test(text);

  const collect = (input: unknown) => {
    if (typeof input === "string") {
      if (isImageUrl(input)) results.add(input);
      return;
    }
    if (Array.isArray(input)) {
      input.forEach(collect);
      return;
    }
    if (input && typeof input === "object") {
      const record = input as Record<string, unknown>;
      const src = record.src;
      if (src && typeof src === "object" && !Array.isArray(src)) {
        for (const key of preferredSrcKeys) {
          const candidate = (src as Record<string, unknown>)[key];
          if (typeof candidate === "string" && isImageUrl(candidate)) {
            results.add(candidate);
            break;
          }
        }
      }
      Object.entries(record).forEach(([key, child]) => {
        if (key === "src") return;
        collect(child);
      });
    }
  };

  collect(value);
  return Array.from(results);
}
