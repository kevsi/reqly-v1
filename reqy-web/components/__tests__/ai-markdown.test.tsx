import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { AiMarkdown } from "@/src/ai/components/ai-markdown";

afterEach(() => {
  cleanup();
});

describe("AiMarkdown", () => {
  it("renders bold text instead of raw asterisks", () => {
    render(<AiMarkdown content="Salut ! **Créer des collections**" />);
    expect(screen.queryByText(/\*\*/)).toBeNull();
    const strong = document.querySelector("strong");
    expect(strong?.textContent).toBe("Créer des collections");
  });

  it("renders bullet lists as <li> elements", () => {
    render(<AiMarkdown content={"- **Créer des collections**\n- Exécuter des requêtes"} />);
    expect(screen.getAllByRole("listitem").length).toBe(2);
  });

  it("renders inline code and fenced code blocks", () => {
    const { container } = render(
      <AiMarkdown content={"Appelle `GET /users`.\n\n```js\nfetch('/api')\n```"} />,
    );
    // Inline code
    expect(container.querySelectorAll("code").length).toBeGreaterThan(0);
    // Fenced block → <pre> wrapper
    expect(container.querySelector("pre")).toBeTruthy();
  });

  it("opens links in a new tab safely", () => {
    const { container } = render(<AiMarkdown content="Voir [la doc](https://reqly.dev)" />);
    const link = container.querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://reqly.dev");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toContain("noopener");
  });

  it("turns a single newline into a line break (remark-breaks)", () => {
    const { container } = render(<AiMarkdown content={"ligne une\nligne deux"} />);
    expect(container.querySelector("br")).toBeTruthy();
  });

  it("renders gfm tables", () => {
    const { container } = render(<AiMarkdown content={"| a | b |\n|---|---|\n| 1 | 2 |"} />);
    expect(container.querySelector("table")).toBeTruthy();
    expect(container.querySelectorAll("th").length).toBe(2);
  });
});
