export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS" | "HEAD" | "ALL";

export interface AuthInfo {
  required: boolean;
  type?: string;
  middleware?: string[];
  confidence: "high" | "medium" | "low";
}

export interface BodyInfo {
  contentType?: string;
  schemaName?: string;
  raw?: string;
}

export interface ApiRoute {
  id: string;
  method: HttpMethod;
  path: string;
  file: string;
  line: number;
  framework: string;
  language: string;
  auth: AuthInfo;
  body?: BodyInfo;
  params?: string[];
  query?: string[];
  handlerName?: string;
  raw?: string;
}

export interface AstGrepRule {
  id: string;
  pattern: string;
  kind?: string;
}

export interface AstGrepMatch {
  ruleId: string;
  file: string;
  lang: string;
  line: number;
  /** source text of the matched node */
  text: string;
  /** ast-grep node wrapper (see ast-grep.ts) */
  node: MatchedNode;
}

export interface MatchedNode {
  text(): string;
  kind(): string;
  line(): number;
  get(name: string): string | undefined;
  getAll(name: string): string[];
  parent(): MatchedNode | null;
  children(): MatchedNode[];
}

export interface Detector {
  name: string;
  language: string;
  frameworks: string[];
  extensions: string[];
  ignoreDirs?: string[];
  canHandle(manifestFiles: string[], rootPath: string): boolean;
  rules: AstGrepRule[];
  assemble(matches: AstGrepMatch[], rootPath?: string): ApiRoute[];
}

export interface AnalysisResult {
  projectName: string;
  rootPath: string;
  scannedAt: string;
  languagesDetected: string[];
  frameworksDetected: string[];
  totalRoutes: number;
  routesWithAuth: number;
  routesWithoutAuth: number;
  stats: {
    total: number;
    withAuth: number;
    withoutAuth: number;
    confidence: { high: number; medium: number; low: number };
  };
  routes: ApiRoute[];
  warnings: string[];
}
