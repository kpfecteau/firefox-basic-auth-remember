// Answers HTTP auth challenges with credentials from the encrypted vault. If
// the stored credentials are rejected (a second challenge for the same
// request), we fall through to Firefox's normal login dialog instead of
// looping. While the vault is locked, every challenge falls through.

const answered = new Set();

// Set while unlocked; cleared by lock() and on browser restart.
let vaultKey = null;
let credentials = null;

function setBadge(tabId, text, color) {
  const target = tabId === undefined ? {} : { tabId };
  if (tabId !== undefined && tabId < 0) return;
  browser.browserAction.setBadgeText({ ...target, text }).catch(() => {});
  browser.browserAction.setBadgeBackgroundColor({ ...target, color }).catch(() => {});
}

function updateLockBadge() {
  setBadge(undefined, vaultKey ? "" : "🔒", "#666");
}

async function readVault() {
  return (await browser.storage.local.get(VAULT_KEY))[VAULT_KEY] || null;
}

async function readLegacy() {
  return (await browser.storage.local.get(LEGACY_KEY))[LEGACY_KEY] || null;
}

async function persist() {
  const record = await readVault();
  const encrypted = await encryptJson(vaultKey, credentials);
  await browser.storage.local.set({ [VAULT_KEY]: { ...record, ...encrypted } });
}

function requireUnlocked() {
  if (!vaultKey) throw new Error("Vault is locked");
}

function lock() {
  vaultKey = null;
  credentials = null;
  updateLockBadge();
}

const handlers = {
  async status() {
    const [record, legacy] = await Promise.all([readVault(), readLegacy()]);
    return {
      state: !record ? "new" : vaultKey ? "unlocked" : "locked",
      legacyCount: legacy ? Object.keys(legacy).length : 0,
    };
  },

  // Creates the vault, encrypting any plaintext credentials from before 1.3.0.
  async setup({ passphrase }) {
    if (await readVault()) throw new Error("Vault already exists");
    if (!passphrase) throw new Error("Passphrase is required");
    const legacy = (await readLegacy()) || {};
    const { key, record } = await createVault(passphrase, legacy);
    await browser.storage.local.set({ [VAULT_KEY]: record });
    await browser.storage.local.remove(LEGACY_KEY);
    vaultKey = key;
    credentials = legacy;
    updateLockBadge();
  },

  async unlock({ passphrase }) {
    const record = await readVault();
    if (!record) throw new Error("No vault yet");
    ({ key: vaultKey, credentials } = await openVault(passphrase, record));
    updateLockBadge();
  },

  async lock() {
    lock();
  },

  async list() {
    requireUnlocked();
    return credentials;
  },

  async save({ pattern, username, password }) {
    requireUnlocked();
    credentials[pattern] = { username, password };
    await persist();
  },

  async delete({ pattern }) {
    requireUnlocked();
    delete credentials[pattern];
    await persist();
  },

  async changePassphrase({ current, next }) {
    requireUnlocked();
    if (!next) throw new Error("New passphrase is required");
    await openVault(current, await readVault());
    const { key, record } = await createVault(next, credentials);
    await browser.storage.local.set({ [VAULT_KEY]: record });
    vaultKey = key;
  },

  // For a forgotten passphrase: deletes every saved credential.
  async reset() {
    await browser.storage.local.remove([VAULT_KEY, LEGACY_KEY]);
    lock();
  },
};

browser.runtime.onMessage.addListener((message) => {
  const handler = handlers[message.type];
  return handler ? handler(message) : undefined;
});

browser.webRequest.onAuthRequired.addListener(
  (details) => {
    if (details.isProxy) return {};
    if (answered.has(details.requestId)) {
      answered.delete(details.requestId);
      console.warn("Saved credentials rejected:", details.url);
      setBadge(details.tabId, "✗", "#c33");
      return {};
    }
    if (!credentials) {
      console.info("Vault locked; not answering", details.url);
      return {};
    }

    const { host, port } = details.challenger;
    const scheme = new URL(details.url).protocol.replace(":", "");
    const cred = findCredential(credentials, host, port, scheme);
    if (!cred) {
      console.info("No saved credentials for", hostKey(host, port, scheme));
      return {};
    }

    console.info(`Supplying credentials (${cred.pattern}) for`, details.url);
    answered.add(details.requestId);
    setBadge(details.tabId, "✓", "#2a7");
    return {
      authCredentials: { username: cred.username, password: cred.password },
    };
  },
  { urls: ["<all_urls>"] },
  ["blocking"]
);

function forget(details) {
  answered.delete(details.requestId);
}
browser.webRequest.onCompleted.addListener(forget, { urls: ["<all_urls>"] });
browser.webRequest.onErrorOccurred.addListener(forget, { urls: ["<all_urls>"] });

updateLockBadge();
