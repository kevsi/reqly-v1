#!/usr/bin/env node
/**
 * Pre-commit secret scanner — detects potential secrets in staged files.
 *
 * Checks for common API key patterns, private keys, and high-entropy tokens.
 * Runs as part of the husky pre-commit hook via lint-staged.
 *
 * Usage:
 *   node scripts/check-secrets.mjs [files...]
 *
 * Returns exit code 0 if clean, 1 if potential secrets found.
 */
import { readFileSync } from "node:fs";

// Regex patterns for known secret formats
const SECRET_PATTERNS = [
  /(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,}/g, // GitHub tokens
  /sk-[A-Za-z0-9-_]{32,}/g, // OpenAI / Anthropic keys
  /xox[bpras]-[A-Za-z0-9-]{24,}/g, // Slack tokens
  /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g, // Private keys
  /AKIA[0-9A-Z]{16}/g, // AWS access key IDs
  /(?:A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}/g, // AWS wider
  /SF_ACCESS_KEY|SF_SECRET_KEY|SF_SESSION_TOKEN/g, // Salesforce
  /(?:SUPABASE_SERVICE_ROLE_KEY|SERVICE_ROLE_KEY).*[A-Za-z0-9-_]{20,}/g,
];

// Files that are allowed to contain secret-like placeholders (env examples,
// docs, and this scanner itself). Matching is done on the normalized path so a
// file named e.g. `m` or `md` no longer bypasses the scan — the previous logic
// tested whether the allowlist *pattern* contained the file basename, which
// matched far too broadly (e.g. "**/*.md".includes("m") === true).
function isAllowedPath(file) {
  const norm = String(file).replace(/\\/g, "/");
  const basename = norm.split("/").pop() || norm;
  if (norm.endsWith(".md")) return true;
  if (basename === ".env.example" || basename === "env.example") return true;
  if (norm.endsWith("scripts/check-secrets.mjs")) return true;
  return false;
}

const files = process.argv.slice(2);
let hasViolation = false;

for (const file of files) {
  // Skip allowlisted paths (placeholders / docs / this scanner).
  if (isAllowedPath(file)) {
    continue;
  }

  let content;
  try {
    content = readFileSync(file, "utf-8");
  } catch {
    continue; // binary or unreadable
  }

  for (const pattern of SECRET_PATTERNS) {
    const matches = content.match(pattern);
    if (matches) {
      // Filter out obviously fake/example values
      const real = matches.filter(
        (m) =>
          !m.includes("your-") &&
          !m.includes("example") &&
          !m.includes("YOUR_") &&
          !m.includes("placeholder") &&
          !m.includes("test-only") &&
          !m.includes("replace_me") &&
          m.length > 20,
      );
      if (real.length > 0) {
        console.error(`❌ ${file}: potential secret detected matching ${pattern}`);
        hasViolation = true;
      }
    }
  }
}

if (hasViolation) {
  console.error(
    "\n⚠️  Potential secrets found in staged files. Remove them or use --no-verify if intentional.",
  );
  process.exit(1);
}
