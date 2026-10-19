// Credential storage shared by the background script, popup and options page.
// Entries are keyed by "host[:port]" (lowercased); credentials live in
// browser.storage.local, which is plain text inside the Firefox profile.

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
