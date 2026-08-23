/**
 * POST /api/test-runner/execute
 *
 * @deprecated Ce endpoint n'est pas appelé depuis l'UI React.
 * Il est uniquement couvert par des tests e2e (tests/e2e/scripts-assertions.spec.ts,
 * tests/e2e/offline-sync.spec.ts). Conservé car le moteur canonique
 * `lib/test-runner/runner.ts` n'exécute pas de scripts côté serveur
 * (la route canonique `/api/test-runner/run` tourne avec `disableScripts: true`),
 * il ne peut donc pas remplacer ce contrat. Le contexte sandbox est durci pour
 * refléter la politique FORBIDDEN_GLOBALS du moteur canonique.
 *
 * Execute test scripts for a captured request/response
 */

import { NextRequest, NextResponse } from "next/server";
import { executeTestScript, TestScriptDefinition } from "@/lib/script-executor";
import { createRateLimiter } from "@/lib/rate-limiter";
import { isPublicWebDeployment } from "@/lib/environment";
import { z } from "zod";

// Validation schema
const ExecuteTestScriptsRequestSchema = z.object({
  scripts: z.array(
    z.object({
      name: z.string(),
      preScript: z.string().optional(),
      testScript: z.string(),
      postScript: z.string().optional(),
      variables: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
      assertions: z
        .array(
          z.object({
            type: z.enum(["statusCode", "bodyContains", "headerExists", "jsonPath", "custom"]),
            value: z.union([z.string(), z.number()]),
            message: z.string().optional(),
          }),
        )
        .optional(),
      timeout: z.number().optional(),
    }),
  ),
  request: z.object({
    method: z.string().optional(),
    url: z.string().optional(),
    headers: z.record(z.string()).optional(),
    body: z.string().optional(),
  }),
  response: z.object({
    status: z.number(),
    headers: z.record(z.string()).optional(),
    body: z.string().optional(),
  }),
});

type ExecuteTestScriptsRequest = z.infer<typeof ExecuteTestScriptsRequestSchema>;

const rateLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 10 });

function getRateLimitKey(request: NextRequest): string {
  if (process.env.TRUSTED_PROXY === "true") {
    const forwarded = request.headers.get("x-forwarded-for");
    return forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "127.0.0.1";
  }
  return "unknown";
}

export async function POST(request: NextRequest) {
  try {
    // 🔐 SECURITY: Block arbitrary-script execution on public web deployment.
    // This endpoint runs client-supplied JS in a vm sandbox (CPU DoS risk).
    if (isPublicWebDeployment()) {
      return NextResponse.json(
        { error: "Test runner is not available on web deployment. Use the desktop application." },
        { status: 403 },
      );
    }

    const rateResult = await rateLimiter.check(getRateLimitKey(request));
    if (!rateResult.allowed) {
      return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
    }

    // Parse and validate request body
    const body = await request.json();
    let validatedData: ExecuteTestScriptsRequest;

    try {
      validatedData = ExecuteTestScriptsRequestSchema.parse(body);
    } catch (validationError) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid request format",
          details: validationError instanceof z.ZodError ? validationError.errors : [],
        },
        { status: 400 },
      );
    }

    // Execute test scripts
    const results = await Promise.all(
      validatedData.scripts.map((scriptDef) =>
        executeTestScript(
          scriptDef as TestScriptDefinition,
          validatedData.request,
          validatedData.response,
        ),
      ),
    );

    // Calculate summary
    const totalAssertions = results.reduce((sum, r) => sum + r.assertions.total, 0);
    const passedAssertions = results.reduce((sum, r) => sum + r.assertions.passed, 0);
    const passedScripts = results.filter((r) => r.success).length;

    return NextResponse.json({
      success: true,
      data: {
        scripts: results,
        summary: {
          totalScripts: results.length,
          passedScripts,
          failedScripts: results.length - passedScripts,
          totalAssertions,
          passedAssertions,
          failedAssertions: totalAssertions - passedAssertions,
          overallSuccess: passedAssertions === totalAssertions && passedScripts === results.length,
          totalDuration: results.reduce((sum, r) => sum + r.duration, 0),
        },
      },
    });
  } catch (error) {
    console.error("[Test Runner] Execution error:", error);
    return NextResponse.json(
      {
        success: false,
        error: `Test execution failed: ${error instanceof Error ? error.message : String(error)}`,
      },
      { status: 500 },
    );
  }
}
