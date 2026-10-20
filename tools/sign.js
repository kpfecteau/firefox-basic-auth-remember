#!/usr/bin/env node
// Signs the extension with addons.mozilla.org via web-ext, using the API
// credentials in .env.amo (git-ignored; template in .env.amo.example).
//   npm run sign:unlisted   ->  node tools/sign.js --channel=unlisted
//   npm run sign:listed     ->  node tools/sign.js --channel=listed --amo-metadata amo/metadata.json
// Extra arguments are passed through to `web-ext sign`. Variables already set
// in the environment win over the file. Values are never printed.

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const ENV_FILE = path.join(ROOT, ".env.amo");
const REQUIRED = ["WEB_EXT_API_KEY", "WEB_EXT_API_SECRET"];
// The template's values; signing with them would fail confusingly at AMO.
const PLACEHOLDERS = new Set(["user:00000000:000", "paste-your-jwt-secret-here"]);

/**
 * Parses KEY=VALUE lines. Blank lines and # comments are skipped, and one
 * pair of surrounding single or double quotes is removed from values.
 *
 * @param {string} text  File contents.
 * @returns {Object<string, string>} The variables found.
 */
function parseEnv(text) {
  const vars = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || line.trim().startsWith("#")) continue;
    let value = match[2];
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    vars[match[1]] = value;
  }
  return vars;
}

/**
 * Lists required credentials that are missing or still the template's
 * placeholder values.
 *
 * @param {Object<string, string|undefined>} env  Variables to check.
 * @returns {string[]} Names of unusable variables (empty when all are set).
 */
function missingCredentials(env) {
  return REQUIRED.filter((name) => !env[name] || PLACEHOLDERS.has(env[name]));
}

/**
 * Loads .env.amo (if present) under the current environment, checks the
 * credentials, and runs `web-ext sign` with the given arguments.
 *
 * @param {string[]} args  Arguments for `web-ext sign`, e.g. --channel=listed.
 * @returns {number} Process exit code.
 */
function main(args) {
  const fromFile = fs.existsSync(ENV_FILE) ? parseEnv(fs.readFileSync(ENV_FILE, "utf8")) : {};
  const env = { ...fromFile, ...process.env };
  const missing = missingCredentials(env);
  if (missing.length) {
    console.error(
      `Missing AMO credentials: ${missing.join(", ")}.\n` +
        "Copy .env.amo.example to .env.amo and fill in the values from\n" +
        "https://addons.mozilla.org/developers/addon/api/key/ (or export them)."
    );
    return 1;
  }
  const result = spawnSync(
    "npx",
    ["-y", "web-ext@8", "sign", "-s", "extension", "-a", "web-ext-artifacts", ...args],
    { cwd: ROOT, env, stdio: "inherit", shell: process.platform === "win32" }
  );
  return result.status ?? 1;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = { parseEnv, missingCredentials };
