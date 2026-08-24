import http from "node:http";
import type { MockConfig, RecordedRequest } from "./types.js";
export interface MockServerOptions {
    /** Called for every completed request (CLI logs, TUI, tests). */
    onRequest?: (record: RecordedRequest) => void;
    /** Cap on captured request/response bodies kept in memory. */
    maxRecordings?: number;
    /** Cap on incoming body size. Default 1 MB. */
    maxBodyBytes?: number;
    /**
     * Enables the control channel (/mock/__admin/*) protected by this token.
     * When absent the channel does not exist (fail-closed).
     */
    adminToken?: string;
    /** Extra origins allowed to call the admin channel (in addition to loopback apps + Tauri). */
    adminAllowedOrigins?: string[];
}
export interface MockServerHandle {
    server: http.Server;
    /** Swap the active config at runtime (hot reload without restart). */
    replaceConfig(next: MockConfig): void;
    /** Wipe the stateful store + recordings (POST /mock/reset does the same). */
    reset(): void;
    recordings(): readonly RecordedRequest[];
    close(): Promise<void>;
    /** Actual bound port (useful when config.port is 0). */
    port(): number | undefined;
}
export declare function createMockServer(initialConfig: MockConfig, options?: MockServerOptions): MockServerHandle;
//# sourceMappingURL=server.d.ts.map