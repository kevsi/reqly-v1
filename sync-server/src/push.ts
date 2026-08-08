import db from "./db.js";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

export type PushMessage = {
  title: string;
  body: string;
  data?: Record<string, unknown>;
};

type ExpoPushMessage = {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound: "default";
  priority: "high";
};

/**
 * Send an Expo push notification to every device registered by a user.
 * Returns the number of devices targeted. Failures are swallowed so that a
 * push error never blocks the webhook ingest response.
 */
export async function sendPushToUser(userId: string, message: PushMessage) {
  const rows = db
    .prepare("SELECT expo_push_token FROM hooklet_devices WHERE user_id = ?")
    .all(userId) as Array<{ expo_push_token: string }>;

  const tokens = rows
    .map((r) => r.expo_push_token)
    .filter((t) => t.startsWith("ExponentPushToken") || t.startsWith("ExpoPushToken"));

  if (tokens.length === 0) return 0;

  const messages: ExpoPushMessage[] = tokens.map((to) => ({
    to,
    title: message.title,
    body: message.body,
    data: message.data,
    sound: "default",
    priority: "high",
  }));

  try {
    // AbortSignal.timeout: a hung Expo endpoint must not stall webhook ingest.
    await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(messages),
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    console.error("[hooklet] Expo push send failed:", err);
  }

  return tokens.length;
}
