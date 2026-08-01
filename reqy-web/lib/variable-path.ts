/**
 * Core variable-path utilities re‑exported from @reqly/shared.
 * Web‑specific extractors (XML, regex, content‑type detection) stay here
 * since they depend on browser APIs (DOMParser, Blob).
 */
import {
  getValueByPath,
  isSourcePathSyntaxValid,
  type PathExtractionResult,
} from "@reqly/shared/variable-path";

export { getValueByPath, isSourcePathSyntaxValid, type PathExtractionResult };

export function looksLikeXml(text: string): boolean {
  const trimmed = text.trimStart();
  return trimmed.startsWith("<?xml") || trimmed.startsWith("<");
}

export function parseResponseForExtraction(responseBody: string): {
  parsed: unknown;
  isJson: boolean;
  isXml: boolean;
} {
  const trimmed = responseBody.trim();
  if (!trimmed) {
    return { parsed: "", isJson: false, isXml: false };
  }

  if (looksLikeXml(trimmed)) {
    return { parsed: responseBody, isJson: false, isXml: true };
  }

  try {
    return { parsed: JSON.parse(responseBody), isJson: true, isXml: false };
  } catch {
    return { parsed: responseBody, isJson: false, isXml: false };
  }
}

export function extractValueFromResponse(
  responseBody: string | Blob,
  sourcePath: string,
): { value: string; error?: string } {
  if (responseBody instanceof Blob) {
    return { value: "", error: "Response body is binary (Blob), extraction not possible." };
  }

  if (!sourcePath.trim()) {
    return { value: responseBody };
  }

  if (!isSourcePathSyntaxValid(sourcePath)) {
    return { value: "", error: "Invalid JSON path format." };
  }

  const { parsed, isJson, isXml } = parseResponseForExtraction(responseBody);

  if (isXml) {
    return {
      value: "",
      error: "XML response: JSON paths do not apply. Use a JSON response or leave the path empty.",
    };
  }

  if (!isJson && sourcePath.trim()) {
    return {
      value: "",
      error:
        "Non-JSON response: leave the path empty to use the raw body, or run a request that returns JSON.",
    };
  }

  const extraction = getValueByPath(parsed, sourcePath);
  if (!extraction.success) {
    return { value: "", error: extraction.error };
  }

  return { value: formatVariableValue(extraction.value) };
}

export function formatVariableValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

// ---------------------------------------------------------------------------
// Content-type-aware pipeline (added by pipeline agent)
// ---------------------------------------------------------------------------

export type ContentType = "json" | "xml" | "text" | "binary" | "unknown";

export function detectContentType(body: string | Blob | null | undefined): ContentType {
  if (body === null || body === undefined) return "unknown";
  if (body instanceof Blob) return "binary";
  if (typeof body !== "string") return "unknown";
  if (body.trim() === "") return "unknown";

  const trimmed = body.trim();
  if (looksLikeXml(trimmed)) return "xml";

  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object") return "json";
    return "text";
  } catch {
    return "text";
  }
}

// Valid JSON path examples: $.user.name, $.items[0].id, $.data['key with spaces']
// Invalid: .., .foo, [], $[, $.foo.
const JSON_PATH_VALID = /^\$(?:\.[A-Za-z_][\w]*|\[\d+\]|\[['"][^'"]+['"]\])+$/;
const JSON_PATH_ROOT_ONLY = /^\$$/;

export function isValidJsonPath(path: string): boolean {
  if (typeof path !== "string") return false;
  const trimmed = path.trim();
  if (trimmed === "") return false;
  if (trimmed === "$") return true;
  if (!trimmed.startsWith("$")) return false;
  // Reject double dots anywhere
  if (trimmed.includes("..")) return false;
  // Reject empty brackets
  if (trimmed.includes("[]")) return false;
  // Reject trailing dot
  if (trimmed.endsWith(".")) return false;
  // Reject leading dot right after $
  if (trimmed.startsWith("$.")) {
    const after = trimmed.slice(2);
    if (after.startsWith(".")) return false;
  }
  // Reject $[ without closing
  if (trimmed.includes("$[")) {
    // Quick sanity check
    if (!/\[[\w'"\d]+\]/.test(trimmed)) return false;
  }
  return JSON_PATH_VALID.test(trimmed) || JSON_PATH_ROOT_ONLY.test(trimmed);
}

export function extractWithRegex(body: string, regex: RegExp): { value: string; error?: string } {
  if (typeof body !== "string") {
    return { value: "", error: "Regex extraction requires a string body." };
  }
  const match = body.match(regex);
  if (!match) {
    return { value: "", error: "Regex did not match response body." };
  }
  // Use capture group 1 if present, otherwise the full match
  const captured = match[1] !== undefined ? match[1] : match[0];
  return { value: captured };
}

type XmlNodeLike = {
  querySelector(selector: string): XmlNodeLike | null;
  textContent: string | null;
};
type DOMParserCtor = new () => {
  parseFromString(input: string, mime: string): XmlNodeLike;
};

function getDOMParser(): DOMParserCtor | null {
  if (typeof globalThis === "undefined") return null;
  const candidate = (globalThis as unknown as { DOMParser?: DOMParserCtor }).DOMParser;
  return typeof candidate === "function" ? candidate : null;
}

export function extractValueFromXml(body: string, path: string): { value: string; error?: string } {
  if (typeof body !== "string" || body.trim() === "") {
    return { value: "", error: "Empty XML body." };
  }
  if (!path || !path.trim()) {
    return { value: body };
  }

  const DomParser = getDOMParser();
  const segments = path
    .split(".")
    .map((s) => s.trim())
    .filter(Boolean);

  if (DomParser) {
    try {
      const doc = new DomParser().parseFromString(body, "text/xml");
      let cursor: XmlNodeLike | null = doc;
      for (const seg of segments) {
        if (!cursor) {
          return { value: "", error: `Path not found: ${path}` };
        }
        const cleanSeg = seg.replace(/^\$/, "");
        cursor = cursor.querySelector(cleanSeg);
      }
      if (!cursor) {
        return { value: "", error: `Path not found: ${path}` };
      }
      return { value: cursor.textContent ?? "" };
    } catch (err) {
      return {
        value: "",
        error: `XML extraction error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  // Node fallback: regex-based extraction. Supports `root.child` style paths.
  let cursor = body;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i].replace(/^\$/, "");
    // Match `<seg ...>...</seg>` or `<seg .../>`
    const pattern = new RegExp(`<${seg}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${seg}>`, "i");
    const m = cursor.match(pattern);
    if (!m) {
      return { value: "", error: `Path not found: ${path}` };
    }
    cursor = m[1];
  }
  return { value: cursor.trim() };
}

export function extractValueFromResponsePipeline(
  responseBody: string | Blob | null | undefined,
  sourcePath: string,
  options?: { regex?: RegExp },
): { value: string; error?: string } {
  if (responseBody === null || responseBody === undefined) {
    return { value: "", error: "No response body available." };
  }
  if (responseBody instanceof Blob) {
    return {
      value: "",
      error: "Response is binary (Blob); pipeline extraction requires text/JSON/XML.",
    };
  }

  const contentType = detectContentType(responseBody);

  if (!sourcePath || !sourcePath.trim()) {
    // Text content + regex option: apply regex even when path is empty
    if (contentType === "text" && options?.regex) {
      return extractWithRegex(responseBody as string, options.regex);
    }
    return { value: responseBody as string };
  }

  if (contentType === "json") {
    if (!isValidJsonPath(sourcePath)) {
      return { value: "", error: "Invalid JSON path." };
    }
    try {
      const parsed = JSON.parse(responseBody as string);
      // Convert $.foo.bar to foo.bar for getValueByPath
      const normalized = sourcePath
        .replace(/^\$\.?/, "")
        .replace(/\[(\d+)\]/g, ".$1")
        .replace(/\['([^']+)'\]/g, ".$1")
        .replace(/\["([^"]+)"\]/g, ".$1");
      const extraction = getValueByPath(parsed, normalized || "");
      if (!extraction.success) {
        return { value: "", error: extraction.error ?? "Path not found." };
      }
      return { value: formatVariableValue(extraction.value) };
    } catch (err) {
      return {
        value: "",
        error: `JSON parse error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  if (contentType === "xml") {
    return extractValueFromXml(responseBody as string, sourcePath);
  }

  if (contentType === "text") {
    if (options?.regex) {
      return extractWithRegex(responseBody as string, options.regex);
    }
    return {
      value: "",
      error: "Text response: provide a regex via options.regex or leave path empty for raw body.",
    };
  }

  return { value: "", error: "Unknown content type." };
}
