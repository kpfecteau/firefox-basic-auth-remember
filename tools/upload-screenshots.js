#!/usr/bin/env node
// Uploads the store screenshots in amo/screenshots/ to the add-on's AMO
// listing, in the order and with the captions in amo/screenshots/captions.json.
//   npm run screenshots:upload               upload (refuses if the listing already has screenshots)
//   npm run screenshots:upload -- --resume   continue an interrupted upload (see below)
//   npm run screenshots:upload -- --replace  delete the listing's screenshots first, then upload
//   npm run screenshots:upload -- --dry-run  show what would be uploaded; no credentials or network
// Uses the API credentials in .env.amo, like tools/sign.js. Values are never printed.
//
// AMO API v5 (https://mozilla.github.io/addons-server/topics/api/addons.html):
// each preview is one multipart image upload; its caption has to be set with a
// separate JSON PATCH, because captions are per-locale objects and a multipart
// field can only carry a string. There is no batch endpoint. So a full upload
// is 2 writes per screenshot.
//
// AMO rate limits (addons-server src/olympia/api/throttling.py,
// addon_submission_throttles, applied to preview, add-on and version writes;
// reads aren't counted): per user 3/minute, 10/hour, 24/day; per IP 6/minute,
// 50/hour. Signing counts against the same limits. The script spaces writes
// WRITE_INTERVAL_MS apart to stay under the per-minute limit, and waits out
// a 429 (e.g. the hourly limit) for as long as AMO says.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { parseEnv, missingCredentials } = require("./sign.js");

const ROOT = path.join(__dirname, "..");
const SHOTS_DIR = path.join(ROOT, "amo", "screenshots");
const API = "https://addons.mozilla.org/api/v5/addons/addon";

// 3 writes/minute => at most one every 20s; 21s leaves a margin.
const pacing = { writeIntervalMs: 21_000, lastWriteAt: 0 };

// AMO throttles API writes (429 "Expected available in N seconds"); wait and
// retry this many times per request before giving up.
const MAX_THROTTLE_RETRIES = 5;

/**
 * Builds the short-lived JWT AMO's API expects (HS256, signed with the API
 * secret; iss is the API key).
 *
 * @param {string} key     WEB_EXT_API_KEY (the JWT issuer).
 * @param {string} secret  WEB_EXT_API_SECRET.
 * @param {number} [now]   Current time in seconds (for tests).
 * @returns {string} The encoded token.
 */
function makeJwt(key, secret, now = Math.floor(Date.now() / 1000)) {
  const b64url = (data) => Buffer.from(data).toString("base64url");
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({ iss: key, jti: crypto.randomUUID(), iat: now, exp: now + 60 }));
  const signature = crypto.createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

/**
 * Reads amo/screenshots/captions.json and checks every listed file exists.
 *
 * @returns {{file: string, caption: string, path: string}[]} In upload order.
 * @throws {Error} if a listed screenshot is missing or a caption is empty.
 */
function loadShots() {
  const list = JSON.parse(fs.readFileSync(path.join(SHOTS_DIR, "captions.json"), "utf8"));
  return list.map(({ file, caption }) => {
    const full = path.join(SHOTS_DIR, file);
    if (!fs.existsSync(full)) throw new Error(`Missing screenshot ${file}`);
    if (!caption) throw new Error(`No caption for ${file}`);
    return { file, caption, path: full };
  });
}

/**
 * Works out how long AMO wants us to wait after a 429, from the Retry-After
 * header or the "Expected available in N seconds" message.
 *
 * @param {string|null} retryAfter  The Retry-After header value, if any.
 * @param {string} body             The response body.
 * @returns {number} Seconds to wait (at least 1; 60 if AMO doesn't say).
 */
function throttleWaitSeconds(retryAfter, body) {
  const fromHeader = Number(retryAfter);
  if (Number.isFinite(fromHeader) && fromHeader > 0) return Math.ceil(fromHeader);
  const match = /available in (\d+) seconds?/i.exec(body || "");
  return match ? Math.max(1, Number(match[1])) : 60;
}

/**
 * Formats a wait for humans: "45s" or "12m 5s".
 *
 * @param {number} seconds
 * @returns {string}
 */
function formatWait(seconds) {
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/**
 * Sleeps.
 *
 * @param {number} ms
 * @returns {Promise<void>}
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Calls the AMO API with a fresh JWT. Writes (anything but GET) are spaced
 * pacing.writeIntervalMs apart; a 429 is waited out and retried.
 *
 * @param {string} method   HTTP method.
 * @param {string} url      Full URL.
 * @param {{key: string, secret: string}} creds
 * @param {object|FormData} [body]  JSON-able object, or FormData for uploads.
 * @returns {Promise<any>} Parsed JSON response (null for 204).
 * @throws {Error} with AMO's status and message on a non-2xx response, or
 *   when still throttled after MAX_THROTTLE_RETRIES waits.
 */
async function amo(method, url, creds, body) {
  const isWrite = method !== "GET";
  for (let attempt = 0; ; attempt++) {
    if (isWrite) {
      const due = pacing.lastWriteAt + pacing.writeIntervalMs - Date.now();
      if (due > 0) await sleep(due);
      pacing.lastWriteAt = Date.now();
    }
    // A new token each attempt: AMO rejects reused jti values and expired tokens.
    const headers = { Authorization: `JWT ${makeJwt(creds.key, creds.secret)}` };
    let payload = body;
    if (body && !(body instanceof FormData)) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
    const res = await fetch(url, { method, headers, body: payload });
    const text = await res.text();
    if (res.status === 429 && attempt < MAX_THROTTLE_RETRIES) {
      const wait = throttleWaitSeconds(res.headers.get("retry-after"), text) + 1;
      console.log(`  AMO's rate limit was hit; waiting ${formatWait(wait)} as it asks…`);
      await sleep(wait * 1000);
      continue;
    }
    if (!res.ok) throw new Error(`${method} ${url} → ${res.status}: ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : null;
  }
}

/**
 * Plans the writes for an upload, given the previews already on the listing.
 * With resume, existing previews (in listing order) are taken to be the first
 * screenshots in captions.json, and only get their caption/position fixed.
 *
 * @param {{file: string, caption: string}[]} shots   From captions.json, in order.
 * @param {{id: number, caption: object|null, position: number}[]} existing
 *   The listing's current previews.
 * @param {{resume: boolean, replace: boolean}} mode
 * @returns {{deletes: number[], fixes: {id: number, shot: object, position: number}[],
 *   uploads: {shot: object, position: number}[], error?: string}}
 */
function planUpload(shots, existing, { resume, replace }) {
  const ordered = [...existing].sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.id - b.id);
  if (replace) {
    return { deletes: ordered.map((p) => p.id), fixes: [], uploads: shots.map((shot, i) => ({ shot, position: i })) };
  }
  if (ordered.length && !resume) {
    return {
      deletes: [], fixes: [], uploads: [],
      error:
        `The listing already has ${ordered.length} screenshot(s). Use -- --resume to continue an ` +
        "interrupted upload, or -- --replace to delete them and upload these instead.",
    };
  }
  if (ordered.length > shots.length) {
    return { deletes: [], fixes: [], uploads: [], error: "The listing has more screenshots than captions.json; use -- --replace." };
  }
  const fixes = ordered
    .map((preview, i) => ({ id: preview.id, shot: shots[i], position: i, preview }))
    .filter(({ preview, shot, position }) => preview.caption?.["en-US"] !== shot.caption || preview.position !== position)
    .map(({ id, shot, position }) => ({ id, shot, position }));
  const uploads = shots.slice(ordered.length).map((shot, j) => ({ shot, position: ordered.length + j }));
  return { deletes: [], fixes, uploads };
}

/**
 * Uploads the screenshots (see the header comment for options).
 *
 * @param {string[]} args  Command-line arguments.
 * @param {{envFile?: string}} [options]  Override the credentials file (tests).
 * @returns {Promise<number>} Process exit code.
 */
async function main(args, { envFile = path.join(ROOT, ".env.amo") } = {}) {
  const shots = loadShots();
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "extension", "manifest.json"), "utf8"));
  const guid = manifest.browser_specific_settings.gecko.id;

  if (args.includes("--dry-run")) {
    console.log(`Would upload ${shots.length} screenshots to ${guid} (${shots.length * 2} writes):`);
    shots.forEach((s, i) => console.log(`  ${i + 1}. ${s.file} — ${s.caption}`));
    return 0;
  }

  const fromFile = fs.existsSync(envFile) ? parseEnv(fs.readFileSync(envFile, "utf8")) : {};
  const env = { ...fromFile, ...process.env };
  const missing = missingCredentials(env);
  if (missing.length) {
    console.error(`Missing AMO credentials: ${missing.join(", ")}. See .env.amo.example.`);
    return 1;
  }
  const creds = { key: env.WEB_EXT_API_KEY, secret: env.WEB_EXT_API_SECRET };
  const addonUrl = `${API}/${encodeURIComponent(guid)}`;

  const addon = await amo("GET", `${addonUrl}/`, creds);
  const plan = planUpload(shots, addon.previews || [], {
    resume: args.includes("--resume"),
    replace: args.includes("--replace"),
  });
  if (plan.error) {
    console.error(plan.error);
    return 1;
  }
  const writes = plan.deletes.length + plan.fixes.length + plan.uploads.length * 2;
  console.log(
    `${writes} write(s) to make, spaced ${pacing.writeIntervalMs / 1000}s apart for AMO's rate limit ` +
      "(10/hour per user: a long wait is possible if you've signed or uploaded recently)."
  );

  for (const id of plan.deletes) {
    await amo("DELETE", `${addonUrl}/previews/${id}/`, creds);
    console.log(`Deleted existing screenshot ${id}`);
  }
  for (const { id, shot, position } of plan.fixes) {
    await amo("PATCH", `${addonUrl}/previews/${id}/`, creds, { caption: { "en-US": shot.caption }, position });
    console.log(`Captioned existing screenshot ${position + 1}: ${shot.file}`);
  }
  for (const { shot, position } of plan.uploads) {
    const form = new FormData();
    form.append("image", new Blob([fs.readFileSync(shot.path)], { type: "image/png" }), shot.file);
    const created = await amo("POST", `${addonUrl}/previews/`, creds, form);
    await amo("PATCH", `${addonUrl}/previews/${created.id}/`, creds, { caption: { "en-US": shot.caption }, position });
    console.log(`Uploaded ${position + 1}/${shots.length}: ${shot.file}`);
  }
  console.log(`Done: https://addons.mozilla.org/developers/addon/${addon.slug}/edit`);
  return 0;
}

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(err.message);
      process.exit(1);
    }
  );
}

module.exports = { makeJwt, loadShots, throttleWaitSeconds, amo, planUpload, pacing, main };
