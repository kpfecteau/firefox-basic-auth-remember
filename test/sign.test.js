// Unit tests for tools/sign.js's credential loading: node --test test/*.test.js
// (Uses inline text only; never reads the real .env.amo.)
const test = require("node:test");
const assert = require("node:assert");
const { parseEnv, missingCredentials } = require("../tools/sign.js");

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
  const fs = require("fs");
  const path = require("path");
  const template = parseEnv(fs.readFileSync(path.join(__dirname, "../.env.amo.example"), "utf8"));
  assert.deepStrictEqual(missingCredentials(template), ["WEB_EXT_API_KEY", "WEB_EXT_API_SECRET"]);
});
