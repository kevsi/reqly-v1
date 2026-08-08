/**
 * Handler body analysis, auth detection helpers, and general utilities.
 */

import type { DetectedRoute } from "@/lib/detect-shared-types";

// ── Body field extraction ──────────────────────────────────────────────────

function extractBodyFields(body: string): string[] {
  const fields = new Set<string>();

  const destructureRe = /(?:const|let|var)\s*\{\s*([^}]+)\s*\}\s*=\s*(?:req(?:uest)?)\.body/g;
  let m: RegExpExecArray | null;
  while ((m = destructureRe.exec(body)) !== null) {
    for (const raw of m[1].split(",")) {
      const name = raw
        .split(":")
        .map((s) => s.trim())[0]
        .split(/\s+as\s+/)[0]
        .trim();
      if (name && /^[a-zA-Z_$][\w]*$/.test(name)) fields.add(name);
    }
  }

  const dotAccessRe = /(?:const|let|var)\s+(\w+)\s*=\s*(?:req(?:uest)?)\.body\.(\w+)/g;
  while ((m = dotAccessRe.exec(body)) !== null) {
    fields.add(m[2]);
  }

  const usageRe = /(?:req(?:uest)?)\.body\.(\w+)/g;
  while ((m = usageRe.exec(body)) !== null) {
    fields.add(m[1]);
  }

  return [...fields];
}

// ── Nesting-aware bracket matching ─────────────────────────────────────────

function findMatchingClose(
  text: string,
  openIdx: number,
  openChar: string,
  closeChar: string,
): number {
  let depth = 1;
  let i = openIdx + 1;
  while (i < text.length && depth > 0) {
    if (text[i] === openChar) depth++;
    else if (text[i] === closeChar) depth--;
    i++;
  }
  return depth === 0 ? i - 1 : -1;
}

// ── Object literal parsing ─────────────────────────────────────────────────

function splitTopLevelCommas(content: string): string[] {
  const parts: string[] = [];
  let depth = 0,
    parenDepth = 0,
    start = 0;
  for (let i = 0; i < content.length; i++) {
    if (content[i] === "{" || content[i] === "[") depth++;
    else if (content[i] === "}" || content[i] === "]") depth--;
    else if (content[i] === "(") parenDepth++;
    else if (content[i] === ")") parenDepth--;
    else if (content[i] === "," && depth === 0 && parenDepth === 0) {
      parts.push(content.slice(start, i));
      start = i + 1;
    }
  }
  const last = content.slice(start).trim();
  if (last) parts.push(last);
  return parts;
}

function parseZodProperties(objContent: string): {
  fields: Record<string, string>;
  required: string[];
} {
  const fields: Record<string, string> = {};
  const required: string[] = [];
  for (const prop of splitTopLevelCommas(objContent)) {
    const pm = prop.match(/^\s*(\w+)\s*:\s*(z\.\S[\s\S]*?)(?:\/\/.*)?$/);
    if (!pm) continue;
    const key = pm[1];
    const value = pm[2].trim();

    let type = "string";
    if (/^z\.number\b/.test(value)) type = "number";
    else if (/^z\.boolean\b/.test(value)) type = "boolean";
    else if (/^z\.array\b/.test(value)) type = "array";
    else if (/^z\.object\b/.test(value)) type = "object";
    else if (/^z\.bigint\b/.test(value)) type = "number";

    const isOptional = /\.(?:optional|nullable|default)\s*\(/.test(value);
    fields[key] = type;
    if (!isOptional) required.push(key);
  }
  return { fields, required };
}

function parseJoiProperties(objContent: string): {
  fields: Record<string, string>;
  required: string[];
} {
  const fields: Record<string, string> = {};
  const required: string[] = [];
  for (const prop of splitTopLevelCommas(objContent)) {
    const pm = prop.match(/^\s*(\w+)\s*:\s*(Joi\.\S[\s\S]*?)(?:\/\/.*)?$/i);
    if (!pm) continue;
    const key = pm[1];
    const value = pm[2].trim();

    let type = "string";
    if (/Joi\.number\b/.test(value)) type = "number";
    else if (/Joi\.boolean\b/.test(value)) type = "boolean";
    else if (/Joi\.array\b/.test(value)) type = "array";
    else if (/Joi\.object\b/.test(value)) type = "object";
    else if (/Joi\.binary\b/.test(value)) type = "binary";
    else if (/Joi\.date\b/.test(value)) type = "date";

    const isOptional = !/\brequired\s*\(/.test(value);
    fields[key] = type;
    if (!isOptional) required.push(key);
  }
  return { fields, required };
}

function extractObjectBody(text: string, fromIdx: number): string | null {
  const brace = text.indexOf("{", fromIdx);
  if (brace === -1) return null;
  const close = findMatchingClose(text, brace, "{", "}");
  if (close === -1) return null;
  return text.slice(brace + 1, close);
}

// ── Validation schema detection ────────────────────────────────────────────

function tryDetectZod(
  searchSpace: string,
  handlerBody: string,
): { fields: Record<string, string>; required: string[] } | null {
  const declRe = /(?:const|let|var)\s+(\w+)\s*=\s*z\.object\s*\(/g;
  const candidates: Array<{ name: string; fields: Record<string, string>; required: string[] }> =
    [];
  let m: RegExpExecArray | null;
  while ((m = declRe.exec(searchSpace)) !== null) {
    const name = m[1];
    const objBody = extractObjectBody(searchSpace, m.index + m[0].length);
    if (!objBody) continue;
    const parsed = parseZodProperties(objBody);
    if (Object.keys(parsed.fields).length > 0) candidates.push({ name, ...parsed });
  }
  for (const c of candidates) {
    if (new RegExp(`\\b${c.name}\\b`).test(handlerBody))
      return { fields: c.fields, required: c.required };
  }
  const inlineRe = /z\.object\s*\(/g;
  while ((m = inlineRe.exec(handlerBody)) !== null) {
    const objBody = extractObjectBody(handlerBody, m.index + m[0].length);
    if (!objBody) continue;
    const parsed = parseZodProperties(objBody);
    if (Object.keys(parsed.fields).length > 0)
      return { fields: parsed.fields, required: parsed.required };
  }
  return null;
}

function tryDetectJoi(
  searchSpace: string,
  handlerBody: string,
): { fields: Record<string, string>; required: string[] } | null {
  const declRe = /(?:const|let|var)\s+(\w+)\s*=\s*Joi\.object\s*\(/gi;
  const candidates: Array<{ name: string; fields: Record<string, string>; required: string[] }> =
    [];
  let m: RegExpExecArray | null;
  while ((m = declRe.exec(searchSpace)) !== null) {
    const name = m[1];
    const objBody = extractObjectBody(searchSpace, m.index + m[0].length);
    if (!objBody) continue;
    const parsed = parseJoiProperties(objBody);
    if (Object.keys(parsed.fields).length > 0) candidates.push({ name, ...parsed });
  }
  for (const c of candidates) {
    if (new RegExp(`\\b${c.name}\\b`).test(handlerBody))
      return { fields: c.fields, required: c.required };
  }
  const inlineRe = /Joi\.object\s*\(/gi;
  while ((m = inlineRe.exec(handlerBody)) !== null) {
    const objBody = extractObjectBody(handlerBody, m.index + m[0].length);
    if (!objBody) continue;
    const parsed = parseJoiProperties(objBody);
    if (Object.keys(parsed.fields).length > 0)
      return { fields: parsed.fields, required: parsed.required };
  }
  return null;
}

function tryDetectExpressValidator(
  searchSpace: string,
): { fields: Record<string, string>; required: string[] } | null {
  const fields: Record<string, string> = {};
  const required: string[] = [];
  const bodyRe = /body\s*\(\s*['"]([^'"]+)['"]\s*\)([^,;\]]+)/g;
  let m: RegExpExecArray | null;
  let found = false;
  while ((m = bodyRe.exec(searchSpace)) !== null) {
    found = true;
    const key = m[1];
    const chain = m[2];
    let type = "string";
    if (/\.(?:isInt|isFloat)\s*\(/.test(chain)) type = "number";
    else if (/\.isBoolean\s*\(/.test(chain)) type = "boolean";
    else if (/\.isArray\s*\(/.test(chain)) type = "array";
    fields[key] = type;
    if (!/\.optional\s*\(/.test(chain)) required.push(key);
  }
  return found ? { fields, required } : null;
}

function tryDetectClassValidator(
  searchSpace: string,
  handlerBody: string,
): { fields: Record<string, string>; required: string[] } | null {
  const bodyParamRe = /@Body\s*\([^)]*\)\s*\w+\s*:\s*(\w+)/g;
  let m: RegExpExecArray | null;
  let dtoClass: string | null = null;
  while ((m = bodyParamRe.exec(handlerBody)) !== null) {
    dtoClass = m[1];
    break;
  }
  if (!dtoClass) return null;

  const classRe = new RegExp(`class\\s+${dtoClass}\\s*\\{([\\s\\S]*?)\\}`, "g");
  const cm = classRe.exec(searchSpace);
  if (!cm) return null;

  const classBody = cm[1];
  const fields: Record<string, string> = {};
  const required: string[] = [];

  const propRe = /((?:@\w+(?:\([^)]*\))?\s*\n?\s*)*)(\w+)\??\s*:\s*(\w+)/g;
  let pm: RegExpExecArray | null;
  while ((pm = propRe.exec(classBody)) !== null) {
    const decorators = pm[1];
    const propName = pm[2];
    const tsType = pm[3];

    let type = "string";
    if (/@(?:IsNumber|IsInt|IsFloat)\b/.test(decorators)) type = "number";
    else if (/@IsBoolean\b/.test(decorators)) type = "boolean";
    else if (/@IsArray\b/.test(decorators)) type = "array";
    else if (/@IsEmail\b/.test(decorators) || /@IsString\b/.test(decorators)) type = "string";
    else if (tsType === "number" || tsType === "Number") type = "number";
    else if (tsType === "boolean" || tsType === "Boolean") type = "boolean";

    const isOptional = /@IsOptional\b/.test(decorators) || /\?\s*:/.test(pm[0]);
    fields[propName] = type;
    if (!isOptional) required.push(propName);
  }

  return Object.keys(fields).length > 0 ? { fields, required } : null;
}

function extractProximateScope(handlerBody: string, fullFileContent: string): string {
  const idx = fullFileContent.indexOf(handlerBody);
  if (idx === -1) return fullFileContent;
  const start = Math.max(0, idx - 2000);
  return fullFileContent.slice(start, idx + handlerBody.length);
}

function detectValidationSchema(
  handlerBody: string,
  fullFileContent?: string,
): { fields: Record<string, string>; required: string[] } | null {
  const searchSpace = fullFileContent || handlerBody;

  const zod = tryDetectZod(searchSpace, handlerBody);
  if (zod) return zod;

  const joi = tryDetectJoi(searchSpace, handlerBody);
  if (joi) return joi;

  const evSearchSpace = fullFileContent
    ? extractProximateScope(handlerBody, fullFileContent)
    : handlerBody;
  const ev = tryDetectExpressValidator(evSearchSpace);
  if (ev) return ev;

  const cv = tryDetectClassValidator(searchSpace, handlerBody);
  if (cv) return cv;

  return null;
}

// ── Main handler analyzer ─────────────────────────────────────────────────

export function analyzeHandlerBody(body: string, r: DetectedRoute, fullFileContent?: string): void {
  if (
    /cookies\(\)\.get\(\s*['"](?:token|auth|session|access_token|github_token)['"]\)|request\.cookies\.get\(\s*['"](?:token|auth|session)['"]\)/.test(
      body,
    )
  ) {
    r.authRequired = true;
    r.authType = r.authType || "cookie";
    r.reasonings?.push("Auth token en cookie");
  }
  if (
    /[Aa]uthorization.*[Bb]earer|headers\[['"]authorization['"]\]|getAuthHeader|extractBearerToken/.test(
      body,
    )
  ) {
    r.authRequired = true;
    r.authType = r.authType || "jwt";
    r.reasonings?.push("Bearer token");
  }
  if (
    /getServerSession|getSession\(authOptions\)|auth\(\)\s*\.\s*then|const\s+session\s*=\s*await\s+(?:getServerSession|auth)/.test(
      body,
    )
  ) {
    r.authRequired = true;
    r.authType = r.authType || "cookie";
    r.reasonings?.push("NextAuth getServerSession");
  }
  if (/auth\(\)|currentUser\(\)|clerkClient\.users/.test(body)) {
    r.authRequired = true;
    r.authType = r.authType || "middleware";
    r.reasonings?.push("Clerk auth() / currentUser()");
  }
  if (/supabase\.auth\.getUser|supabase\.auth\.getSession/.test(body)) {
    r.authRequired = true;
    r.authType = r.authType || "cookie";
    r.reasonings?.push("Supabase auth");
  }
  if (
    /(?:status|statusCode)\s*[:=]\s*(?:401|403)|new\s+Response\([^)]*401|NextResponse\.json\([^)]*401|res\.status\(401\)|res\.status\(403\)/.test(
      body,
    )
  ) {
    if (!r.authRequired) {
      r.authRequired = true;
      r.authType = r.authType || "middleware";
      r.reasonings?.push("401/403 response");
    }
  }
  if (/await\s+req(?:uest)?\.json\(\)|body\s*=\s*await/.test(body)) {
    r.bodyType = "json";
    r.reasonings?.push("JSON body");
  }
  if (/await\s+req(?:uest)?\.formData\(\)/.test(body)) {
    r.bodyType = "form";
    r.reasonings?.push("FormData body");
  }
  if (/req(?:uest)?\.body\b/.test(body) && r.bodyType === "none") {
    r.bodyType = "json";
    r.reasonings?.push("Express body access");
  }

  if (r.bodyType === "json" && !r.body) {
    const schema = detectValidationSchema(body, fullFileContent);
    if (schema) {
      r.bodyFieldTypes = schema.fields;
      r.requiredBodyFields = schema.required;
      r.body = JSON.stringify(schema.fields, null, 2);
      r.reasonings?.push(
        `Schéma de validation détecté (${schema.required.length} champ(s) requis)`,
      );
    } else {
      const fields = extractBodyFields(body);
      if (fields.length > 0) {
        const example: Record<string, string> = {};
        for (const f of fields) example[f] = "string";
        r.body = JSON.stringify(example, null, 2);
        r.reasonings?.push(`Champs body détectés: ${fields.join(", ")}`);
      } else if (/\b(req(?:uest)?)\.body\b/.test(body)) {
        r.body = "{}";
        if (!r.reasonings) r.reasonings = [];
        r.reasonings.push("Body accepté mais champs non déterminés (pass-through)");
      }
    }
  }
}

// ── Auth detection helpers ────────────────────────────────────────────────

export function detectAuthInArgs(rawArgs: string, r: DetectedRoute): void {
  const lower = rawArgs.toLowerCase();
  if (lower.includes("passport.authenticate")) {
    r.authType = "passport";
    r.authRequired = true;
    r.reasonings?.push("passport.authenticate()");
  } else if (
    /\b(auth|ensureauth|isauthenticated|requireauth|verifyjwt|verifytoken|authenticatejwt|authguard|isauth|checkauth|withauth|protect|guard)\b/.test(
      lower,
    )
  ) {
    r.authType = "middleware";
    r.authRequired = true;
    r.reasonings?.push("Middleware auth-like");
  }
  if (/\b(?:401|403)\b|unauthorized|forbidden/.test(lower)) {
    if (!r.authRequired) {
      r.authRequired = true;
      r.authType = r.authType || "middleware";
      r.reasonings?.push("401/403 in route def");
    }
  }
}

export function detectBodyTypeInArgs(rawArgs: string, r: DetectedRoute): void {
  if (/req(?:uest)?\.json\(\)|body\s*=\s*await/.test(rawArgs)) r.bodyType = "json";
  if (/req(?:uest)?\.formData\(\)/.test(rawArgs)) r.bodyType = "form";
}

export function detectAuthByStatusSignal(content: string, r: DetectedRoute): void {
  if (r.authRequired) return;
  const pattern =
    /(?:abort\s*\(\s*(?:401|403)\s*\)|HTTPException\s*\(\s*(?:status_code\s*=\s*)?(?:401|403)\s*\)|raise\s+(?:PermissionDenied|AuthenticationFailed)|return\s+Response\s*\([^)]*status\s*[:=]\s*(?:401|403))/i;
  if (pattern.test(content)) {
    r.authRequired = true;
    r.authType = r.authType || "middleware";
    r.reasonings?.push("401/403 auth signal");
  }
}

export function inferAuthFromPathAndName(
  routePath: string,
  routeName: string,
): { required: boolean; type?: DetectedRoute["authType"] } {
  const lowerPath = routePath.toLowerCase();
  if (
    /(\/(admin|dashboard|profile|settings|account|private|protected|user\/[^/]+|me|secure)(?:\/|$))/i.test(
      routePath,
    )
  )
    return { required: true, type: "middleware" };
  if (
    /(\/(login|signup|register|forgot-password|public|health|status|ping|docs|swagger)(?:\/|$))/i.test(
      routePath,
    )
  )
    return { required: false };
  if (
    /private|protected|secure|admin|authenticated|restricted|member-only/i.test(
      routeName + lowerPath,
    )
  )
    return { required: true, type: "middleware" };
  if (/public|open|guest|anonymous|free|unrestricted/i.test(routeName + lowerPath))
    return { required: false };
  return { required: false };
}

// ── General utility helpers ────────────────────────────────────────────────

export function parseMethodList(raw: string): string[] {
  const methods = new Set<string>();
  for (const m of raw.matchAll(/['"]([^'"]+)['"]/g)) {
    const normalized = m[1].toUpperCase().trim();
    if (normalized) methods.add(normalized);
  }
  for (const m of raw.matchAll(/\bHttpMethod\.([A-Z]+)\b/g)) methods.add(m[1]);
  for (const m of raw.matchAll(/\b(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS|ALL)\b/g))
    methods.add(m[1]);
  return [...methods];
}

export function addRoute(
  routes: DetectedRoute[],
  seen: Set<string>,
  method: string,
  path: string,
): void {
  const key = `${method}|${path}`;
  if (!seen.has(key)) {
    seen.add(key);
    routes.push({
      name: "",
      method: method as DetectedRoute["method"],
      path,
      headers: [],
      body: "",
      bodyType: "none",
      authRequired: false,
      description: "",
      sourceFile: "",
      controller: null,
      middlewareChain: [],
      authType: null,
      actuallyUsedByFrontend: false,
      reachable: true,
      confidence: "LOW",
      reasonings: [],
      detectedIssues: [],
    });
  }
}
