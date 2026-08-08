export interface MockEndpoint {
  id: string;
  name: string;
  method: string;
  path: string;
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  delay?: number; // ms
  enabled: boolean;
  createdAt: string;
  source?: "capture" | "manual";
}

export interface MockServerConfig {
  port: number;
  baseUrl?: string;
  cors: boolean;
  logRequests: boolean;
}

export interface MockRequest {
  id: string;
  timestamp: string;
  method: string;
  path: string;
  headers: Record<string, string>;
  body?: string;
  matchedEndpointId?: string;
}
