// Host-pattern helpers shared by the background script, popup and options
// page, plus the message wrapper the pages use to reach the background vault.
// Loaded as a plain <script> (no modules), so everything here is a global.
//
// Credentials are saved under a "pattern". Pattern forms, tried in this order
// (most specific wins):
//   example.com, localhost:8080   exact host[:port] (port omitted when default)
//   *.example.com, dev-*.co:8443  wildcard; * matches any characters
//   /^dev\d+\.example\.com$/      regular expression, between slashes
// Wildcards and regexes are tested against both "host" and "host:port".

/**
 * Builds the canonical lookup key for a host: lowercase, with the port only
 * when it isn't the scheme's default. Exact patterns are stored in this form.
 *
 * Firefox reports the challenger port as -1 when the URL uses the default
 * port, and URL.port is "" in that case, so anything that isn't a positive
 * number counts as the default.
 *
 * @param {string} host    Hostname, e.g. "www.example.com".
 * @param {number|string|undefined} port  Port number, -1, "" or undefined.
 * @param {string} scheme  "http" or "https" (decides the default port).
 * @returns {string} "host" or "host:port", e.g. "localhost:8080".
 */
function hostKey(host, port, scheme) {
  host = String(host || "").toLowerCase();
  const defaultPort = scheme === "https" ? 443 : 80;
  port = Number(port);
  return port > 0 && port !== defaultPort ? `${host}:${port}` : host;
}

/**
 * hostKey() for a full URL.
 *
 * @param {string} url  Absolute URL, e.g. "https://example.com:8443/path".
 * @returns {string} "host" or "host:port".
 * @throws {TypeError} if `url` isn't a valid absolute URL.
 */
function hostKeyFromUrl(url) {
  const u = new URL(url);
  const scheme = u.protocol.replace(":", "");
  return hostKey(u.hostname, u.port, scheme);
}

/**
 * Classifies a saved pattern.
 *
 * @param {string} pattern  A saved host pattern.
 * @returns {"regex"|"wildcard"|"exact"} "regex" for /.../, "wildcard" when it
 *   contains *, otherwise "exact".
 */
function patternKind(pattern) {
  if (pattern.length > 2 && pattern.startsWith("/") && pattern.endsWith("/")) return "regex";
  if (pattern.includes("*")) return "wildcard";
  return "exact";
}

/**
 * Compiles a pattern to a case-insensitive RegExp. Regex patterns are used
 * as written (unanchored unless they include ^/$); wildcard and exact
 * patterns are escaped and anchored, with * becoming ".*".
 *
 * @param {string} pattern  A host pattern.
 * @returns {RegExp}
 * @throws {SyntaxError} for an invalid /regex/ pattern.
 */
function patternToRegExp(pattern) {
  if (patternKind(pattern) === "regex") return new RegExp(pattern.slice(1, -1), "i");
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i");
}

/**
 * Checks that a pattern compiles. Only /regex/ patterns can fail.
 *
 * @param {string} pattern  A host pattern.
 * @returns {boolean} false if it's an invalid regular expression.
 */
function isValidPattern(pattern) {
  try {
    patternToRegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

/**
 * Finds the saved credentials that apply to a host. An exact key match wins;
 * otherwise the longest matching wildcard, then the longest matching regex.
 * Patterns that fail to compile are skipped.
 *
 * @param {object} all     Saved credentials: { [pattern]: { username, password } }.
 * @param {string} host    Hostname being challenged.
 * @param {number|string|undefined} port  Its port (-1/""/undefined = default).
 * @param {string} scheme  "http" or "https".
 * @returns {{pattern: string, username: string, password: string}|null}
 *   The best match and the pattern it was saved under, or null.
 */
function findCredential(all, host, port, scheme) {
  const key = hostKey(host, port, scheme);
  if (all[key]) return { pattern: key, ...all[key] };

  const bareHost = String(host || "").toLowerCase();
  const candidates = [key, bareHost];
  for (const kind of ["wildcard", "regex"]) {
    const matches = Object.keys(all)
      .filter((p) => patternKind(p) === kind)
      .filter((p) => {
        try {
          const re = patternToRegExp(p);
          return candidates.some((c) => re.test(c));
        } catch {
          return false;
        }
      })
      .sort((a, b) => b.length - a.length);
    if (matches.length) return { pattern: matches[0], ...all[matches[0]] };
  }
  return null;
}

/**
 * Cleans up a pattern typed by the user before saving or looking it up:
 * trims whitespace and lowercases it, except for regexes, whose case can
 * matter (e.g. \D vs \d).
 *
 * @param {string} pattern  Raw input.
 * @returns {string} The normalized pattern.
 */
function normalizePattern(pattern) {
  pattern = pattern.trim();
  return patternKind(pattern) === "regex" ? pattern : pattern.toLowerCase();
}

/**
 * Sends a request to the background vault (see `handlers` in background.js).
 * Only the popup and options page use this; the background calls its handlers
 * directly.
 *
 * @param {string} type     Handler name: "status", "setup", "unlock", "lock",
 *                          "list", "save", "delete", "changePassphrase" or "reset".
 * @param {object} payload  Handler arguments, e.g. { passphrase }.
 * @returns {Promise<any>} The handler's result; rejects with its error.
 */
function vault(type, payload = {}) {
  return browser.runtime.sendMessage({ type, ...payload });
}

/**
 * Host key of the most recently used web page tab, across all windows.
 * Skips non-web tabs such as about: pages and extension pages (including the
 * options tab itself).
 *
 * @returns {Promise<string|null>} "host" or "host:port", or null when no
 *   http(s) tab is open.
 */
async function currentSiteHostKey() {
  const tabs = await browser.tabs.query({});
  const sites = tabs
    .filter((t) => /^https?:/.test(t.url || ""))
    .sort((a, b) => b.lastAccessed - a.lastAccessed);
  return sites.length ? hostKeyFromUrl(sites[0].url) : null;
}
