/**
 * POST /api/test-runner/execute
 *
 * @deprecated Ce endpoint n'est appelé nulle part dans l'UI React. Il ne sert
 * que d'assistant aux tests e2e (tests/e2e/scripts-assertions.spec.ts,
 * tests/e2e/offline-sync.spec.ts). Le moteur canonique
 * `lib/test-runner/runner.ts` n'exécute pas de scripts côté serveur
 * (`disableScripts: true` sur /api/test-runner/run).
 *
 * 🔐 SECURITY (audit P0 2026-09-03) : désactivé par défaut. L'exécution de
 * JS fournie par le client est une surface RCE (le sandbox node:vm d'origine
 * était contournable par this.constructor.constructor — PoC exécuté).
 * Réactivable UNIQUEMENT pour les runs e2e locaux via
 * REQLY_ENABLE_TEST_SCRIPT_EXECUTION=true.
 */

import { NextRequest, NextResponse } from "next/server";
import { executeTestScript, TestScriptDefinition } from "@/lib/script-executor";
import { createRateLimiter } from "@/lib/rate-limiter";
import { isPublicWebDeployment } from "@/lib/environment";
import { getRateLimitKey } from "@/app/api/proxy-ai/lib/rate-limit";
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

export async function POST(request: NextRequest) {
  try {
    // 🔐 SECURITY: Block arbitrary-script execution on public web deployment.
    if (isPublicWebDeployment()) {
      return NextResponse.json(
        { error: "Test runner is not available on web deployment. Use the desktop application." },
        { status: 403 },
      );
    }

    // 🔐 SECURITY (audit P0): cette route n'a aucun appelant produit — c'est
    // une surface RCE potentielle. Désactivée par défaut ; uniquement les
    // runs e2e locaux la réactivent explicitement.
    if (process.env.REQLY_ENABLE_TEST_SCRIPT_EXECUTION !== "true") {
      return NextResponse.json(
        {
          error:
            "Test script execution is disabled. This endpoint is deprecated and has no product caller; set REQLY_ENABLE_TEST_SCRIPT_EXECUTION=true for local e2e runs only.",
        },
        { status: 404 },
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
