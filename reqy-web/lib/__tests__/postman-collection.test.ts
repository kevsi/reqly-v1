import { describe, it, expect } from "vitest"
import { extractPostmanCollection } from "@/lib/postman"

describe("extractPostmanCollection — main bug", () => {
  it("returns ALL requests, not just the first 3", () => {
    const items = Array.from({ length: 25 }, (_, i) => ({
      name: `Request ${i + 1}`,
      request: {
        method: "GET",
        url: { raw: `https://api.example.com/r${i + 1}` },
      },
    }))
    const { requests, folders } = extractPostmanCollection(items)
    expect(requests).toHaveLength(25)
    expect(folders).toHaveLength(0)
    expect(requests[0].name).toBe("Request 1")
    expect(requests[24].name).toBe("Request 25")
  })

  it("returns empty arrays for empty input", () => {
    expect(extractPostmanCollection([])).toEqual({ folders: [], requests: [] })
    expect(extractPostmanCollection(undefined)).toEqual({
      folders: [],
      requests: [],
    })
  })
})

describe("extractPostmanCollection — folders", () => {
  it("creates folders and references them from requests via folderId", () => {
    const items = [
      {
        name: "Auth",
        item: [
          {
            name: "Login",
            request: {
              method: "POST",
              url: { raw: "https://api.example.com/login" },
            },
          },
        ],
      },
      {
        name: "Logout",
        request: {
          method: "POST",
          url: { raw: "https://api.example.com/logout" },
        },
      },
    ]
    const { folders, requests } = extractPostmanCollection(items)
    expect(folders).toHaveLength(1)
    expect(folders[0]).toMatchObject({ name: "Auth", parentId: null })
    const authFolderId = folders[0].id

    expect(requests).toHaveLength(2)
    expect(requests[0].name).toBe("Login")
    expect(requests[0].folderId).toBe(authFolderId)
    expect(requests[1].name).toBe("Logout")
    expect(requests[1].folderId).toBeNull()
  })

  it("handles nested folders with coherent parentId/folderId references", () => {
    const items = [
      {
        name: "Users",
        item: [
          {
            name: "Admin",
            item: [
              {
                name: "List admins",
                request: {
                  method: "GET",
                  url: { raw: "https://api.example.com/users/admin" },
                },
              },
            ],
          },
          {
            name: "Get user",
            request: {
              method: "GET",
              url: { raw: "https://api.example.com/users/:id" },
            },
          },
        ],
      },
    ]
    const { folders, requests } = extractPostmanCollection(items)
    expect(folders).toHaveLength(2)
    expect(folders[0]).toMatchObject({ name: "Users", parentId: null })
    expect(folders[1]).toMatchObject({
      name: "Admin",
      parentId: folders[0].id,
    })

    expect(requests).toHaveLength(2)
    // Requests are emitted in DFS pre-order
    expect(requests[0].folderId).toBe(folders[1].id) // in Admin
    expect(requests[1].folderId).toBe(folders[0].id) // in Users
  })

  it("emits folders in DFS pre-order so a client can create them sequentially", () => {
    const items = [
      {
        name: "A",
        item: [
          { name: "B", item: [{ name: "C", item: [] }] },
        ],
      },
    ]
    const { folders } = extractPostmanCollection(items)
    const names = folders.map((f) => f.name)
    expect(names).toEqual(["A", "B", "C"])
    // Each child's parentId points to its predecessor
    expect(folders[1].parentId).toBe(folders[0].id)
    expect(folders[2].parentId).toBe(folders[1].id)
  })

  it("falls back to 'Folder' when a folder has no name", () => {
    const items = [
      { item: [{ name: "Ping", request: { method: "GET", url: "/ping" } }] },
    ]
    const { folders } = extractPostmanCollection(items)
    expect(folders).toHaveLength(1)
    expect(folders[0].name).toBe("Folder")
  })
})

describe("extractPostmanCollection — body", () => {
  it("returns bodyType 'json' when raw is valid JSON", () => {
    const items = [
      {
        name: "Create user",
        request: {
          method: "POST",
          url: { raw: "https://api.example.com/users" },
          body: { mode: "raw", raw: '{"name":"alice"}' },
        },
      },
    ]
    const { requests } = extractPostmanCollection(items)
    expect(requests[0].body).toBe('{"name":"alice"}')
    expect(requests[0].bodyType).toBe("json")
  })

  it("returns bodyType 'raw' when raw is not JSON", () => {
    const items = [
      {
        name: "Echo",
        request: {
          method: "POST",
          url: "/echo",
          body: { mode: "raw", raw: "hello world" },
        },
      },
    ]
    const { requests } = extractPostmanCollection(items)
    expect(requests[0].bodyType).toBe("raw")
  })

  it("encodes urlencoded body into a URL-encoded string with bodyType 'x-www-form'", () => {
    const items = [
      {
        name: "Form",
        request: {
          method: "POST",
          url: "/form",
          body: {
            mode: "urlencoded",
            urlencoded: [
              { key: "name", value: "alice doe" },
              { key: "city", value: "Paris" },
            ],
          },
        },
      },
    ]
    const { requests } = extractPostmanCollection(items)
    expect(requests[0].bodyType).toBe("x-www-form")
    expect(requests[0].body).toContain("name=alice%20doe")
    expect(requests[0].body).toContain("city=Paris")
  })

  it("encodes formdata text fields and skips disabled and file fields", () => {
    const items = [
      {
        name: "Upload",
        request: {
          method: "POST",
          url: "/upload",
          body: {
            mode: "formdata",
            formdata: [
              { key: "title", value: "doc" },
              { key: "secret", value: "hidden", disabled: true },
              { key: "file", type: "file", src: "/tmp/x.png" },
            ],
          },
        },
      },
    ]
    const { requests } = extractPostmanCollection(items)
    expect(requests[0].bodyType).toBe("form-data")
    expect(requests[0].body).toBe("title=doc")
  })

  it("extracts GraphQL query and variables into a JSON body", () => {
    const items = [
      {
        name: "GraphQL",
        request: {
          method: "POST",
          url: "/graphql",
          body: {
            mode: "graphql",
            graphql: {
              query: "query Q { user { id } }",
              variables: '{"id":42}',
            },
          },
        },
      },
    ]
    const { requests } = extractPostmanCollection(items)
    expect(requests[0].bodyType).toBe("json")
    expect(JSON.parse(requests[0].body)).toEqual({
      query: "query Q { user { id } }",
      variables: { id: 42 },
    })
  })

  it("represents binary file bodies with a placeholder and bodyType 'binary'", () => {
    const items = [
      {
        name: "Download",
        request: {
          method: "GET",
          url: "/file.bin",
          body: { mode: "file", file: { src: "/path/to/file.bin" } },
        },
      },
    ]
    const { requests } = extractPostmanCollection(items)
    expect(requests[0].bodyType).toBe("binary")
    expect(requests[0].body).toContain("/path/to/file.bin")
  })

  it("omits bodyType when body is missing", () => {
    const items = [
      { name: "No body", request: { method: "GET", url: "/" } },
    ]
    const { requests } = extractPostmanCollection(items)
    expect(requests[0].body).toBe("")
    expect(requests[0].bodyType).toBeUndefined()
  })
})

describe("extractPostmanCollection — auth", () => {
  it("extracts bearer token", () => {
    const items = [
      {
        name: "With bearer",
        request: {
          method: "GET",
          url: "/secure",
          auth: { type: "bearer", bearer: [{ key: "token", value: "abc123" }] },
        },
      },
    ]
    const { requests } = extractPostmanCollection(items)
    expect(requests[0].authType).toBe("bearer")
    expect(requests[0].authToken).toBe("abc123")
  })

  it("extracts basic auth as base64(user:pass)", () => {
    const items = [
      {
        name: "Basic",
        request: {
          method: "GET",
          url: "/basic",
          auth: {
            type: "basic",
            basic: [
              { key: "username", value: "alice" },
              { key: "password", value: "s3cret" },
            ],
          },
        },
      },
    ]
    const { requests } = extractPostmanCollection(items)
    expect(requests[0].authType).toBe("basic")
    expect(requests[0].authToken).toBe(
      Buffer.from("alice:s3cret").toString("base64"),
    )
  })

  it("extracts apikey value", () => {
    const items = [
      {
        name: "API key",
        request: {
          method: "GET",
          url: "/key",
          auth: {
            type: "apikey",
            apikey: [
              { key: "key", value: "X-API-Key" },
              { key: "value", value: "k-123" },
              { key: "in", value: "header" },
            ],
          },
        },
      },
    ]
    const { requests } = extractPostmanCollection(items)
    expect(requests[0].authType).toBe("api-key")
    expect(requests[0].authToken).toBe("k-123")
  })

  it("extracts oauth2 accessToken", () => {
    const items = [
      {
        name: "OAuth",
        request: {
          method: "GET",
          url: "/oauth",
          auth: {
            type: "oauth2",
            oauth2: [{ key: "accessToken", value: "ya29.xxx" }],
          },
        },
      },
    ]
    const { requests } = extractPostmanCollection(items)
    expect(requests[0].authType).toBe("oauth2")
    expect(requests[0].authToken).toBe("ya29.xxx")
  })

  it("falls back to authType 'none' when auth.type is noauth", () => {
    const items = [
      {
        name: "Public",
        request: {
          method: "GET",
          url: "/public",
          auth: { type: "noauth" },
        },
      },
    ]
    const { requests } = extractPostmanCollection(items)
    expect(requests[0].authType).toBe("none")
    expect(requests[0].authToken).toBeUndefined()
  })

  it("defaults to authType 'none' when auth is missing", () => {
    const items = [
      { name: "Plain", request: { method: "GET", url: "/plain" } },
    ]
    const { requests } = extractPostmanCollection(items)
    expect(requests[0].authType).toBe("none")
    expect(requests[0].authToken).toBeUndefined()
  })
})

describe("extractPostmanCollection — URL & method edge cases", () => {
  it("normalizes methods to uppercase and falls back to GET for unknown", () => {
    const items = [
      { name: "Lower", request: { method: "get", url: "/a" } },
      { name: "Weird", request: { method: "FOOBAR", url: "/b" } },
    ]
    const { requests } = extractPostmanCollection(items)
    expect(requests[0].method).toBe("GET")
    expect(requests[1].method).toBe("GET")
  })

  it("extracts disabled query params correctly (skips them)", () => {
    const items = [
      {
        name: "Filtered",
        request: {
          method: "GET",
          url: {
            raw: "https://api.example.com/x?kept=yes",
            query: [
              { key: "kept", value: "yes" },
              { key: "dropped", value: "no", disabled: true },
              { key: "", value: "ignored" },
            ],
          },
        },
      },
    ]
    const { requests } = extractPostmanCollection(items)
    expect(requests[0].queryParams).toEqual([{ key: "kept", value: "yes" }])
  })

  it("handles url as plain string (legacy format)", () => {
    const items = [
      { name: "Legacy", request: { method: "GET", url: "https://api.example.com/legacy" } },
    ]
    const { requests } = extractPostmanCollection(items)
    expect(requests[0].url).toBe("https://api.example.com/legacy")
    expect(requests[0].queryParams).toEqual([])
  })
})
