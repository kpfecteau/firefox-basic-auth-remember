// Unit tests for host pattern matching: node --test test/
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ctx = vm.createContext({ URL });
vm.runInContext(fs.readFileSync(path.join(__dirname, "../extension/store.js"), "utf8"), ctx);
const { findCredential } = ctx;

const all = {
  "example.com": { username: "exact", password: "" },
  "localhost:8080": { username: "port", password: "" },
  "*.example.com": { username: "wild", password: "" },
  "api.*.example.com": { username: "wild-longer", password: "" },
  "*.dev.test:8443": { username: "wild-port", password: "" },
  "/^stage\\d+\\.corp$/": { username: "regex", password: "" },
};
const who = (host, port, scheme = "https") => findCredential(all, host, port, scheme)?.username ?? null;

test("exact host and default port", () => {
  assert.strictEqual(who("example.com", 443), "exact");
  assert.strictEqual(who("EXAMPLE.com", 443), "exact");
});

test("default port reported as -1 or empty", () => {
  assert.strictEqual(who("example.com", -1), "exact");
  assert.strictEqual(who("example.com", ""), "exact");
  assert.strictEqual(who("www.example.com", -1), "wild");
});

test("exact host:port", () => {
  assert.strictEqual(who("localhost", 8080, "http"), "port");
  assert.strictEqual(who("localhost", 80, "http"), null);
});

test("wildcards, longest pattern wins", () => {
  assert.strictEqual(who("www.example.com", 443), "wild");
  assert.strictEqual(who("a.b.example.com", 443), "wild");
  assert.strictEqual(who("api.eu.example.com", 443), "wild-longer");
  assert.strictEqual(who("www.example.com", 8443), "wild");
  assert.strictEqual(who("notexample.com", 443), null);
});

test("wildcard with port only matches that port", () => {
  assert.strictEqual(who("app.dev.test", 8443), "wild-port");
  assert.strictEqual(who("app.dev.test", 443), null);
});

test("regex", () => {
  assert.strictEqual(who("stage12.corp", 443), "regex");
  assert.strictEqual(who("stage.corp", 443), null);
});

test("exact beats wildcard", () => {
  assert.strictEqual(who("example.com", 443), "exact");
});
