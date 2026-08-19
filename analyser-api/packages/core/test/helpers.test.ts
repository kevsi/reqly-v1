import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractParams,
  isHttpMethod,
  joinPaths,
  makeId,
  stripQuotes,
  dedupeRoutes,
} from "../src/helpers.ts";

test("isHttpMethod", () => {
  assert.equal(isHttpMethod("get"), true);
  assert.equal(isHttpMethod("DELETE"), true);
  assert.equal(isHttpMethod("foo"), false);
});

test("extractParams", () => {
  assert.deepEqual(extractParams("/users/:id"), ["id"]);
  assert.deepEqual(extractParams("/users/{user_id}"), ["user_id"]);
  assert.deepEqual(extractParams("/api/users/[userId]"), ["userId"]);
  assert.deepEqual(extractParams("/health"), []);
});

test("joinPaths", () => {
  assert.equal(joinPaths("users", ":id"), "/users/:id");
  assert.equal(joinPaths("/users/", "/:id"), "/users/:id");
  assert.equal(joinPaths("", "/health"), "/health");
  assert.equal(joinPaths("", ""), "/");
});

test("stripQuotes", () => {
  assert.equal(stripQuotes('"/users"'), "/users");
  assert.equal(stripQuotes("'/users'"), "/users");
  assert.equal(stripQuotes("no-quotes"), "no-quotes");
});

test("makeId", () => {
  assert.equal(makeId("js", "GET", "/users", "a.ts", 3), "js:GET:/users:a.ts:3");
});

test("dedupeRoutes keeps first and sorts deterministically", () => {
  const routes = [
    { method: "POST", path: "/b", file: "x.ts", line: 5 },
    { method: "GET", path: "/a", file: "x.ts", line: 1 },
    { method: "POST", path: "/b", file: "x.ts", line: 5 },
  ];
  const out = dedupeRoutes(routes as never[]);
  assert.equal(out.length, 2);
  assert.equal(out[0]!.method, "GET");
  assert.equal(out[1]!.path, "/b");
});
