import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

// Give each test file its own on-disk DB. Vitest isolates modules per test
// file, so this setup (run before the test file's imports) yields a fresh,
// file-backed database per file — keeping tests isolated and letting the
// WAL/foreign-key pragmas behave exactly as in production.
process.env.REQLY_DB_PATH = path.join(os.tmpdir(), `reqly-sync-${randomUUID()}.db`);
