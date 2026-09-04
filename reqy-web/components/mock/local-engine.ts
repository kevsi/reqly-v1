/**
 * Pont navigateur vers @reqly/mock-engine.
 *
 * AVANT (audit 2026-09-04) : ce fichier était un "miroir fidèle" du
 * générateur du package — deux sources de vérité qui dérivaient. Le package
 * expose désormais un sous-chemin isomorphe `@reqly/mock-engine/generator`
 * (sans node:*) utilisé directement ici.
 *
 * SECURITY : `runTransformLocal` n'exécute plus aucun JS dans la page —
 * l'exécution des transforms se fait dans le serveur mock (recli), dans un
 * process jetable sous --permission.
 */
import { generate, inferFormat } from "@reqly/mock-engine/generator";
import type { BodySchema } from "@reqly/mock-engine";

type Rng = () => number;

export function generateLocal(schema: BodySchema | undefined, rng: Rng, keyHint?: string): unknown {
  if (!schema || schema.type === "null") return null;
  if (schema.enum && schema.enum.length > 0) return schema.enum[Math.floor(rng() * schema.enum.length)];
  if (schema.example !== undefined) return schema.example;
  return generate(schema, rng, keyHint);
}

export function inferFormatLocal(keyHint: string): string {
  return inferFormat(keyHint) ?? 'slug';
}

export function runTransformLocal(_code: string, _input: unknown): never {
  throw new Error(
    "L'exécution des transforms JS est désactivée dans le navigateur (sécurité). " +
      "Testez le transform via le serveur mock (recli mock start) — process jetable.",
  );
}
