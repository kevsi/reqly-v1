/**
 * Parse utilities for the AI sidebar.
 * Extracts HTTP method + URL from user messages and AI responses.
 */

/** Extract HTTP method + URL from a user message like "GET /api/users" or "Execute POST /api/data" */
export function parseRequestFromMessage(msg: string): { method: string; url: string } | null {
  // Pattern 1: METHOD URL (e.g., "GET https://google.com", "POST /api/users")
  const pattern1 = /\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(https?:\/\/[^\s]+|\/[^\s]+)/i;
  const match1 = msg.match(pattern1);
  if (match1) {
    return { method: match1[1].toUpperCase(), url: match1[2].trim() };
  }

  // Pattern 2: "vers URL" / "to URL" / "url: URL" (method defaults to GET)
  const pattern2 = /(?:vers|to|url\s*:?)\s*(https?:\/\/[^\s]+)/i;
  const match2 = msg.match(pattern2);
  if (match2) {
    return { method: "GET", url: match2[1].trim() };
  }

  // Pattern 3: Bare URL anywhere in the message (method defaults to GET)
  const pattern3 = /(https?:\/\/[^\s]+)/i;
  const match3 = msg.match(pattern3);
  if (match3) {
    return { method: "GET", url: match3[1].trim() };
  }

  // Pattern 4: Domain with TLD (e.g., "google.com", "api.example.org") — prepend https://
  const pattern4 = /\b([a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.[a-zA-Z]{2,})(?:\/\S*)?\b/;
  const match4 = msg.match(pattern4);
  if (match4) {
    let domain = match4[1];
    if (match4[0].includes("/")) {
      domain = match4[0]; // includes path
    }
    return { method: "GET", url: `https://${domain}` };
  }

  return null;
}

/**
 * Parse the AI's response text for structured action data (JSON blocks
 * containing method + url). This lets the AI describe a request in natural
 * language and the system executes it for real.
 */
export function parseActionsFromAIResponse(text: string): Array<{ method: string; url: string }> | null {
  // Pattern: ```json { ... "url": "...", "method": "..." } ```
  const jsonBlockPattern = /```(?:json)?\s*\n?(\{[\s\S]*?"(?:url|method)[\s\S]*?\})\n?\s*```/i;
  const match = text.match(jsonBlockPattern);
  if (match) {
    try {
      const data = JSON.parse(match[1]);
      if (data.url) {
        return [{ method: (data.method || "GET").toUpperCase(), url: data.url }];
      }
    } catch {
      // invalid JSON in AI response — ignore
    }
  }

  // Fallback: extract any https?:// URL from backtick-wrapped text
  const backtickUrlPattern = /`(https?:\/\/[^\s`]+)`/g;
  const urls: string[] = [];
  let btMatch;
  while ((btMatch = backtickUrlPattern.exec(text)) !== null) {
    urls.push(btMatch[1].trim());
  }
  if (urls.length > 0) {
    return urls.map((url) => ({ method: "GET", url }));
  }

  return null;
}
