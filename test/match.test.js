// Unit tests for host pattern matching (findCredential in extension/store.js).
// Run: node --test test/*.test.js
// (Not `node --test test/`: that would also run test/server.js, which never exits.)
//
// store.js is a plain browser script, not a module, so it's evaluated in a vm
// context and its globals are read back from that context.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// `browser` is a stub whose behavior individual tests set (see the
// currentSiteHostKey and vault tests at the bottom).
const browser = { tabs: {}, runtime: {} };
const ctx = vm.createContext({ URL, browser });
vm.runInContext(fs.readFileSync(path.join(__dirname, "../extension/store.js"), "utf8"), ctx);
const { findCredential, normalizePattern, isValidPattern, hostKeyFromUrl, currentSiteHostKey, vault } = ctx;

// One saved entry per pattern kind; the username names which entry matched.
const all = {
  "example.com": { username: "exact", password: "" },
  "localhost:8080": { username: "port", password: "" },
  "*.example.com": { username: "wild", password: "" },
  "api.*.example.com": { username: "wild-longer", password: "" },
  "*.dev.test:8443": { username: "wild-port", password: "" },
  "/^stage\\d+\\.corp$/": { username: "regex", password: "" },
};
/**
 * Looks up `host` in `all` and returns which entry answered.
 *
 * @param {string} host    Hostname being challenged.
 * @param {number|string} port  Port as Firefox reports it (-1/"" = default).
 * @param {string} scheme  "http" or "https" (default "https").
 * @returns {string|null} The matching entry's username, or null for no match.
 */
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

test("a stored regex that doesn't compile is skipped, not fatal", () => {
  const broken = { "/[/": { username: "broken" }, "*.ok.test": { username: "wild" } };
  assert.strictEqual(findCredential(broken, "a.ok.test", -1, "https")?.username, "wild");
  assert.strictEqual(findCredential(broken, "other.test", -1, "https"), null);
});

test("unanchored regex matches substrings", () => {
  const loose = { "/staging/": { username: "loose" } };
  assert.strictEqual(findCredential(loose, "app.staging.example", -1, "https")?.username, "loose");
});

test("normalizePattern trims and lowercases, except regexes", () => {
  assert.strictEqual(normalizePattern("  WWW.Example.COM:8080 "), "www.example.com:8080");
  assert.strictEqual(normalizePattern(" *.Example.com"), "*.example.com");
  assert.strictEqual(normalizePattern(" /^Dev\\D+$/ "), "/^Dev\\D+$/");
});

test("isValidPattern only rejects broken regexes", () => {
  assert.strictEqual(isValidPattern("example.com"), true);
  assert.strictEqual(isValidPattern("*.example.com"), true);
  assert.strictEqual(isValidPattern("/^dev\\d+$/"), true);
  assert.strictEqual(isValidPattern("/[/"), false);
  assert.strictEqual(isValidPattern("/(/"), false);
});

test("hostKeyFromUrl drops default ports and lowercases", () => {
  assert.strictEqual(hostKeyFromUrl("https://WWW.Example.com/path"), "www.example.com");
  assert.strictEqual(hostKeyFromUrl("https://example.com:443/"), "example.com");
  assert.strictEqual(hostKeyFromUrl("http://example.com:80/"), "example.com");
  assert.strictEqual(hostKeyFromUrl("https://example.com:80/"), "example.com:80");
  assert.strictEqual(hostKeyFromUrl("http://localhost:8765/x?y"), "localhost:8765");
  assert.throws(() => hostKeyFromUrl("not a url"));
});

test("currentSiteHostKey picks the most recent web tab", async () => {
  browser.tabs.query = async () => [
    { url: "moz-extension://abc/options.html", lastAccessed: 300 },
    { url: "about:addons", lastAccessed: 250 },
    { url: "https://older.example/", lastAccessed: 100 },
    { url: "http://newer.example:8080/", lastAccessed: 200 },
    { lastAccessed: 400 }, // no url (e.g. no tabs permission for it)
  ];
  assert.strictEqual(await currentSiteHostKey(), "newer.example:8080");

  browser.tabs.query = async () => [{ url: "about:blank", lastAccessed: 1 }];
  assert.strictEqual(await currentSiteHostKey(), null);
});

test("vault() sends { type, ...payload } to the background", async () => {
  const sent = [];
  browser.runtime.sendMessage = async (message) => {
    sent.push(message);
    return "ok";
  };
  assert.strictEqual(await vault("save", { pattern: "a", username: "u", password: "p" }), "ok");
  await vault("status");
  assert.deepStrictEqual(JSON.parse(JSON.stringify(sent)), [
    { type: "save", pattern: "a", username: "u", password: "p" },
    { type: "status" },
  ]);
});
