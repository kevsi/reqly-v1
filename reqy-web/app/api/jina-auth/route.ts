export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { buildApiKeyCookie, buildClearCookies } from "./cookies";

const JINA_KEY_REGEX = /^jina_[A-Za-z0-9_-]+$/;

async function validateJinaKey(apiKey: string): Promise<boolean> {
  const res = await fetch("https://api.jina.ai/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "jina-embeddings-v3",
      input: ["test"],
    }),
  });
  return res.ok;
}

export async function POST(request: NextRequest) {
  let body: { apiKey?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body JSON invalide" }, { status: 400 });
  }

  const apiKey = body.apiKey?.trim();
  if (!apiKey || !JINA_KEY_REGEX.test(apiKey)) {
    return NextResponse.json(
      { error: "Clé API invalide (doit commencer par jina_)" },
      { status: 400 },
    );
  }

  const valid = await validateJinaKey(apiKey);
  if (!valid) {
    return NextResponse.json(
      { error: "Clé API rejetée par Jina" },
      { status: 400 },
    );
  }

  const response = NextResponse.json({ connected: true });
  response.cookies.set(buildApiKeyCookie(apiKey));
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  for (const cookie of buildClearCookies()) {
    response.cookies.set(cookie);
  }
  return response;
}
