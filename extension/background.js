// Background script: the only part of the extension that touches credentials.
//
// Responsibilities:
//   1. Answer HTTP auth challenges (webRequest.onAuthRequired) with credentials
//      from the encrypted vault. If the stored credentials are rejected (a
//      second challenge from the same host for the same request), fall through
//      to Firefox's normal login dialog instead of looping. While the vault is
//      locked, every challenge falls through.
//   2. Own the vault state. The decryption key and decrypted credentials live
//      only in this page's memory; the popup and options page never read
//      storage directly but send messages handled by `handlers` below.
//   3. Show status on the toolbar badge: 🔒 when locked, ✓/✗ per tab when
//      credentials were supplied/rejected.
//
// Loaded after store.js (host-pattern helpers) and vault.js (crypto helpers);
// see the "background.scripts" list in manifest.json.

// requestId -> Set of "host:port" challengers already answered for it. Keyed by
// challenger too because a request keeps its id across redirects, and the
// redirect target may challenge with its own (different) saved credentials.
const answered = new Map();

// Set while unlocked; cleared by lock() and on browser restart.
let vaultKey = null; // CryptoKey (AES-GCM), non-extractable
let credentials = null; // { [pattern]: { username, password } }

// tabId -> { text, color }. Firefox clears a tab's badge when its page
// navigates, which happens after the auth challenge, so we re-apply it once
// the tab finishes loading.
const pendingBadges = new Map();

/**
 * Sets the toolbar badge, either globally or for a single tab.
 *
 * A tab-specific badge is also remembered in `pendingBadges` so it can be
 * re-applied after the tab's navigation completes (see tabs.onUpdated below).
 *
 * @param {number|undefined} tabId  Tab to badge, or undefined for the global
 *                                  badge. Negative ids (requests not tied to a
 *                                  tab, e.g. background fetches) are ignored.
 * @param {string} text   Badge text; "" hides it.
 * @param {string} color  Badge background color (CSS color).
 * @returns {void}
 */
function setBadge(tabId, text, color) {
  const target = tabId === undefined ? {} : { tabId };
  if (tabId !== undefined && tabId < 0) return;
  if (tabId !== undefined) pendingBadges.set(tabId, { text, color });
  browser.browserAction.setBadgeText({ ...target, text }).catch(() => {});
  browser.browserAction.setBadgeBackgroundColor({ ...target, color }).catch(() => {});
}

// Re-applies a remembered per-tab badge once the tab finishes loading, because
// Firefox reset it when the page navigated.
browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== "complete" || !pendingBadges.has(tabId)) return;
  const { text, color } = pendingBadges.get(tabId);
  pendingBadges.delete(tabId);
  browser.browserAction.setBadgeText({ tabId, text }).catch(() => {});
  browser.browserAction.setBadgeBackgroundColor({ tabId, color }).catch(() => {});
});
// Drops remembered badges for closed tabs so the map doesn't grow.
browser.tabs.onRemoved.addListener((tabId) => pendingBadges.delete(tabId));

/**
 * Sets the global badge to match the lock state: 🔒 while locked (or before
 * a passphrase has been set), nothing while unlocked.
 *
 * @returns {void}
 */
function updateLockBadge() {
  setBadge(undefined, vaultKey ? "" : "🔒", "#666");
}

/**
 * Reads the encrypted vault record from storage.
 *
 * @returns {Promise<object|null>} The record ({ version, salt, iterations, iv,
 *   data }; see vault.js), or null if no passphrase has been set yet.
 */
async function readVault() {
  return (await browser.storage.local.get(VAULT_KEY))[VAULT_KEY] || null;
}

/**
 * Reads plaintext credentials saved by versions before 1.3.0, which only
 * exist until the user sets a passphrase (setup migrates and deletes them).
 *
 * @returns {Promise<object|null>} { [pattern]: { username, password } }, or
 *   null if there are none.
 */
async function readLegacy() {
  return (await browser.storage.local.get(LEGACY_KEY))[LEGACY_KEY] || null;
}

/**
 * Re-encrypts the in-memory `credentials` with the current key and writes
 * them to storage, keeping the record's salt and iteration count.
 *
 * Callers must ensure the vault is unlocked.
 *
 * @returns {Promise<void>}
 */
async function persist() {
  const record = await readVault();
  const encrypted = await encryptJson(vaultKey, credentials);
  await browser.storage.local.set({ [VAULT_KEY]: { ...record, ...encrypted } });
}

/**
 * Tells open extension pages (e.g. the options page) to re-render. Errors are
 * ignored because sendMessage rejects when no page is open to receive it.
 *
 * @returns {void}
 */
function notifyChanged() {
  browser.runtime.sendMessage({ type: "stateChanged" }).catch(() => {});
}

/**
 * Guard for handlers that need decrypted credentials.
 *
 * @returns {void}
 * @throws {Error} "Vault is locked" when there is no key in memory.
 */
function requireUnlocked() {
  if (!vaultKey) throw new Error("Vault is locked");
}

/**
 * Locks the vault: forgets the key and decrypted credentials, clears every
 * per-tab ✓/✗ badge, and shows the global 🔒 badge.
 *
 * Note: this doesn't clear Firefox's own HTTP-auth session cache, so sites
 * already signed into stay signed in until Firefox restarts.
 *
 * @returns {Promise<void>}
 */
async function lock() {
  vaultKey = null;
  credentials = null;
  pendingBadges.clear();
  // Per-tab ✓/✗ badges take precedence over the global 🔒, so clear them.
  for (const tab of await browser.tabs.query({})) {
    browser.browserAction.setBadgeText({ tabId: tab.id, text: null }).catch(() => {});
  }
  updateLockBadge();
}

// Message handlers for the popup and options page, which call them through
// vault(type, payload) in store.js. Each receives the whole message object
// ({ type, ...payload }). A thrown error rejects the caller's promise with the
// same message.
const handlers = {
  /**
   * Reports the vault state.
   *
   * @returns {Promise<{state: "new"|"locked"|"unlocked", legacyCount: number}>}
   *   state "new" means no passphrase has been set yet; legacyCount is the
   *   number of plaintext (pre-1.3.0) entries waiting to be migrated.
   */
  async status() {
    const [record, legacy] = await Promise.all([readVault(), readLegacy()]);
    return {
      state: !record ? "new" : vaultKey ? "unlocked" : "locked",
      legacyCount: legacy ? Object.keys(legacy).length : 0,
    };
  },

  /**
   * Creates the vault with the given passphrase and leaves it unlocked.
   * Any plaintext credentials from before 1.3.0 are encrypted into it, and
   * the plaintext copy is deleted only after the vault has been written.
   *
   * @param {{passphrase: string}} message
   * @returns {Promise<void>}
   * @throws {Error} if a vault already exists or the passphrase is empty.
   */
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

  /**
   * Decrypts the vault into memory.
   *
   * @param {{passphrase: string}} message
   * @returns {Promise<void>}
   * @throws {Error} "No vault yet" before setup, or "Wrong passphrase".
   */
  async unlock({ passphrase }) {
    const record = await readVault();
    if (!record) throw new Error("No vault yet");
    ({ key: vaultKey, credentials } = await openVault(passphrase, record));
    updateLockBadge();
  },

  /**
   * Locks the vault (see lock() above).
   *
   * @returns {Promise<void>}
   */
  async lock() {
    await lock();
  },

  /**
   * Returns every saved credential, passwords included, so the pages can
   * show and edit them.
   *
   * @returns {Promise<object>} { [pattern]: { username, password } }
   * @throws {Error} "Vault is locked".
   */
  async list() {
    requireUnlocked();
    return credentials;
  },

  /**
   * Adds or replaces the credentials for a host pattern and saves the vault.
   * When editing an existing entry, `replaces` names it: if the pattern was
   * changed, the old entry is removed in the same write, so an edit renames
   * the entry instead of adding a second one.
   *
   * @param {{pattern: string, username: string, password: string, replaces?: string}} message
   *   pattern (and replaces) should already be normalized (see
   *   normalizePattern in store.js).
   * @returns {Promise<void>}
   * @throws {Error} "Vault is locked".
   */
  async save({ pattern, username, password, replaces }) {
    requireUnlocked();
    credentials[pattern] = { username, password };
    if (replaces && replaces !== pattern) delete credentials[replaces];
    await persist();
  },

  /**
   * Removes the credentials for a host pattern and saves the vault. Deleting
   * a pattern that doesn't exist is a no-op.
   *
   * @param {{pattern: string}} message
   * @returns {Promise<void>}
   * @throws {Error} "Vault is locked".
   */
  async delete({ pattern }) {
    requireUnlocked();
    delete credentials[pattern];
    await persist();
  },

  /**
   * Re-encrypts the vault under a new passphrase (with a fresh salt). The
   * current passphrase is required even though the vault is unlocked, so an
   * unattended unlocked browser can't be used to change it.
   *
   * @param {{current: string, next: string}} message
   * @returns {Promise<void>}
   * @throws {Error} "Vault is locked", "New passphrase is required", or
   *   "Wrong passphrase" if `current` is wrong.
   */
  async changePassphrase({ current, next }) {
    requireUnlocked();
    if (!next) throw new Error("New passphrase is required");
    await openVault(current, await readVault());
    const { key, record } = await createVault(next, credentials);
    await browser.storage.local.set({ [VAULT_KEY]: record });
    vaultKey = key;
  },

  /**
   * For a forgotten passphrase: deletes the vault and any plaintext legacy
   * credentials, then locks. The state returns to "new".
   *
   * @returns {Promise<void>}
   */
  async reset() {
    await browser.storage.local.remove([VAULT_KEY, LEGACY_KEY]);
    await lock();
  },
};

// Handlers that change what an open page would show; after they succeed, open
// pages are told to re-render.
const MUTATING = new Set(["setup", "unlock", "lock", "save", "delete", "reset"]);

// Routes { type, ...payload } messages to `handlers`. Returning the handler's
// promise sends its result (or error) back to the sender. Unknown types
// (e.g. the "stateChanged" broadcast, or messages between pages) return
// undefined so another listener can answer.
browser.runtime.onMessage.addListener((message) => {
  const handler = handlers[message.type];
  if (!handler) return undefined;
  const result = handler(message);
  if (MUTATING.has(message.type)) result.then(notifyChanged, () => {});
  return result;
});

/**
 * Answers an HTTP auth challenge (Basic or Digest) for any request.
 *
 * Returning {} lets Firefox continue as if the extension weren't there, which
 * shows its normal login dialog. Returning { authCredentials } answers the
 * challenge with no dialog.
 *
 * @param {object} details  webRequest.onAuthRequired details. Fields used:
 *   requestId, url, tabId (-1 when not from a tab), isProxy, and
 *   challenger { host, port } (port is -1 for the scheme's default port).
 * @returns {object} {} to fall through, or
 *   { authCredentials: { username, password } }.
 */
browser.webRequest.onAuthRequired.addListener(
  (details) => {
    if (details.isProxy) return {};
    const { host, port } = details.challenger;
    const challenger = `${host}:${port}`;
    const seen = answered.get(details.requestId);
    // Already answered this host for this request: the server rejected our
    // credentials. Step aside so the user can type the right ones.
    if (seen && seen.has(challenger)) {
      seen.delete(challenger);
      console.warn("Saved credentials rejected:", details.url);
      setBadge(details.tabId, "✗", "#c33");
      return {};
    }
    if (!credentials) {
      console.info("Vault locked; not answering", details.url);
      return {};
    }

    const scheme = new URL(details.url).protocol.replace(":", "");
    const cred = findCredential(credentials, host, port, scheme);
    if (!cred) {
      console.info("No saved credentials for", hostKey(host, port, scheme));
      return {};
    }

    console.info(`Supplying credentials (${cred.pattern}) for`, details.url);
    if (!seen) answered.set(details.requestId, new Set([challenger]));
    else seen.add(challenger);
    setBadge(details.tabId, "✓", "#2a7");
    return {
      authCredentials: { username: cred.username, password: cred.password },
    };
  },
  { urls: ["<all_urls>"] },
  ["blocking"]
);

/**
 * Drops the "already answered" record for a finished request, so the map
 * doesn't grow and a later request with a recycled id starts fresh.
 *
 * @param {object} details  webRequest details; only requestId is used.
 * @returns {void}
 */
function forget(details) {
  answered.delete(details.requestId);
}
browser.webRequest.onCompleted.addListener(forget, { urls: ["<all_urls>"] });
browser.webRequest.onErrorOccurred.addListener(forget, { urls: ["<all_urls>"] });

// Show 🔒 at startup: the key is never persisted, so the vault always starts
// locked (or not yet set up).
updateLockBadge();
