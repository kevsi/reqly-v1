export type User = {
  id: string;
  email: string;
  name: string;
};

export type Endpoint = {
  id: number;
  userId: string;
  slug: string;
  name: string;
  secret: string | null;
  notify: boolean;
  createdAt: number;
};

export type WebhookEvent = {
  id: number;
  userId: string;
  endpointId: number;
  method: string;
  headers: Record<string, string>;
  query: string | null;
  body: string | null;
  contentType: string | null;
  sourceIp: string | null;
  replayedFromId: number | null;
  createdAt: number;
};

export type Device = {
  id: number;
  userId: string;
  expoPushToken: string;
  platform: string | null;
  deviceName: string | null;
  createdAt: number;
  lastSeenAt: number;
};

export type AuthSession = {
  token: string;
  user: User;
};
