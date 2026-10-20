// Encrypted credential vault. The credentials map is stored as AES-GCM
// ciphertext under a key derived from the user's passphrase with PBKDF2. The
// key and the decrypted map only ever live in the background page's memory.
//
// These are pure crypto helpers (no browser.* calls), loaded only by the
// background script and by test/vault.test.js. Stored record format, under
// storage.local[VAULT_KEY]:
//   { version: 1, salt, iterations, iv, data }   (salt, iv, data are base64)

const VAULT_KEY = "vault";
const LEGACY_KEY = "credentials"; // plaintext storage used before 1.3.0
const PBKDF2_ITERATIONS = 600000;

/**
 * Encodes bytes as base64 so they can be stored as JSON.
 *
 * @param {ArrayBuffer|Uint8Array} buffer  Bytes to encode.
 * @returns {string} Base64 text.
 */
function toBase64(buffer) {
  let s = "";
  for (const byte of new Uint8Array(buffer)) s += String.fromCharCode(byte);
  return btoa(s);
}

/**
 * Decodes base64 text produced by toBase64().
 *
 * @param {string} s  Base64 text.
 * @returns {Uint8Array} The decoded bytes.
 */
function fromBase64(s) {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

/**
 * Derives the AES-256-GCM key from a passphrase with PBKDF2-SHA256. This is
 * deliberately slow (about a second at 600k iterations) to make guessing
 * passphrases expensive. The key is non-extractable: it can encrypt and
 * decrypt but can never be read out.
 *
 * @param {string} passphrase    The user's passphrase.
 * @param {Uint8Array} salt      Random per-vault salt (16 bytes).
 * @param {number} iterations    PBKDF2 iteration count (stored in the record).
 * @returns {Promise<CryptoKey>}
 */
async function deriveKey(passphrase, salt, iterations) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * Encrypts a JSON-serializable value with a fresh random 12-byte IV.
 *
 * @param {CryptoKey} key  AES-GCM key from deriveKey().
 * @param {any} value      Value to encrypt (JSON.stringify'd first).
 * @returns {Promise<{iv: string, data: string}>} Base64 IV and ciphertext.
 */
async function encryptJson(key, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(JSON.stringify(value))
  );
  return { iv: toBase64(iv), data: toBase64(data) };
}

/**
 * Decrypts what encryptJson() produced.
 *
 * @param {CryptoKey} key  AES-GCM key from deriveKey().
 * @param {{iv: string, data: string}} encrypted  Base64 IV and ciphertext.
 * @returns {Promise<any>} The original value.
 * @throws {DOMException} if the key is wrong or the data was altered
 *   (AES-GCM authentication fails).
 */
async function decryptJson(key, { iv, data }) {
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(iv) },
    key,
    fromBase64(data)
  );
  return JSON.parse(new TextDecoder().decode(plain));
}

/**
 * Builds a new vault record for `credentials` with a fresh random salt. Used
 * both for first setup and for changing the passphrase.
 *
 * @param {string} passphrase  The passphrase to encrypt under.
 * @param {object} credentials { [pattern]: { username, password } }.
 * @returns {Promise<{key: CryptoKey, record: object}>} The derived key (to keep
 *   in memory) and the record to store under VAULT_KEY.
 */
async function createVault(passphrase, credentials) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(passphrase, salt, PBKDF2_ITERATIONS);
  const record = {
    version: 1,
    salt: toBase64(salt),
    iterations: PBKDF2_ITERATIONS,
    ...(await encryptJson(key, credentials)),
  };
  return { key, record };
}

/**
 * Opens a stored vault record with a passphrase.
 *
 * @param {string} passphrase  The passphrase to try.
 * @param {object} record      A record from createVault() (as stored).
 * @returns {Promise<{key: CryptoKey, credentials: object}>} The derived key
 *   and the decrypted { [pattern]: { username, password } } map.
 * @throws {Error} "Wrong passphrase" if decryption fails.
 */
async function openVault(passphrase, record) {
  const key = await deriveKey(passphrase, fromBase64(record.salt), record.iterations);
  try {
    return { key, credentials: await decryptJson(key, record) };
  } catch {
    throw new Error("Wrong passphrase");
  }
}
