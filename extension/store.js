// Host-pattern helpers shared by the background script, popup and options
// page, plus the message wrapper the pages use to reach the background vault.
//
// Pattern forms, tried in this order (most specific wins):
//   example.com, localhost:8080   exact host[:port] (port omitted when default)
//   *.example.com, dev-*.co:8443  wildcard; * matches any characters
//   /^dev\d+\.example\.com$/      regular expression, between slashes
// Wildcards and regexes are tested against both "host" and "host:port".

// Firefox reports the challenger port as -1 when the URL uses the default port.
function hostKey(host, port, scheme) {
  host = String(host || "").toLowerCase();
  const defaultPort = scheme === "https" ? 443 : 80;
  port = Number(port);
  return port > 0 && port !== defaultPort ? `${host}:${port}` : host;
}

function hostKeyFromUrl(url) {
  const u = new URL(url);
  const scheme = u.protocol.replace(":", "");
  return hostKey(u.hostname, u.port, scheme);
}

function patternKind(pattern) {
  if (pattern.length > 2 && pattern.startsWith("/") && pattern.endsWith("/")) return "regex";
  if (pattern.includes("*")) return "wildcard";
  return "exact";
}

function patternToRegExp(pattern) {
  if (patternKind(pattern) === "regex") return new RegExp(pattern.slice(1, -1), "i");
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i");
}

function isValidPattern(pattern) {
  try {
    patternToRegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

// Returns { pattern, username, password } for the best match, or null.
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

function normalizePattern(pattern) {
  pattern = pattern.trim();
  return patternKind(pattern) === "regex" ? pattern : pattern.toLowerCase();
}

// Sends a request to the background vault (see handlers in background.js).
function vault(type, payload = {}) {
  return browser.runtime.sendMessage({ type, ...payload });
}

// Host key of the most recently used web page tab (skips extension pages such
// as the options tab itself). Returns null when there is none.
async function currentSiteHostKey() {
  const tabs = await browser.tabs.query({});
  const sites = tabs
    .filter((t) => /^https?:/.test(t.url || ""))
    .sort((a, b) => b.lastAccessed - a.lastAccessed);
  return sites.length ? hostKeyFromUrl(sites[0].url) : null;
}
