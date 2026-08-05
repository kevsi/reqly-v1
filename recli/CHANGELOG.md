# Changelog

All notable changes to **recli** are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project aims
for [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **Postman compatibility**
  - `import-postman <file>`: converts Postman collections (v2.0/v2.1) into a
    recli bundle — folders, bearer/basic/api-key/OAuth2 auth, raw/urlencoded/
    formdata/graphql bodies, collection variables, and pre/test events preserved
    as scripts.
  - `--env-file` on `import-postman`: imports a `.postman_environment.json`
    companion file into the bundle's environments.
  - Native `pm.*` sandbox: `pm.test`, `pm.expect` (Chai-lite), `pm.response`
    (with `.to.have.status/header/body/jsonBody` and `.to.be.ok/error/...`),
    `pm.sendRequest` (promise + callback, formdata/urlencoded/raw bodies, awaited
    before the main request), `pm.environment`, `pm.variables` (+`replaceIn`),
    `pm.collectionVariables`, `pm.globals`, `pm.cookies`.
  - Legacy Postman sandbox v1: `tests[...] = bool`, `responseCode`,
    `postman.setEnvironmentVariable`, `responseBody`, `responseHeaders`,
    `responseTime`.
  - ~30 Newman-compatible dynamic variables `{{$guid}}`, `{{$timestamp}}`,
    `{{$randomInt}}`, … with a per-request cache.

- **Full-screen TUI** (`recli ui`) — zero dependencies:
  - request list with colored method badges, status dots and assertion counts,
  - live search with match highlighting (`/`, `Esc` keeps the filter),
  - inspect mode (`Space`) without running the request,
  - detail view with Body / Headers / Assertions tabs (`b`/`h`/`a` or `Tab`),
  - run single, run all filtered (`a`), environment picker (`e`), help (`h`),
  - clean terminal-state restoration on exit (SIGINT/SIGTERM/EPIPE handled).

- **MCP server** (`recli serve`):
  - name↔id bridge: bundles loaded from disk (name-addressed) get stable ids on
    load so agents can run requests by name or id; a name that matches exactly
    one request resolves (ambiguous names stay unresolved to protect mutations),
  - variables are interpolated **before** the SSRF check (URLs like
    `{{BASE_URL}}/posts` are no longer blocked as "Invalid URL"),
  - `--allow-local-hosts` wired through the CLI, TUI and MCP.

- **CLI plumbing**
  - `-o` short alias for `--output` on all global options.
  - `contract <spec> <collection>`, `generate <spec>` (edge-case test
    generation), OpenAPI diff.

### Changed

- SSRF guard extracted to `src/netguard.ts` (shared by the runner, the MCP
  runner and `pm.sendRequest`).
- `ExportBundle.variables` (always-on collection variables) supported by the
  runner and validator.
- Reporter output now surfaces `pm.test` failure messages (secrets redacted).

### Fixed

- Validator rejected `GRAPHQL` requests while the runner and `init --graphql`
  supported them — aligned.
- `diff` silently ignored duplicate request names — now consumes one `after`
  entry per name.
- `pm.sendRequest` in a pre-request script raced the main request (the OAuth2
  token dance set variables too late) — in-flight calls are now awaited.

### Added (tests)

- Real Xero OAuth 2.0 collection fixture (`test/fixtures/`) and a full
  import → run → assertions integration test against a local OAuth2 mock.
- 260 unit/integration tests across the runner, sandbox, importer, TUI, MCP
  store and OpenAPI toolchain.
