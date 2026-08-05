import { describe, expect, it } from "vitest";
import type { Environment, ExportBundle, RequestItem } from "../types.js";
import type { KeyInfo } from "./keypress.js";
import {
  buildEnvVars,
  filterRequests,
  fitToCols,
  fmtBytes,
  methodStyle,
  prettyBody,
  statusStyle,
  stripAnsi,
  truncate,
  Tui,
} from "./screen.js";

function req(name: string, url: string, method = "GET"): RequestItem {
  return { name, method: method as RequestItem["method"], url };
}

describe("truncate", () => {
  it("keeps short strings intact", () => {
    expect(truncate("hello", 10)).toBe("hello");
  });
  it("ellipsizes long strings", () => {
    expect(truncate("abcdefghij", 5)).toBe("abcd…");
  });
});

describe("stripAnsi / fitToCols", () => {
  it("strips ANSI codes", () => {
    expect(stripAnsi("\x1b[32mgreen\x1b[0m")).toBe("green");
  });
  it("keeps styled strings within budget and truncates past it", () => {
    const styled = `\x1b[32m${"x".repeat(20)}\x1b[0m`;
    expect(fitToCols(styled, 30)).toBe(styled);
    expect(fitToCols(styled, 5)).toBe("xxxx…");
  });
});

describe("fmtBytes", () => {
  it("formats bytes/KB/MB", () => {
    expect(fmtBytes(512)).toBe("512B");
    expect(fmtBytes(2048)).toBe("2.0KB");
    expect(fmtBytes(5 * 1024 * 1024)).toBe("5.0MB");
  });
});

describe("filterRequests", () => {
  const requests = [
    req("List users", "https://api.example.com/users"),
    req("Create user", "https://api.example.com/users"),
    req("Health", "https://api.example.com/health"),
  ];
  it("returns everything for an empty query", () => {
    expect(filterRequests(requests, "  ")).toHaveLength(3);
  });
  it("matches by name (case-insensitive)", () => {
    expect(filterRequests(requests, "health")).toHaveLength(1);
  });
  it("matches by URL", () => {
    expect(filterRequests(requests, "/users")).toHaveLength(2);
  });
});

describe("methodStyle / statusStyle", () => {
  it("returns chalk functions that color the method", () => {
    expect(stripAnsi(methodStyle("GET")("GET"))).toBe("GET");
    expect(stripAnsi(methodStyle("DELETE")("DELETE"))).toBe("DELETE");
    expect(stripAnsi(statusStyle(200)("200"))).toBe("200");
    expect(stripAnsi(statusStyle(500)("500"))).toBe("500");
  });
});

describe("prettyBody", () => {
  it("pretty-prints JSON", () => {
    const out = prettyBody('{"a":1,"b":[1,2]}', 40);
    expect(out).toContain('"a": 1');
    expect(out.split("\n").length).toBeGreaterThan(1);
  });
  it("keeps raw text as-is", () => {
    expect(prettyBody("plain text", 40)).toBe("plain text");
  });
  it("truncates long bodies with a line count note", () => {
    const out = prettyBody(JSON.stringify({ items: Array.from({ length: 100 }, (_, i) => i) }), 10);
    expect(out).toContain("more lines");
  });
  it("handles empty bodies", () => {
    expect(prettyBody(undefined, 40)).toBe("(no body)");
  });
});

describe("buildEnvVars", () => {
  it("only includes enabled variables", () => {
    const env: Environment = {
      name: "dev",
      variables: [
        { key: "BASE_URL", value: "http://localhost:3000", enabled: true },
        { key: "SECRET", value: "hunter2", enabled: false },
      ],
    };
    const vars = buildEnvVars(env);
    expect(vars.get("BASE_URL")).toBe("http://localhost:3000");
    expect(vars.has("SECRET")).toBe(false);
  });
  it("returns an empty map without an environment", () => {
    expect(buildEnvVars(undefined).size).toBe(0);
  });
});

describe("Tui interactions (smoke, no network)", () => {
  const bundle: ExportBundle = {
    collections: [
      {
        name: "Demo",
        requests: [
          req("List users", "https://api.example.com/users"),
          req("Create user", "https://api.example.com/users"),
          req("Health", "https://api.example.com/health"),
        ],
      },
    ],
    environments: [
      {
        name: "dev",
        variables: [{ key: "BASE_URL", value: "http://localhost:3000", enabled: true }],
      },
    ],
  };

  function key(name: string): KeyInfo {
    return { name, ctrl: false, shift: false, meta: false, sequence: name };
  }

  it("navigates, searches, and switches environments", () => {
    const tui = new Tui(bundle) as unknown as {
      cursor: number;
      mode: string;
      filter: string;
      filtered: RequestItem[];
      envIndex: number;
      onKey(k: KeyInfo): void;
    };
    tui.onKey(key("down"));
    tui.onKey(key("down"));
    expect(tui.cursor).toBe(2);
    tui.onKey(key("g"));
    expect(tui.cursor).toBe(0);

    tui.onKey(key("/"));
    expect(tui.mode).toBe("search");
    for (const ch of "health") tui.onKey(key(ch));
    expect(tui.filter).toBe("health");
    expect(tui.filtered).toHaveLength(1);
    tui.onKey(key("backspace"));
    expect(tui.filter).toBe("healt");
    tui.onKey(key("escape"));
    expect(tui.mode).toBe("list");
    // Esc keeps the filter (fzf-like); Ctrl+W clears it from within search.
    expect(tui.filter).toBe("healt");
    expect(tui.filtered).toHaveLength(1);
    tui.onKey(key("/"));
    tui.onKey({ name: "w", ctrl: true, shift: false, meta: false, sequence: "\x17" });
    tui.onKey(key("escape"));
    expect(tui.filter).toBe("");
    expect(tui.filtered).toHaveLength(3);

    tui.onKey(key("e"));
    expect(tui.mode).toBe("env");
    tui.onKey(key("return"));
    expect(tui.mode).toBe("list");
    expect(tui.envIndex).toBe(0);
  });

  it("opens the inspect view with Space/i and navigates without running", () => {
    const tui = new Tui(bundle) as unknown as {
      cursor: number;
      mode: string;
      onKey(k: KeyInfo): void;
    };
    tui.onKey(key("space"));
    expect(tui.mode).toBe("inspect");
    tui.onKey(key("n"));
    expect(tui.cursor).toBe(1);
    tui.onKey(key("escape"));
    expect(tui.mode).toBe("list");
  });

  it("renders the request definition in inspect mode", () => {
    const tui = new Tui(bundle) as unknown as { onKey(k: KeyInfo): void; render(): void };
    const writes: string[] = [];
    const orig = process.stdout.write.bind(process.stdout);
    (process.stdout as unknown as { write(s: string): boolean }).write = (s: string) => {
      writes.push(s);
      return true;
    };
    try {
      tui.onKey(key("space"));
      tui.render();
    } finally {
      (process.stdout as unknown as { write(s: string): boolean }).write = orig;
    }
    const frame = writes.join("");
    expect(frame).toContain("Method:");
    expect(frame).toContain("URL:");
    expect(frame).toContain("https://api.example.com/users");
  });

  it("renders a full frame (header, rows, shortcut bar)", () => {
    const tui = new Tui(bundle) as unknown as { render(): void };
    const writes: string[] = [];
    const orig = process.stdout.write.bind(process.stdout);
    (process.stdout as unknown as { write(s: string): boolean }).write = (s: string) => {
      writes.push(s);
      return true;
    };
    try {
      tui.render();
    } finally {
      (process.stdout as unknown as { write(s: string): boolean }).write = orig;
    }
    const frame = writes.join("");
    expect(frame.startsWith("\x1b[H\x1b[2J")).toBe(true);
    expect(frame).toContain("recli");
    expect(frame).toContain("Demo");
    expect(frame).toContain("List users");
    expect(frame).toContain("Create user");
    expect(frame).toContain("↑↓ move");
    expect(frame).toContain("● dev");
  });
});
