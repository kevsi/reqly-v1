import { describe, expect, it } from "vitest";
import type { Environment, ExportBundle, RequestItem } from "../types.js";
import type { KeyInfo } from "./keypress.js";
import {
  buildEnvVars,
  durationStyle,
  filterRequests,
  fitToCols,
  fmtBytes,
  highlightJson,
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

describe("durationStyle", () => {
  it("colors by perceived latency", async () => {
    const { default: chalk } = await import("chalk");
    const oldLevel = chalk.level;
    chalk.level = 1;
    try {
      expect(durationStyle(100)("x")).toContain("\x1b[32m");
      expect(durationStyle(1000)("x")).toContain("\x1b[33m");
      expect(durationStyle(3000)("x")).toContain("\x1b[31m");
    } finally {
      chalk.level = oldLevel;
    }
  });
});

describe("highlightJson", () => {
  it("colorizes keys, strings, numbers and booleans", async () => {
    const { default: chalk } = await import("chalk");
    const oldLevel = chalk.level;
    chalk.level = 1;
    try {
      const out = highlightJson('{"name":"John","age":30,"admin":true,"note":null}');
      // Keys → cyan, string values → green, numbers → yellow, booleans → bright magenta
      expect(out).toContain('\x1b[36m"name"\x1b[39m'); // cyan key
      expect(out).toContain('\x1b[32m"John"\x1b[39m'); // green string
      expect(out).toContain("\x1b[33m30\x1b[39m"); // yellow number
      expect(out).toContain("\x1b[95mtrue\x1b[39m"); // magentaBright boolean
      expect(out).toContain("\x1b[35mnull\x1b[39m"); // magenta null
    } finally {
      chalk.level = oldLevel;
    }
  });

  it("leaves non-JSON text untouched", () => {
    expect(highlightJson("plain text")).toBe("plain text");
  });

  it("preserves visible content after styling", () => {
    const out = highlightJson('{"a":1}');
    expect(stripAnsi(out)).toBe('{"a":1}');
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

  it("bind a (run filtered) — guarded against empty set and in-flight runs", () => {
    const tui = new Tui(bundle) as unknown as {
      mode: string;
      runningAll: boolean;
      filtered: RequestItem[];
      running: RequestItem | null;
      onKey(k: KeyInfo): void;
    };
    // "a" in list mode starts a run-all (network would run; guard on empty set is
    // what we assert here by filtering everything out first).
    tui.onKey(key("/"));
    for (const ch of "zzzz") tui.onKey(key(ch));
    tui.onKey(key("escape"));
    expect(tui.filtered).toHaveLength(0);
    tui.onKey(key("a"));
    // Empty selection: run-all must not start.
    expect(tui.runningAll).toBe(false);

    // A single Enter run in flight (running set) must not let run-all start:
    // two concurrent runs would interleave captures on the shared ctx.
    tui.filtered = bundle.collections[0]!.requests as RequestItem[];
    tui.onKey(key("/"));
    tui.onKey(key("escape")); // clear the zzzz filter
    tui.running = tui.filtered[0]!;
    tui.onKey(key("a"));
    expect(tui.runningAll).toBe(false);
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

  it("keeps the session context across runs and rebuilds it on env switch", () => {
    const tui = new Tui(bundle) as unknown as {
      ctx: { vars: Map<string, string> };
      onKey(k: KeyInfo): void;
    };
    // Session ctx is stable across sequential runs (chaining works):
    // a capture stored in ctx.vars survives the next Enter/runAll.
    const first = tui.ctx;
    tui.onKey(key("e"));
    tui.onKey(key("escape")); // cancel — must NOT rebuild ctx
    expect(tui.ctx).toBe(first);
    // Environment switch resets the ctx (fresh vars/cookies).
    tui.onKey(key("e"));
    tui.onKey(key("return"));
    expect(tui.ctx).not.toBe(first);
    expect(tui.ctx.vars.size).toBe(0);
  });
});
