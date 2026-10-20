// Unit tests for tools/upload-screenshots.js: node --test test/*.test.js
// (No network and no real credentials.)
const test = require("node:test");
const assert = require("node:assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { makeJwt, loadShots, throttleWaitSeconds, amo, planUpload, pacing } = require("../tools/upload-screenshots.js");

// Real runs space writes 21s apart; tests turn that off unless they test it.
pacing.writeIntervalMs = 0;

test("amo() waits out a 429 and retries with a fresh token", async (t) => {
  const tokens = [];
  const responses = [
    new Response('{"detail":"Request was throttled. Expected available in 0 seconds."}', { status: 429 }),
    new Response('{"id":7}', { status: 201 }),
  ];
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    tokens.push(init.headers.Authorization);
    return responses.shift();
  });
  t.mock.method(console, "log", () => {});
  const result = await amo("PATCH", "https://example.invalid/x/", { key: "k", secret: "s" }, { position: 0 });
  assert.deepStrictEqual(result, { id: 7 });
  assert.strictEqual(tokens.length, 2);
  assert.notStrictEqual(tokens[0], tokens[1]);
});

test("amo() reports other errors with the status and message", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response('{"detail":"Not found."}', { status: 404 }));
  await assert.rejects(amo("GET", "https://example.invalid/y/", { key: "k", secret: "s" }), /404: \{"detail":"Not found\."\}/);
});

test("throttleWaitSeconds reads Retry-After, then AMO's message, else 60", () => {
  assert.strictEqual(throttleWaitSeconds("12", ""), 12);
  const amoBody = '{"detail":"Request was throttled. Expected available in 58 seconds."}';
  assert.strictEqual(throttleWaitSeconds(null, amoBody), 58);
  assert.strictEqual(throttleWaitSeconds("", "Expected available in 1 second."), 1);
  assert.strictEqual(throttleWaitSeconds(null, "{}"), 60);
  assert.strictEqual(throttleWaitSeconds("nonsense", "Expected available in 0 seconds."), 1);
});

test("makeJwt builds an HS256 token AMO can verify", () => {
  const token = makeJwt("user:1:2", "test-secret", 1000);
  const [header, payload, signature] = token.split(".");
  const decode = (part) => JSON.parse(Buffer.from(part, "base64url").toString());
  assert.deepStrictEqual(decode(header), { alg: "HS256", typ: "JWT" });
  const claims = decode(payload);
  assert.strictEqual(claims.iss, "user:1:2");
  assert.strictEqual(claims.iat, 1000);
  assert.ok(claims.exp - claims.iat <= 300, "AMO rejects tokens valid for more than 5 minutes");
  assert.ok(claims.jti);
  const expected = crypto.createHmac("sha256", "test-secret").update(`${header}.${payload}`).digest("base64url");
  assert.strictEqual(signature, expected);
});

test("makeJwt uses a fresh jti each time (AMO rejects reused ones)", () => {
  const jti = (t) => JSON.parse(Buffer.from(t.split(".")[1], "base64url").toString()).jti;
  assert.notStrictEqual(jti(makeJwt("k", "s", 1)), jti(makeJwt("k", "s", 1)));
});

test("captions.json lists every screenshot PNG exactly once, with a caption", () => {
  const shots = loadShots();
  const pngs = fs.readdirSync(path.join(__dirname, "../amo/screenshots")).filter((f) => f.endsWith(".png")).sort();
  assert.deepStrictEqual(shots.map((s) => s.file).sort(), pngs);
  for (const s of shots) assert.ok(s.caption.length > 0 && s.caption.length <= 250, s.file);
});

test("amo() spaces writes apart but not reads", async (t) => {
  const times = [];
  t.mock.method(globalThis, "fetch", async () => {
    times.push(Date.now());
    return new Response("{}", { status: 200 });
  });
  const creds = { key: "k", secret: "s" };
  pacing.writeIntervalMs = 300;
  pacing.lastWriteAt = 0;
  try {
    await amo("POST", "https://example.invalid/a/", creds, { x: 1 });
    await amo("GET", "https://example.invalid/b/", creds);
    await amo("PATCH", "https://example.invalid/c/", creds, { x: 2 });
  } finally {
    pacing.writeIntervalMs = 0;
  }
  assert.ok(times[1] - times[0] < 250, "GET shouldn't wait");
  assert.ok(times[2] - times[0] >= 290, "second write should wait ~300ms after the first");
});

const shots = ["a", "b", "c"].map((f) => ({ file: `${f}.png`, caption: `cap ${f}` }));

test("planUpload: fresh listing uploads everything", () => {
  const plan = planUpload(shots, [], { resume: false, replace: false });
  assert.deepStrictEqual(plan.uploads.map((u) => [u.shot.file, u.position]), [["a.png", 0], ["b.png", 1], ["c.png", 2]]);
  assert.deepStrictEqual([plan.deletes, plan.fixes, plan.error], [[], [], undefined]);
});

test("planUpload: existing screenshots need --resume or --replace", () => {
  const plan = planUpload(shots, [{ id: 9, caption: null, position: 0 }], { resume: false, replace: false });
  assert.match(plan.error, /--resume/);
  assert.strictEqual(plan.uploads.length, 0);
});

test("planUpload: --resume captions what's there and uploads the rest", () => {
  // The interrupted run: shot 1 uploaded without a caption.
  const plan = planUpload(shots, [{ id: 9, caption: null, position: 0 }], { resume: true, replace: false });
  assert.deepStrictEqual(plan.fixes.map((f) => [f.id, f.shot.file, f.position]), [[9, "a.png", 0]]);
  assert.deepStrictEqual(plan.uploads.map((u) => [u.shot.file, u.position]), [["b.png", 1], ["c.png", 2]]);
});

test("planUpload: --resume skips screenshots that are already right", () => {
  const existing = [
    { id: 2, caption: { "en-US": "cap b" }, position: 1 },
    { id: 1, caption: { "en-US": "cap a" }, position: 0 },
  ];
  const plan = planUpload(shots, existing, { resume: true, replace: false });
  assert.deepStrictEqual(plan.fixes, []);
  assert.deepStrictEqual(plan.uploads.map((u) => u.shot.file), ["c.png"]);
});

test("planUpload: --replace deletes everything first", () => {
  const plan = planUpload(shots, [{ id: 5, position: 0 }, { id: 6, position: 1 }], { resume: false, replace: true });
  assert.deepStrictEqual(plan.deletes, [5, 6]);
  assert.strictEqual(plan.uploads.length, 3);
});

test("planUpload: more screenshots on AMO than in captions.json is an error with --resume", () => {
  const existing = [1, 2, 3, 4].map((id) => ({ id, position: id }));
  assert.match(planUpload(shots, existing, { resume: true, replace: false }).error, /--replace/);
});
