import Link from "next/link";
import { HomeLayout } from "fumadocs-ui/layouts/home";
import { baseOptions } from "@/lib/layout.shared";
import { Braces, FileText, FolderKanban, Globe, Rocket, Sparkles, Zap } from "lucide-react";

const features = [
  {
    icon: Zap,
    title: "Request any API",
    description:
      "GET, POST, PUT, PATCH, DELETE with full control over headers, query string, and body — JSON, form, raw, or binary.",
  },
  {
    icon: FolderKanban,
    title: "Collections with scripted tests",
    description:
      "Group requests, add JavaScript assertions (pre-request & post-response), and batch-run suites with progress tracking.",
  },
  {
    icon: Globe,
    title: "Environments & variables",
    description:
      "Reusable {{variables}}, per-environment values, URL preview, and inline detection.",
  },
  {
    icon: Sparkles,
    title: "AI assistant",
    description:
      "Generate follow-up requests from responses, powered by OpenAI, Anthropic, or any compatible endpoint.",
  },
  {
    icon: FileText,
    title: "OpenAPI & Postman",
    description: "Import and export OpenAPI 3.0, Swagger, Postman collections, and Bruno specs.",
  },
  {
    icon: Braces,
    title: "GraphQL support",
    description: "GraphQL query builder, variables, schema exploration, and response viewer.",
  },
];

export default function HomePage() {
  return (
    <HomeLayout {...baseOptions()}>
      <main className="container py-20 flex flex-col items-center gap-12 text-center">
        <div className="flex flex-col items-center gap-4">
          <p className="inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-sm text-fd-muted-foreground">
            <Rocket className="size-4" aria-hidden />
            Reqly — full-featured API client
          </p>
          <h1 className="text-4xl sm:text-5xl font-bold max-w-3xl">
            Test, debug, and automate your APIs
          </h1>
          <p className="text-fd-muted-foreground max-w-2xl mx-auto text-lg">
            A browser-based API endpoint testing and management platform. The complete
            documentation, from your first request to scripted collection runs.
          </p>
          <div className="flex flex-wrap justify-center gap-3 mt-4">
            <Link
              href="/docs"
              className="rounded-lg bg-fd-primary text-fd-primary-foreground px-5 py-2.5 text-sm font-medium transition-transform hover:scale-[1.02]"
            >
              Read the docs
            </Link>
            <Link
              href="/docs/getting-started"
              className="rounded-lg border px-5 py-2.5 text-sm font-medium transition-transform hover:scale-[1.02]"
            >
              Getting started
            </Link>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-5xl mx-auto w-full text-left">
          {features.map((f) => (
            <div
              key={f.title}
              className="border rounded-lg p-5 transition-colors hover:border-fd-border bg-fd-card"
            >
              <div className="inline-flex items-center justify-center p-2 rounded-md bg-fd-primary/10 text-fd-primary mb-3">
                <f.icon className="size-5" aria-hidden />
              </div>
              <h2 className="font-semibold mb-1">{f.title}</h2>
              <p className="text-sm text-fd-muted-foreground">{f.description}</p>
            </div>
          ))}
        </div>
      </main>
    </HomeLayout>
  );
}
