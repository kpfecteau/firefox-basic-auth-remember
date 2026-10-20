// Unit tests for tools/upload-media.js: node --test test/*.test.js
// (No network and no real credentials.)
const test = require("node:test");
const assert = require("node:assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { makeJwt, loadShots, throttleWaitSeconds, amo, planUpload, pacing, main } = require("../tools/upload-media.js");

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

// --- main(): the whole upload against a fake AMO -------------------------

const ADDON = "https://addons.mozilla.org/api/v5/addons/addon/basic-auth-remember%40local";

/**
 * Runs main() against a fake AMO and records every request.
 *
 * @param {import("node:test").TestContext} t
 * @param {string[]} args              Command-line arguments for main().
 * @param {object[]} existingPreviews  What the fake listing already has.
 * @returns {Promise<{code: number, calls: {method: string, url: string, image?: string, json?: object}[], output: string}>}
 */
async function runMain(t, args, existingPreviews) {
  const os = require("os");
  const creds = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "upload-test-")), "creds");
  fs.writeFileSync(creds, "WEB_EXT_API_KEY=user:9:9\nWEB_EXT_API_SECRET=fake-secret-for-tests\n");
  // Credentials exported in the shell running the tests would win over the
  // file; hide them for this run.
  const env = process.env;
  const saved = [env.WEB_EXT_API_KEY, env.WEB_EXT_API_SECRET];
  delete env.WEB_EXT_API_KEY;
  delete env.WEB_EXT_API_SECRET;
  t.after(() => {
    if (saved[0] !== undefined) env.WEB_EXT_API_KEY = saved[0];
    if (saved[1] !== undefined) env.WEB_EXT_API_SECRET = saved[1];
  });

  const calls = [];
  let nextId = 100;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    const call = { method: init.method, url };
    if (init.body instanceof FormData) {
      call.fields = [...init.body.keys()];
      call.image = (init.body.get("image") || init.body.get("icon"))?.name;
    }
    else if (init.body) call.json = JSON.parse(init.body);
    calls.push(call);
    if (init.method === "GET") return Response.json({ slug: "basic-auth-remember", previews: existingPreviews });
    if (init.method === "POST") return Response.json({ id: nextId++ }, { status: 201 });
    if (init.method === "DELETE") return new Response(null, { status: 204 });
    if (url === `${ADDON}/`) return Response.json({ slug: "basic-auth-remember" });
    return Response.json({});
  });
  const output = [];
  t.mock.method(console, "log", (...a) => output.push(a.join(" ")));
  t.mock.method(console, "error", (...a) => output.push(a.join(" ")));
  const code = await main(args, { envFile: creds });
  return { code, calls, output: output.join("\n") };
}

/**
 * The PATCH main() should send to caption a screenshot.
 *
 * @param {string} url       The preview's URL.
 * @param {string} file      Screenshot file name (caption from captions.json).
 * @param {number} position  Expected position.
 * @returns {{method: string, url: string, json: object}}
 */
const captionCall = (url, file, position) => ({
  method: "PATCH",
  url,
  json: { caption: { "en-US": loadShots().find((s) => s.file === file).caption }, position },
});

test("main --resume: captions the interrupted upload, then uploads the rest in order", async (t) => {
  // The real interrupted run: screenshot 1 uploaded (id 9), never captioned.
  const { code, calls, output } = await runMain(t, ["--resume"], [{ id: 9, caption: null, position: 0 }]);
  assert.strictEqual(code, 0);
  const files = loadShots().map((s) => s.file);
  const expected = [{ method: "GET", url: `${ADDON}/` }, captionCall(`${ADDON}/previews/9/`, files[0], 0)];
  files.slice(1).forEach((file, i) => {
    expected.push({ method: "POST", url: `${ADDON}/previews/`, fields: ["image"], image: file });
    expected.push(captionCall(`${ADDON}/previews/${100 + i}/`, file, i + 1));
  });
  assert.deepStrictEqual(calls, expected);
  assert.match(output, /9 write\(s\) to make/);
  assert.ok(!output.includes("fake-secret-for-tests"), "the secret was printed");
});

test("main --replace: deletes existing screenshots before uploading all of them", async (t) => {
  const { code, calls } = await runMain(t, ["--replace"], [{ id: 7, position: 0 }, { id: 8, position: 1 }]);
  assert.strictEqual(code, 0);
  assert.deepStrictEqual(calls.slice(0, 3).map((c) => `${c.method} ${c.url}`), [
    `GET ${ADDON}/`,
    `DELETE ${ADDON}/previews/7/`,
    `DELETE ${ADDON}/previews/8/`,
  ]);
  assert.strictEqual(calls.filter((c) => c.method === "POST").length, loadShots().length);
});

test("main without a flag refuses to touch a listing that has screenshots", async (t) => {
  const { code, calls, output } = await runMain(t, [], [{ id: 9, position: 0 }]);
  assert.strictEqual(code, 1);
  assert.deepStrictEqual(calls.map((c) => c.method), ["GET"]);
  assert.match(output, /--resume/);
});

test("main --icon: one multipart PATCH of the add-on with only the icon", async (t) => {
  // Existing screenshots don't matter: --icon never reads or touches them.
  const { code, calls, output } = await runMain(t, ["--icon"], [{ id: 9, position: 0 }]);
  assert.strictEqual(code, 0);
  assert.deepStrictEqual(calls, [{ method: "PATCH", url: `${ADDON}/`, fields: ["icon"], image: "icon-128.png" }]);
  assert.match(output, /Icon set/);
  assert.ok(!output.includes("fake-secret-for-tests"), "the secret was printed");
});

test("main --icon --dry-run makes no requests", async (t) => {
  const { code, calls, output } = await runMain(t, ["--icon", "--dry-run"], []);
  assert.strictEqual(code, 0);
  assert.deepStrictEqual(calls, []);
  assert.match(output, /icon-128\.png \(1 write\)/);
});
