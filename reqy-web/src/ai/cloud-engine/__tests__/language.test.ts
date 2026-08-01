import { describe, it, expect } from "vitest";
import {
  detectLanguage,
  languageInstruction,
  adaptPromptForLanguage,
  adaptToQuestionLanguage,
} from "@/src/ai/cloud-engine/language";

describe("detectLanguage", () => {
  it("detects French from common stopwords", () => {
    expect(detectLanguage("Comment faire une requête HTTP avec un header d'autorisation ?")).toBe("fr");
  });

  it("detects English from common stopwords", () => {
    expect(detectLanguage("How do I make an HTTP request with an authorization header ?")).toBe("en");
  });

  it("returns unknown for very short text", () => {
    expect(detectLanguage("hi")).toBe("unknown");
  });

  it("returns unknown for empty input", () => {
    expect(detectLanguage("")).toBe("unknown");
    expect(detectLanguage("   ")).toBe("unknown");
  });

  it("returns unknown for text without stopwords", () => {
    expect(detectLanguage("foobarbaz qux corge")).toBe("unknown");
  });

  it("handles accented characters", () => {
    expect(detectLanguage("Où est la bibliothèque avec les livres ?")).toBe("fr");
  });

  it("returns dominant language when signal is mixed", () => {
    expect(
      detectLanguage(
        "The user is asking about une bibliothèque and un livre, also how to use this API"
      )
    ).toBe("en"); // more en signals
  });
});

describe("languageInstruction", () => {
  it("returns null for French (default prompt is already French)", () => {
    expect(languageInstruction("fr")).toBeNull();
  });
  it("returns English directive for English", () => {
    expect(languageInstruction("en")).toContain("English");
  });
  it("returns null for unknown", () => {
    expect(languageInstruction("unknown")).toBeNull();
  });
});

describe("adaptPromptForLanguage", () => {
  it("returns prompt unchanged for French", () => {
    const p = "Hello world";
    expect(adaptPromptForLanguage(p, "fr")).toBe(p);
  });
  it("appends directive for English", () => {
    const p = "Hello world";
    const out = adaptPromptForLanguage(p, "en");
    expect(out).toContain("English");
    expect(out.length).toBeGreaterThan(p.length);
  });
});

describe("adaptToQuestionLanguage", () => {
  it("returns adapted prompt based on detected language", () => {
    const out = adaptToQuestionLanguage("How are you today?", "Bonjour");
    expect(out).toContain("English");
  });

  it("returns prompt unchanged for French question", () => {
    const p = "Bonjour, comment ça va ?";
    expect(adaptToQuestionLanguage(p, p)).toBe(p);
  });
});
