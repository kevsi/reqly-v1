import type { Page } from "@playwright/test";

interface ProxyPayload {
  url?: string;
  method?: string;
  body?: string;
}

function httpbinEcho(targetUrl: string, method: string, postData: string | undefined): string {
  const parsed = new URL(targetUrl);
  if (method.toUpperCase() === "POST" || parsed.pathname.replace(/\/+$/, "").endsWith("/post")) {
    return JSON.stringify({
      args: {},
      data: postData ?? "",
      headers: {},
      json: null,
      origin: "127.0.0.1",
      url: targetUrl,
    });
  }
  return JSON.stringify({
    args: Object.fromEntries(parsed.searchParams),
    headers: {},
    origin: "127.0.0.1",
    url: targetUrl,
  });
}

export async function mockHttpbin(page: Page): Promise<void> {
  await page.route("**/api/proxy", async (route) => {
    const request = route.request();
    let payload: ProxyPayload;
    try {
      payload = JSON.parse(request.postData() ?? "{}") as ProxyPayload;
    } catch {
      await route.fallback();
      return;
    }
    const targetUrl = payload.url ?? "";
    if (!targetUrl.includes("httpbin.org")) {
      await route.fallback();
      return;
    }

    const responseBody = httpbinEcho(targetUrl, payload.method ?? "GET", payload.body);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: 200,
        statusText: "OK",
        body: responseBody,
        headers: { "content-type": "application/json" },
        cookies: [],
        encoding: "utf8",
        durationMs: 1,
        size: responseBody.length,
        timings: { dnsMs: 0, connectMs: 0, ttfbMs: 0 },
      }),
    });
  });
}
