// Unit tests for tools/sign.js's credential loading: node --test test/*.test.js
// (Uses inline text only; never reads the real .env.amo.)
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { parseEnv, missingCredentials, main } = require("../tools/sign.js");

test("parseEnv reads KEY=VALUE, skipping comments and blanks", () => {
  const vars = parseEnv("# comment\n\nWEB_EXT_API_KEY=user:1:2\r\n  WEB_EXT_API_SECRET = abc=def  \n");
  assert.deepStrictEqual(vars, { WEB_EXT_API_KEY: "user:1:2", WEB_EXT_API_SECRET: "abc=def" });
});

test("parseEnv strips one pair of matching quotes", () => {
  assert.deepStrictEqual(parseEnv(`A="x y"\nB='z'\nC="unbalanced'`), { A: "x y", B: "z", C: `"unbalanced'` });
});

test("missingCredentials flags absent and placeholder values", () => {
  assert.deepStrictEqual(missingCredentials({}), ["WEB_EXT_API_KEY", "WEB_EXT_API_SECRET"]);
  assert.deepStrictEqual(
    missingCredentials({ WEB_EXT_API_KEY: "user:00000000:000", WEB_EXT_API_SECRET: "real" }),
    ["WEB_EXT_API_KEY"]
  );
  assert.deepStrictEqual(missingCredentials({ WEB_EXT_API_KEY: "user:1:2", WEB_EXT_API_SECRET: "real" }), []);
});

test("the template's values are treated as placeholders", () => {
  const template = parseEnv(fs.readFileSync(path.join(__dirname, "../.env.amo.example"), "utf8"));
  assert.deepStrictEqual(missingCredentials(template), ["WEB_EXT_API_KEY", "WEB_EXT_API_SECRET"]);
});

test("--check reports by name only and never prints the values", (t) => {
  const os = require("os");
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sign-test-")), "creds");
  fs.writeFileSync(file, "WEB_EXT_API_KEY=user:9:9\nWEB_EXT_API_SECRET=top-secret-value-123\n");
  const printed = [];
  t.mock.method(console, "log", (...a) => printed.push(a.join(" ")));
  t.mock.method(console, "error", (...a) => printed.push(a.join(" ")));
  // Real credentials exported in the shell running the tests would win over
  // the file; hide them for this test and restore them after.
  const env = process.env;
  const saved = { key: env.WEB_EXT_API_KEY, secret: env.WEB_EXT_API_SECRET };
  delete env.WEB_EXT_API_KEY;
  delete env.WEB_EXT_API_SECRET;
  try {
    assert.strictEqual(main(["--check"], { envFile: file }), 0);
    assert.strictEqual(main(["--check"], { envFile: path.join(path.dirname(file), "missing") }), 1);
  } finally {
    if (saved.key !== undefined) env.WEB_EXT_API_KEY = saved.key;
    if (saved.secret !== undefined) env.WEB_EXT_API_SECRET = saved.secret;
  }
  const out = printed.join("\n");
  assert.match(out, /credentials are set/);
  assert.match(out, /Missing AMO credentials/);
  assert.ok(!out.includes("top-secret-value-123") && !out.includes("user:9:9"), "a value was printed");
});
