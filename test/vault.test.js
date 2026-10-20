// Unit tests for vault encryption (extension/vault.js).
// Run: node --test test/*.test.js
//
// vault.js is a plain browser script, not a module, so it's evaluated in a vm
// context given Node's WebCrypto and base64 globals, and its functions are
// read back from that context.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ctx = vm.createContext({ crypto, TextEncoder, TextDecoder, btoa, atob, Uint8Array });
vm.runInContext(fs.readFileSync(path.join(__dirname, "../extension/vault.js"), "utf8"), ctx);
const { createVault, openVault, encryptJson } = ctx;

// Sample credentials; "hunter2" is checked for in the stored record.
const creds = { "example.com": { username: "u", password: "hunter2" } };

test("round trip with the right passphrase", async () => {
  const { record } = await createVault("correct horse", creds);
  const { credentials } = await openVault("correct horse", record);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(credentials)), creds);
});

test("wrong passphrase is rejected", async () => {
  const { record } = await createVault("correct horse", creds);
  await assert.rejects(openVault("wrong", record), /Wrong passphrase/);
});

test("stored record contains no plaintext", async () => {
  const { record } = await createVault("correct horse", creds);
  const json = JSON.stringify(record);
  assert.ok(!json.includes("hunter2"));
  assert.ok(!json.includes("example.com"));
  assert.strictEqual(record.iterations, 600000);
});

test("re-encrypting uses a fresh IV", async () => {
  const { key, record } = await createVault("pw", creds);
  const again = await encryptJson(key, creds);
  assert.notStrictEqual(again.iv, record.iv);
  assert.notStrictEqual(again.data, record.data);
});
