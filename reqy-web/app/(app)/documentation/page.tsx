"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Text } from "@/components/ui/text";
import {
  Globe,
  BookOpen,
  Play,
  History,
  FolderKanban,
  Variable,
  Sparkles,
  BarChart3,
  Settings,
  Keyboard,
  ChevronRight,
  Terminal,
  Link2,
  Shuffle,
  Copy,
  Search,
  Filter,
  Braces,
  CheckCircle2,
} from "lucide-react";

const sections = [
  { id: "overview", label: "Overview" },
  { id: "requests", label: "Making Requests" },
  { id: "history", label: "Request History" },
  { id: "collections", label: "Collections" },
  { id: "environments", label: "Environment Variables" },
  { id: "ai", label: "AI Integration" },
  { id: "dashboard", label: "Dashboard" },
  { id: "settings", label: "Settings" },
] as const;

function SectionCard({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-6 space-y-4">
      <div className="flex items-center gap-3">
        <div className="size-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
          {icon}
        </div>
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      </div>
      {children}
    </div>
  );
}

function Badge({
  children,
  color = "default",
}: {
  children: React.ReactNode;
  color?: "emerald" | "blue" | "amber" | "purple" | "red" | "default";
}) {
  const colors = {
    emerald: "bg-success/10 text-success border-success/30",
    blue: "bg-blue-500/15 text-blue-700 border-blue-500/30 dark:text-blue-400",
    amber: "bg-warning/10 text-warning border-warning/30",
    purple: "bg-purple-500/15 text-purple-700 border-purple-500/30 dark:text-purple-400",
    red: "bg-destructive/10 text-destructive border-destructive/30",
    default: "bg-muted text-muted-foreground border-border",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium",
        colors[color],
      )}
    >
      {children}
    </span>
  );
}

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="inline-flex items-center rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] font-mono text-muted-foreground shadow-sm">
      {children}
    </kbd>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono text-foreground">
      {children}
    </code>
  );
}

function MethodBadge({ method }: { method: string }) {
  const colors: Record<string, string> = {
    GET: "bg-success/10 text-success border-success/30",
    POST: "bg-blue-500/15 text-blue-700 border-blue-500/30 dark:text-blue-400",
    PUT: "bg-warning/10 text-warning border-warning/30",
    PATCH: "bg-purple-500/15 text-purple-700 border-purple-500/30 dark:text-purple-400",
    DELETE: "bg-destructive/10 text-destructive border-destructive/30",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold border",
        colors[method] || colors.GET,
      )}
    >
      {method}
    </span>
  );
}

export default function DocumentationPage() {
  const [activeSection, setActiveSection] = useState("overview");

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Side Table of Contents */}
      <nav className="hidden lg:flex w-56 shrink-0 flex-col border-r border-border bg-muted/30 overflow-y-auto p-4">
        <div className="flex items-center gap-2 mb-4 px-2">
          <BookOpen className="size-4 text-primary" />
          <Text variant="label" className="text-foreground/70">
            Contents
          </Text>
        </div>
        <div className="space-y-0.5">
          {sections.map((s) => (
            <button
              key={s.id}
              onClick={() => {
                setActiveSection(s.id);
                document.getElementById(s.id)?.scrollIntoView({ behavior: "instant" });
              }}
              className={cn(
                "w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-left transition-colors",
                activeSection === s.id
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <ChevronRight
                className={cn("size-3 transition-transform", activeSection === s.id && "rotate-90")}
              />
              {s.label}
            </button>
          ))}
        </div>
      </nav>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto p-6 lg:p-10 space-y-8">
          {/* Header */}
          <div className="space-y-3 pb-6 border-b border-border">
            <h1 className="text-3xl font-bold tracking-tight text-foreground">Documentation</h1>
            <p className="text-muted-foreground text-lg">
              Complete guide to using ReQLy — your API endpoint testing tool.
            </p>
          </div>

          {/* ============ OVERVIEW ============ */}
          <section id="overview" className="scroll-mt-20">
            <SectionCard icon={<Globe className="size-4" />} title="Overview">
              <p className="text-sm text-muted-foreground leading-relaxed">
                ReQLy is a full-featured API client built with Next.js. It lets you send HTTP
                requests, inspect responses, organize your work into collections, manage environment
                variables, and much more — all from your browser.
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-2">
                {[
                  {
                    icon: <Play className="size-4" />,
                    label: "HTTP Requests",
                    desc: "GET, POST, PUT, PATCH, DELETE",
                  },
                  {
                    icon: <History className="size-4" />,
                    label: "History",
                    desc: "Search, filter, replay",
                  },
                  {
                    icon: <FolderKanban className="size-4" />,
                    label: "Collections",
                    desc: "Organize & batch run",
                  },
                  {
                    icon: <Variable className="size-4" />,
                    label: "Environments",
                    desc: "{{variables}} support",
                  },
                  {
                    icon: <Sparkles className="size-4" />,
                    label: "AI Assistant",
                    desc: "Follow-up requests",
                  },
                ].map((f) => (
                  <div
                    key={f.label}
                    className="rounded-lg border border-border bg-muted/50 p-3 space-y-1"
                  >
                    <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                      {f.icon}
                      {f.label}
                    </div>
                    <p className="text-xs text-muted-foreground">{f.desc}</p>
                  </div>
                ))}
              </div>
            </SectionCard>
          </section>

          {/* ============ REQUESTS ============ */}
          <section id="requests" className="scroll-mt-20">
            <SectionCard icon={<Terminal className="size-4" />} title="Making Requests">
              <div className="space-y-4 text-sm text-muted-foreground leading-relaxed">
                <p>
                  The main interface is split into a <strong>Request Panel</strong> (top/left) and a{" "}
                  <strong>Response Panel</strong> (bottom/right).
                </p>

                <div className="space-y-2">
                  <h3 className="font-medium text-foreground">URL & Method</h3>
                  <p>
                    Enter a full URL (<Code>https://api.example.com/users</Code>) in the URL bar.
                    Select an HTTP method:
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <span>
                      <MethodBadge method="GET" /> — Retrieve data
                    </span>
                    <span>
                      <MethodBadge method="POST" /> — Create data
                    </span>
                    <span>
                      <MethodBadge method="PUT" /> — Update data
                    </span>
                    <span>
                      <MethodBadge method="PATCH" /> — Partial update
                    </span>
                    <span>
                      <MethodBadge method="DELETE" /> — Delete data
                    </span>
                  </div>
                </div>

                <div className="space-y-2">
                  <h3 className="font-medium text-foreground">Headers</h3>
                  <p>
                    Add custom headers using the key-value editor. Common headers like{" "}
                    <Code>Content-Type</Code> and <Code>Authorization</Code> are pre-filled for
                    convenience.
                  </p>
                </div>

                <div className="space-y-2">
                  <h3 className="font-medium text-foreground">Request Body</h3>
                  <p>Supported body types:</p>
                  <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                    <li>
                      <strong className="text-foreground">JSON</strong> — syntax-highlighted editor
                      with validation
                    </li>
                    <li>
                      <strong className="text-foreground">Form Data</strong> — key-value pairs
                      (multipart)
                    </li>
                    <li>
                      <strong className="text-foreground">Form URL-encoded</strong> — standard URL
                      encoding
                    </li>
                    <li>
                      <strong className="text-foreground">Raw</strong> — plain text / HTML / XML /
                      custom
                    </li>
                    <li>
                      <strong className="text-foreground">Binary</strong> — file upload
                    </li>
                  </ul>
                </div>

                <div className="space-y-2">
                  <h3 className="font-medium text-foreground">Response Viewer</h3>
                  <p>After sending a request, the response panel shows:</p>
                  <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                    <li>
                      <strong className="text-foreground">Status code</strong> with color indicator
                      (<span className="text-success">2xx</span>,{" "}
                      <span className="text-warning">4xx</span>,{" "}
                      <span className="text-destructive">5xx</span>)
                    </li>
                    <li>
                      <strong className="text-foreground">Response time</strong> and{" "}
                      <strong>size</strong>
                    </li>
                    <li>
                      <strong className="text-foreground">Headers</strong> table
                    </li>
                    <li>
                      <strong className="text-foreground">Body</strong> with syntax highlighting and
                      JSON formatting
                    </li>
                    <li>
                      <strong className="text-foreground">Cookies</strong> received from the server
                    </li>
                  </ul>
                </div>
              </div>
            </SectionCard>
          </section>

          {/* ============ HISTORY ============ */}
          <section id="history" className="scroll-mt-20">
            <SectionCard icon={<History className="size-4" />} title="Request History">
              <div className="space-y-4 text-sm text-muted-foreground leading-relaxed">
                <p>
                  Every request you send is automatically saved to the{" "}
                  <strong>History panel</strong> (accessible from a drawer on the right side of the
                  header).
                </p>

                <div className="space-y-2">
                  <h3 className="font-medium text-foreground">Search & Filters</h3>
                  <p>The history panel includes powerful search and filtering tools:</p>
                  <div className="rounded-lg border border-border bg-muted/50 p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <Search className="size-4 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">
                        Search by name, URL, method, or status code
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Filter className="size-4 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">
                        Filter by HTTP method chips (multi-select)
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge color="emerald">2xx</Badge>
                      <Badge color="amber">4xx</Badge>
                      <Badge color="red">5xx</Badge>
                      <Badge color="default">Errors</Badge>
                      <span className="text-xs text-muted-foreground">
                        Quick status range filters
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      All filters compose together — text + method + status. A{" "}
                      <strong>Clear</strong> button resets everything at once.
                    </p>
                  </div>
                </div>

                <div className="space-y-2">
                  <h3 className="font-medium text-foreground">Replay & Follow-Up</h3>
                  <p>Each history entry offers two actions on hover:</p>
                  <ul className="list-disc list-inside space-y-1">
                    <li>
                      <strong className="text-foreground">Replay</strong> — reopen the request in
                      the editor
                    </li>
                    <li>
                      <strong className="text-foreground">AI Follow-Up</strong> — generate a related
                      request using AI (see AI Integration section)
                    </li>
                  </ul>
                </div>
              </div>
            </SectionCard>
          </section>

          {/* ============ COLLECTIONS ============ */}
          <section id="collections" className="scroll-mt-20">
            <SectionCard icon={<FolderKanban className="size-4" />} title="Collections">
              <div className="space-y-4 text-sm text-muted-foreground leading-relaxed">
                <p>
                  Collections let you group related requests together for organization and batch
                  execution. Access them via the <strong>Collections</strong> page in the sidebar,
                  the modal in the header, or the drawer for quick access.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="rounded-lg border border-border bg-muted/50 p-3 space-y-1">
                    <h4 className="text-xs font-semibold text-foreground flex items-center gap-1">
                      <FolderKanban className="size-3" /> Create & Manage
                    </h4>
                    <p className="text-xs text-muted-foreground">
                      Create collections, rename them, add requests with name + URL + method.
                      Organize into list or card view.
                    </p>
                  </div>
                  <div className="rounded-lg border border-border bg-muted/50 p-3 space-y-1">
                    <h4 className="text-xs font-semibold text-foreground flex items-center gap-1">
                      <Copy className="size-3" /> Duplicate
                    </h4>
                    <p className="text-xs text-muted-foreground">
                      Right-click or use the dropdown menu on any collection to duplicate it &mdash;
                      requests, folders, and all.
                    </p>
                  </div>
                  <div className="rounded-lg border border-border bg-muted/50 p-3 space-y-1">
                    <h4 className="text-xs font-semibold text-foreground flex items-center gap-1">
                      <Shuffle className="size-3" /> Drag Reorder
                    </h4>
                    <p className="text-xs text-muted-foreground">
                      Drag collections by the grip handle on the left to reorder them in the list
                      view.
                    </p>
                  </div>
                  <div className="rounded-lg border border-border bg-muted/50 p-3 space-y-1">
                    <h4 className="text-xs font-semibold text-foreground flex items-center gap-1">
                      <Play className="size-3" /> Batch Run
                    </h4>
                    <p className="text-xs text-muted-foreground">
                      Run all requests in a collection at once. Track progress with the modal —
                      success/failure per request.
                    </p>
                  </div>
                </div>

                <div className="space-y-2">
                  <h3 className="font-medium text-foreground">Export & Import</h3>
                  <div className="rounded-lg border border-border bg-muted/50 p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-foreground">OpenAPI</span>
                      <div className="flex gap-2">
                        <Badge color="emerald">Export</Badge>
                        <Badge color="blue">Import</Badge>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Export your collections as OpenAPI 3.0 specs or import existing OpenAPI
                      definitions to create collections.
                    </p>
                    <div className="border-t border-border pt-2 mt-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-foreground">Postman</span>
                        <div className="flex gap-2">
                          <Badge color="emerald">Export</Badge>
                          <Badge color="blue">Import</Badge>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Connect your Postman account to import/export collections seamlessly.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <h3 className="font-medium text-foreground">IDEs & Integration</h3>
                  <p>
                    Use the <strong>Save as Project</strong> feature to export your workspace
                    (requests, collections, environments) into a JSON file. Reopen later via{" "}
                    <strong>My Projects</strong> to restore your entire setup.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Badge>VS Code</Badge>
                    <Badge>Windsurf</Badge>
                    <Badge>Cursor</Badge>
                    <Badge>Continue.dev</Badge>
                  </div>
                </div>
              </div>
            </SectionCard>
          </section>

          {/* ============ ENVIRONMENTS ============ */}
          <section id="environments" className="scroll-mt-20">
            <SectionCard icon={<Braces className="size-4" />} title="Environment Variables">
              <div className="space-y-4 text-sm text-muted-foreground leading-relaxed">
                <p>
                  Environment variables let you store reusable values (base URLs, API keys, tokens)
                  and reference them in your requests using the <Code>{`{{VARIABLE_NAME}}`}</Code>{" "}
                  syntax.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="rounded-lg border border-border bg-muted/50 p-3 space-y-1">
                    <h4 className="text-xs font-semibold text-foreground">Creating Variables</h4>
                    <p className="text-xs text-muted-foreground">
                      Open the <strong>Variables panel</strong> from the header (next to the
                      environment selector). Add variables with key-value pairs and toggle them
                      on/off.
                    </p>
                  </div>
                  <div className="rounded-lg border border-border bg-muted/50 p-3 space-y-1">
                    <h4 className="text-xs font-semibold text-foreground">URL Preview</h4>
                    <p className="text-xs text-muted-foreground">
                      The Variables panel includes a URL preview tool: type a URL with{" "}
                      <Code>{`{{VAR}}`}</Code> placeholders and see the resolved result with syntax
                      highlighting.
                    </p>
                  </div>
                  <div className="rounded-lg border border-border bg-muted/50 p-3 space-y-1">
                    <h4 className="text-xs font-semibold text-foreground">Inline Detection</h4>
                    <p className="text-xs text-muted-foreground">
                      When you type <Code>{`{{...}}`}</Code> in the URL input, the app automatically
                      detects and lists the variables below the input bar.
                    </p>
                  </div>
                  <div className="rounded-lg border border-border bg-muted/50 p-3 space-y-1">
                    <h4 className="text-xs font-semibold text-foreground">Multiple Environments</h4>
                    <p className="text-xs text-muted-foreground">
                      Create separate environments (e.g., <Badge>Development</Badge>,{" "}
                      <Badge>Staging</Badge>, <Badge color="amber">Production</Badge>) and switch
                      between them instantly.
                    </p>
                  </div>
                </div>

                <div className="rounded-lg border border-border bg-muted/50 p-3 space-y-2">
                  <h4 className="text-xs font-semibold text-foreground flex items-center gap-1">
                    <Link2 className="size-3" /> Where variables are resolved
                  </h4>
                  <ul className="list-disc list-inside space-y-1 text-xs">
                    <li>
                      <strong>URL</strong> — all <Code>{`{{var}}`}</Code> placeholders in the URL
                      are replaced
                    </li>
                    <li>
                      <strong>Headers</strong> — variable values can be used in header values
                    </li>
                    <li>
                      <strong>Body</strong> — variables can be referenced in raw/JSON body content
                    </li>
                  </ul>
                  <p className="text-xs text-muted-foreground pt-1">
                    Variables are resolved at request time from the currently active environment.
                  </p>
                </div>
              </div>
            </SectionCard>
          </section>

          {/* ============ AI ============ */}
          <section id="ai" className="scroll-mt-20">
            <SectionCard icon={<Sparkles className="size-4" />} title="AI Integration">
              <div className="space-y-4 text-sm text-muted-foreground leading-relaxed">
                <p>
                  ReQLy includes an <strong>AI-powered follow-up request generator</strong> that
                  helps you build related API requests based on previous responses.
                </p>

                <div className="space-y-2">
                  <h3 className="font-medium text-foreground">How it works</h3>
                  <ol className="list-decimal list-inside space-y-2">
                    <li>
                      Send a request and receive a response (e.g., <MethodBadge method="POST" />{" "}
                      Create User).
                    </li>
                    <li>
                      In the <strong>History panel</strong>, hover over the entry and click the{" "}
                      <Sparkles className="size-3 inline" /> icon.
                    </li>
                    <li>
                      The AI analyzes the response and generates a follow-up request — e.g., a{" "}
                      <MethodBadge method="GET" /> request to fetch the newly created user.
                    </li>
                    <li>The generated request opens in a new tab, ready to send.</li>
                  </ol>
                </div>

                <div className="rounded-lg border border-border bg-muted/50 p-3">
                  <p className="text-xs text-muted-foreground">
                    <strong className="text-foreground">Note:</strong> AI features require an API
                    key configured in <strong>Settings → AI Configuration</strong>. Supported
                    providers include OpenAI, Anthropic, and any OpenAI-compatible endpoint.
                  </p>
                </div>
              </div>
            </SectionCard>
          </section>

          {/* ============ DASHBOARD ============ */}
          <section id="dashboard" className="scroll-mt-20">
            <SectionCard icon={<BarChart3 className="size-4" />} title="Dashboard">
              <div className="space-y-4 text-sm text-muted-foreground leading-relaxed">
                <p>
                  The <strong>Dashboard</strong> gives you an overview of your API usage and
                  activity.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="rounded-lg border border-border bg-muted/50 p-3 text-center space-y-1">
                    <Globe className="size-5 mx-auto text-primary" />
                    <p className="text-xs font-medium text-foreground">Total Requests</p>
                    <p className="text-xs text-muted-foreground">Count of all sent requests</p>
                  </div>
                  <div className="rounded-lg border border-border bg-muted/50 p-3 text-center space-y-1">
                    <History className="size-5 mx-auto text-primary" />
                    <p className="text-xs font-medium text-foreground">Recent Activity</p>
                    <p className="text-xs text-muted-foreground">Requests by day/week</p>
                  </div>
                  <div className="rounded-lg border border-border bg-muted/50 p-3 text-center space-y-1">
                    <CheckCircle2 className="size-5 mx-auto text-primary" />
                    <p className="text-xs font-medium text-foreground">Success Rate</p>
                    <p className="text-xs text-muted-foreground">2xx vs 4xx/5xx ratio</p>
                  </div>
                </div>
              </div>
            </SectionCard>
          </section>

          {/* ============ SETTINGS ============ */}
          <section id="settings" className="scroll-mt-20">
            <SectionCard icon={<Settings className="size-4" />} title="Settings">
              <div className="space-y-4 text-sm text-muted-foreground leading-relaxed">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="rounded-lg border border-border bg-muted/50 p-3 space-y-1">
                    <h4 className="text-xs font-semibold text-foreground">Appearance</h4>
                    <p className="text-xs text-muted-foreground">
                      Choose between <strong>Light</strong>, <strong>Dark</strong>, and{" "}
                      <strong>System</strong> theme modes.
                    </p>
                  </div>
                  <div className="rounded-lg border border-border bg-muted/50 p-3 space-y-1">
                    <h4 className="text-xs font-semibold text-foreground">Language</h4>
                    <p className="text-xs text-muted-foreground">
                      Interface available in multiple languages (currently English and French).
                    </p>
                  </div>
                  <div className="rounded-lg border border-border bg-muted/50 p-3 space-y-1">
                    <h4 className="text-xs font-semibold text-foreground">AI Configuration</h4>
                    <p className="text-xs text-muted-foreground">
                      Configure AI provider (OpenAI, Anthropic, custom endpoint) with API key for AI
                      follow-up request generation.
                    </p>
                  </div>
                  <div className="rounded-lg border border-border bg-muted/50 p-3 space-y-1">
                    <h4 className="text-xs font-semibold text-foreground">Data Management</h4>
                    <p className="text-xs text-muted-foreground">
                      Clear request history, manage saved projects, export/import your workspace
                      data.
                    </p>
                  </div>
                </div>
              </div>
            </SectionCard>
          </section>

          {/* Footer */}
          <div className="border-t border-border pt-6 pb-10 text-center">
            <p className="text-xs text-muted-foreground">
              Built with Next.js, Tailwind CSS, shadcn/ui, and TypeScript.{" "}
              <a href="https://github.com" className="underline hover:text-foreground">
                GitHub
              </a>
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
