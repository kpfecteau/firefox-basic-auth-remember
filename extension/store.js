// Credential storage shared by the background script, popup and options page.
// Entries are keyed by a host pattern; credentials live in
// browser.storage.local, which is plain text inside the Firefox profile.
//
// Pattern forms, tried in this order (most specific wins):
//   example.com, localhost:8080   exact host[:port] (port omitted when default)
//   *.example.com, dev-*.co:8443  wildcard; * matches any characters
//   /^dev\d+\.example\.com$/      regular expression, between slashes
// Wildcards and regexes are tested against both "host" and "host:port".

const STORAGE_KEY = "credentials";

function hostKey(host, port, scheme) {
  host = String(host || "").toLowerCase();
  const defaultPort = scheme === "https" ? 443 : 80;
  return port && Number(port) !== defaultPort ? `${host}:${port}` : host;
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

async function loadCredentials() {
  const data = await browser.storage.local.get(STORAGE_KEY);
  return data[STORAGE_KEY] || {};
}

async function saveCredential(key, username, password) {
  const all = await loadCredentials();
  all[key] = { username, password };
  await browser.storage.local.set({ [STORAGE_KEY]: all });
}

async function deleteCredential(key) {
  const all = await loadCredentials();
  delete all[key];
  await browser.storage.local.set({ [STORAGE_KEY]: all });
}
