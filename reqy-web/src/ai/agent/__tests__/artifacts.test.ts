import { describe, it, expect } from "vitest";
import { extractArtifacts } from "../artifacts";

describe("extractArtifacts", () => {
  it("extrait un bloc HTML en artefact kind=html et le retire du markdown", () => {
    const md = [
      "Voici la page :",
      "",
      "```html",
      "<!doctype html>",
      "<html><head><title>Notes App</title></head>",
      "<body><h1>Bonjour</h1></body></html>",
      "```",
    ].join("\n");
    const { text, artifacts } = extractArtifacts(md);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].kind).toBe("html");
    expect(artifacts[0].title).toBe("notes-app.html");
    expect(artifacts[0].content).toContain("<!doctype html>");
    expect(text).not.toContain("<!doctype html>");
  });

  it("ignore les petits blocs de code", () => {
    const md = "Texte\n\n```js\nconst a = 1;\n```\n\nFin.";
    const { text, artifacts } = extractArtifacts(md);
    expect(artifacts).toHaveLength(0);
    expect(text).toContain("const a = 1;");
  });

  it("promeut un long bloc non-HTML en artefact kind=code", () => {
    const body = Array.from({ length: 15 }, (_, i) => `line ${i} = ${i};`).join("\n");
    const md = "```python\n" + body + "\n```";
    const { artifacts } = extractArtifacts(md);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].kind).toBe("code");
    expect(artifacts[0].language).toBe("python");
    expect(artifacts[0].title).toBe("script.py");
  });

  it("limite le nombre d'artefacts par message", () => {
    const block =
      "```js\n" +
      Array.from({ length: 12 }, (_, i) => `x${i} = ${i};`).join("\n") +
      "\n```";
    const md = [block, block, block, block, block, block].join("\n\n");
    const { artifacts } = extractArtifacts(md);
    expect(artifacts.length).toBeLessThanOrEqual(4);
  });
});
