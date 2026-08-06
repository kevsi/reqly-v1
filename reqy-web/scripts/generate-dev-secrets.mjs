#!/usr/bin/env node
import { randomBytes } from "crypto";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const ENV_LOCAL = join(process.cwd(), ".env.local");
const ENV_EXAMPLE = join(process.cwd(), ".env.example");

// Minimum 32 chars pour AUTH_SIGNING_SECRET et PROXY_SERVICE_TOKEN
const SECRET_MIN_LENGTH = 32;

/**
 * Génère un secret cryptographiquement sécurisé de 32 bytes (256 bits) encodé en base64.
 * Résultat : ~43 caractères base64, > 32 chars requis.
 */
function generateSecret() {
  return randomBytes(32).toString("base64");
}

/**
 * Parse .env.local existant → Map<key, value>
 */
function parseEnvFile(path) {
  if (!existsSync(path)) return new Map();
  const content = readFileSync(path, "utf-8");
  const map = new Map();
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const [key, ...rest] = trimmed.split("=");
    if (key && rest.length > 0) {
      map.set(key.trim(), rest.join("=").trim());
    }
  }
  return map;
}

/**
 * Écrit les variables d'environnement dans .env.local, en préservant les valeurs existantes.
 */
function writeEnvFile(path, envMap) {
  const lines = [];
  for (const [key, value] of envMap.entries()) {
    lines.push(`${key}=${value}`);
  }
  writeFileSync(path, lines.join("\n") + "\n", "utf-8");
}

function main() {
  console.log("[generate-dev-secrets] Vérification des secrets dev...");

  const existing = parseEnvFile(ENV_LOCAL);
  let updated = false;

  // AUTH_SIGNING_SECRET
  const authSecret = existing.get("AUTH_SIGNING_SECRET");
  if (!authSecret || authSecret.length < SECRET_MIN_LENGTH || authSecret === "your_auth_signing_secret") {
    const newSecret = generateSecret();
    existing.set("AUTH_SIGNING_SECRET", newSecret);
    console.log(`[generate-dev-secrets] ✓ Généré AUTH_SIGNING_SECRET (${newSecret.length} chars)`);
    updated = true;
  } else {
    console.log(`[generate-dev-secrets] ✓ AUTH_SIGNING_SECRET déjà défini`);
  }

  // PROXY_SERVICE_TOKEN
  const proxyToken = existing.get("PROXY_SERVICE_TOKEN");
  if (!proxyToken || proxyToken.length < SECRET_MIN_LENGTH || proxyToken === "your_proxy_service_token") {
    const newToken = generateSecret();
    existing.set("PROXY_SERVICE_TOKEN", newToken);
    console.log(`[generate-dev-secrets] ✓ Généré PROXY_SERVICE_TOKEN (${newToken.length} chars)`);
    updated = true;
  } else {
    console.log(`[generate-dev-secrets] ✓ PROXY_SERVICE_TOKEN déjà défini`);
  }

  if (updated) {
    writeEnvFile(ENV_LOCAL, existing);
    console.log(`[generate-dev-secrets] → Secrets écrits dans .env.local`);
  } else {
    console.log(`[generate-dev-secrets] → Aucune mise à jour nécessaire`);
  }
}

main();
