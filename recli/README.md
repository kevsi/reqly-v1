# Recli

**The API testing CLI that wrecks Newman.** Run, assert, chain and report your API
collections — from the terminal, in CI, or through an AI agent.

Recli reads simple JSON collections, runs them against real endpoints, verifies
them with text assertions or Postman-style `pm.test()` scripts, chains responses
into later requests, and reports the outcome in every format your pipeline wants.
It also ships a **full-screen interactive TUI** and a **Model Context Protocol (MCP)
server** so an AI assistant can run and edit your collections.

Recli est distribué via l'application desktop Reqly (sidecar Tauri) et via
le dépôt source :

```bash
git clone https://github.com/kevsi/reqly-v1
cd reqly-v1/recli && pnpm install && pnpm build
node dist/index.js --help
```

> Note : le nom `recli` sur npm appartient à un projet sans rapport ; ce CLI
> n'est pas publié sur le registre npm.

---

## Highlights

| Capability                       | Why it matters                                                                |
| -------------------------------- | ----------------------------------------------------------------------------- |
| **Full-screen TUI** (`recli ui`) | browse, search, inspect and run requests interactively — zero dependencies    |
| **Postman compatible**           | `import-postman` loads real collections; `pm.*` scripts run natively          |
| **Dynamic variables**            | `{{$guid}}`, `{{$timestamp}}`, `{{$randomInt}}`… ~30 Newman generators        |
| **Chaining**                     | capture `{{var}}` from a response and inject it into later requests           |
| **MCP server** (`recli serve`)   | Claude, Cursor, VS Code… can run and manage your collections by name or id    |
| **OpenAPI**                      | import specs, contract-test responses, generate edge-case tests               |
| **Security first**               | SSRF guard (blocks cloud-metadata/private targets), sandboxed scripts         |
| **CI-ready**                     | `cli`/`json`/`junit`/`html` reporters, exit code 1 on failures, GitHub Action |

## Quick start

```bash
# Scaffold a demo collection, then explore it in the TUI
recli init demo
recli ui demo.json

# Run everything, fail the build if anything fails
recli run demo.json --env prod
# → 6 passed, 3 failed in 5.4s   (exit code 1)
```

## Commands

| Command                              | What it does                                                                             |
| ------------------------------------ | ---------------------------------------------------------------------------------------- |
| `recli run <file...>`                | Run one or more collections (`--request`, `--parallel`, `--bail`, `--retries`, `--env`…) |
| `recli ui <file>`                    | Interactive full-screen TUI                                                              |
| `recli import-postman <file>`        | Convert a Postman collection (v2.0/v2.1) into a recli bundle                             |
| `recli validate <file>`              | Validate the bundle format                                                               |
| `recli init [name]`                  | Scaffold a collection (`--graphql`)                                                      |
| `recli export <file>`                | Export requests as `curl` commands                                                       |
| `recli watch <file>`                 | Re-run automatically on every file change                                                |
| `recli openapi [file]`               | Import an OpenAPI spec (`--run`, `--from-url`, `--diff`)                                 |
| `recli diff <before> <after>`        | Compare two result files                                                                 |
| `recli contract <spec> <collection>` | Validate responses against an OpenAPI schema                                             |
| `recli generate <spec>`              | Generate edge-case tests from an OpenAPI spec                                            |
| `recli graphql <endpoint>`           | One-off GraphQL query (`--query`)                                                        |
| `recli serve`                        | Start the MCP server for AI agents                                                       |

Shared options (any command): `--env <name>`, `--timeout <ms>`, `--no-color`,
`--json`, `--parallel`, `--delay <ms>`, `--iterations <n>`, `--data <file>`,
`--reporter <cli|json|junit|html>`, `-o/--output <path>`, `--snapshot` /
`--update-snapshots`, `--dotenv <file>`, `--bail`, `--retries <n>`,
`--retry-on <codes>`, `--retry-delay <ms>`, `--allow-local-hosts`.

Configuration can live in `.reclirc`, `.reclirc.json`, `recli.config.json` or
`.reclirc.yaml`, discovered from the current directory upward.

## Running requests

```bash
# Run one request by name
recli run demo.json --request "List posts"

# JSON output for CI
recli run demo.json --env prod --json

# JUnit report
recli run demo.json --env prod --reporter junit --output junit.xml
```

### Assertions

Plain-text expressions, evaluated against the response:

```jsonc
"assert": [
  { "name": "status is 200",  "expr": "status == 200" },
  { "name": "returns posts",   "expr": "body.length >= 1" },
  { "name": "title matches",   "expr": "body[0].title != null" }
]
```

Available targets: `status`, `statusText`, `duration`, `size`, `body.<jsonpath>`
(e.g. `body.user.name`, `body[0].id`), `headers.<name>`. Operators: `==`, `!=`,
`>`, `>=`, `<`, `<=`, `in`, `contains`, `matches`, `exists`.

### Chaining

Capture a value from a response and inject it into later requests:

```jsonc
"capture": [{ "name": "firstPostId", "expr": "body[0].id" }],
// later request URL:  {{BASE_URL}}/posts/{{firstPostId}}
```

Captures set variables for all subsequent requests in the run.

### Dynamic variables

Newman-compatible `{{$...}}` generators, cached per request so the URL, headers
and body of one request agree: `$guid`, `$randomUUID`, `$timestamp`,
`$isoTimestamp`, `$randomInt`, `$randomAlphaNumeric`, `$randomEmail`,
`$randomUserName`, `$randomFirstName`, `$randomLastName`, `$randomFullName`,
`$randomPassword`, `$randomPhoneNumber`, `$randomCity`, `$randomCountry`,
`$randomCountryCode`, `$randomStreet`, `$randomStreetAddress`, `$randomZipCode`,
`$randomLatitude`, `$randomLongitude`, `$randomHexColor`, `$randomColor`,
`$randomIP`, `$randomIPv6`, `$randomWords`, `$randomSentence`, `$randomParagraph`,
`$randomAbbreviation`, `$randomCurrencyCode`, `$randomCurrencyName`,
`$randomCurrencySymbol`, `$randomCreditCardNumber`, `$randomProduct`.

### Environments & variables

- **Environments** live in the bundle under `environments: [{ name, variables }]`;
  select one with `--env <name>` or the `e` key in the TUI.
- **Always-on variables** under `variables` (Postman collection variables) apply
  to every request.
- **`.env` files** via `--dotenv <file>`.
- **`process.env`** is the last-resort fallback for unknown `{{var}}`.

## The TUI

`recli ui <file>` gives you a full-screen, zero-dependency terminal UI:

| Key                    | Action                                                                           |
| ---------------------- | -------------------------------------------------------------------------------- |
| `↑`/`↓`, `PgUp`/`PgDn` | navigate the request list                                                        |
| `/`                    | live search with match highlighting (`Esc` keeps the filter, `Ctrl+W` clears it) |
| `Space`/`i`            | inspect a request definition **without running it**                              |
| `Enter`/`r`            | run the request → detail view                                                    |
| `b`/`h`/`a`, `Tab`     | Body / Headers / Assertions tabs (kept across reruns)                            |
| `n`/`p`                | next/previous request in the detail view                                         |
| `a`                    | run all **filtered** requests with live spinners                                 |
| `e`                    | switch environment                                                               |
| `h` / `q` / `Ctrl+C`   | help / quit (terminal state restored cleanly)                                    |

## Postman compatibility

```bash
# Import a collection and its companion environment file
recli import-postman collection.json --env-file environment.postman_environment.json

# Run the imported bundle — pm.* scripts run natively
recli run collection.recli.json --env "OAuth 2.0"
```

### The `pm.*` sandbox

Imported Postman test/pre-request scripts are executed as-is against a
`node:vm` sandbox implementing the Postman scripting API:

- `pm.test(name, fn)` / `pm.expect(...)` with a Chai-lite assertion chain
  (`.to.equal`, `.deep.equal`, `.include`, `.match`, `.property`, `.lengthOf`,
  `.oneOf`, `.to.be.true/ok/empty`, `.not`, `.deep`…)
- `pm.response` — `.code`, `.status`, `.json()`, `.text()`, `.responseTime`,
  `.headers`, plus `pm.response.to.have.status/header/body/jsonBody` and
  `pm.response.to.be.ok/error/clientError/serverError/redirection`
- `pm.sendRequest(url, cb)` / `pm.sendRequest({ url, method, header, body })`
  — promise **and** callback styles; formdata/urlencoded/raw bodies; awaited
  before the main request fires (the OAuth2 token dance works)
- `pm.environment`, `pm.variables` (+ `replaceIn`), `pm.collectionVariables`,
  `pm.globals` — with Postman scope resolution
- `pm.cookies` — response cookies
- Legacy sandbox v1: `tests["name"] = bool`, `responseCode.code`,
  `postman.setEnvironmentVariable`, `responseBody`, `responseHeaders`

Security: the sandbox exposes no `require`, `process`, `fetch`, timers or global
constructors; `pm.sendRequest` goes through the same SSRF guard as everything
else.

### Known limits

- Multipart `form-data` file uploads are skipped with a warning (text fields are
  urlencoded).
- `postman.setNextRequest` (flow control) throws a clear error instead of
  silently diverging.
- `pm.response.to.have.jsonSchema` is not implemented — use recli's native
  JSON Schema assertions (`contract`).

## AI agents (MCP)

`recli serve` exposes **60+ tools** (run requests, import/export bundles, manage
collections, generate tests, analyze projects…) over two transports:

```bash
# stdio (default) — for Claude Desktop / Cursor / VS Code
recli serve --file demo.json --env prod

# HTTP for remote clients
recli serve --file demo.json --port 4000
# → MCP server listening on http://127.0.0.1:4000/mcp
```

Claude Desktop:

```bash
claude mcp add recli -- node /absolute/path/to/recli/dist/index.js serve --file demo.json
```

Bundles loaded from disk are **name-addressed** by the CLI; the MCP server
assigns stable ids on load (`col-…`, `req-…`) so agents can address requests by
id **or** name (`request_id: "List posts"` works). Use `--allow-local-hosts` if
collections target local servers.

## OpenAPI toolchain

```bash
# Import a spec and diff it against an existing collection
recli openapi spec.json --diff my-collection.json

# Contract-test a collection against the spec
recli contract spec.json my-collection.json

# Generate edge-case tests from the spec
recli generate spec.json
```

## Security

- **SSRF guard** — private/reserved ranges (RFC1918, loopback, link-local,
  cloud-metadata `169.254.169.254`, CGNAT, documentation, multicast…) and
  DNS-rebinding checks are enforced before any request, including
  `pm.sendRequest`. Opt out for local development with `--allow-local-hosts`.
- **Sandboxed scripts** — `node:vm` with a whitelist; no filesystem, network or
  process access outside the request APIs.
- **Secrets** — a `check-secrets.mjs` hook (committed, run on pre-commit) scans
  for common credential patterns.

## CI

Use the bundled GitHub Action to run collections in your pipeline:

```yaml
- uses: kevsi/apiPlayground/.github/actions/recli-action@main
  with:
    collection: collections/api.json
    env: prod
    reporter: junit
    output: recli-report.xml
```

Exit code is `1` when any request fails, so a plain `recli run` in a script is
already a passing/failing gate.

## Comparison with Newman

|                                             | recli                   | Newman                 |
| ------------------------------------------- | ----------------------- | ---------------------- |
| Interactive TUI                             | ✅ full-screen          | ❌ headless runner     |
| Parallel execution                          | ✅ `--parallel`         | ❌ sequential          |
| Retries / backoff                           | ✅ `--retries` + jitter | ❌                     |
| SSRF protection                             | ✅                      | ❌                     |
| Snapshot testing                            | ✅                      | ❌                     |
| OpenAPI import / diff / contract / test-gen | ✅                      | ❌ (ecosystem plugins) |
| MCP server for AI agents                    | ✅                      | ❌                     |
| Postman collection import                   | ✅ `import-postman`     | native format          |
| `pm.*` scripts                              | ✅ native sandbox       | ✅ native              |
| `{{$…}}` dynamic variables                  | ✅ ~30 generators       | ✅                     |
| Reporters (cli/json/junit/html)             | ✅                      | via plugins            |
| Secret redaction                            | ✅                      | ❌                     |

## Development

```bash
cd recli
pnpm dev -- <command>   # run against TypeScript sources
pnpm test               # 260 unit/integration tests (vitest)
pnpm build              # compile to dist/
```

Key areas: `src/runner.ts` (execution, retries, snapshots), `src/scripting.ts`
(the `pm.*` sandbox), `src/postman-import.ts` (Postman importer),
`src/tui/` (the terminal UI), `src/mcp/` (the MCP server + store), and
`packages/shared/src/types.ts` (the canonical bundle format shared with reqy-web).

## License

See the repository license. Published package metadata is configured in
`package.json`.
