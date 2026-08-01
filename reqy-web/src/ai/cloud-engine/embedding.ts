import {
  getCachedEmbedding,
  setCachedEmbedding,
  getCachedEmbeddings,
  setCachedEmbeddings,
} from "./embedding-cache";
import { proxyAuthHeaders } from "@/lib/proxy-auth";

const DEFAULT_MODEL = "jina-embeddings-v3";

interface EmbedResponse {
  model: string;
  embeddings: number[][];
  usage?: { total_tokens: number; prompt_tokens: number };
}

async function fetchEmbeddings(inputs: string[], model: string): Promise<EmbedResponse> {
  const res = await fetch("/api/embed", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...proxyAuthHeaders() },
    body: JSON.stringify({ input: inputs, model }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `Embedding API error ${res.status}`);
  }

  return res.json();
}

export async function getEmbedding(text: string, model = DEFAULT_MODEL): Promise<number[]> {
  const cached = await getCachedEmbedding(text, model);
  if (cached) return cached;

  const { embeddings } = await fetchEmbeddings([text], model);
  const embedding = embeddings[0];
  await setCachedEmbedding(text, embedding, model);
  return embedding;
}

export async function getEmbeddings(texts: string[], model = DEFAULT_MODEL): Promise<number[][]> {
  const cached = await getCachedEmbeddings(texts, model);
  const missing: number[] = [];
  for (let i = 0; i < texts.length; i++) {
    if (!cached[i]) missing.push(i);
  }

  if (missing.length === 0) return cached as number[][];

  const missingTexts = missing.map((i) => texts[i]);
  const { embeddings: newEmbeddings } = await fetchEmbeddings(missingTexts, model);

  await setCachedEmbeddings(missingTexts, newEmbeddings, model);

  let nextMiss = 0;
  const results: number[][] = [];
  for (let i = 0; i < texts.length; i++) {
    if (cached[i]) {
      results.push(cached[i]!);
    } else {
      results.push(newEmbeddings[nextMiss++]);
    }
  }
  return results;
}
