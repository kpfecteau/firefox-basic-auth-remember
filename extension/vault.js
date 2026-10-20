// Encrypted credential vault. The credentials map is stored as AES-GCM
// ciphertext under a key derived from the user's passphrase with PBKDF2. The
// key and the decrypted map only ever live in the background page's memory.

const VAULT_KEY = "vault";
const LEGACY_KEY = "credentials"; // plaintext storage used before 1.3.0
const PBKDF2_ITERATIONS = 600000;

function toBase64(buffer) {
  let s = "";
  for (const byte of new Uint8Array(buffer)) s += String.fromCharCode(byte);
  return btoa(s);
}

function fromBase64(s) {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

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

async function encryptJson(key, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(JSON.stringify(value))
  );
  return { iv: toBase64(iv), data: toBase64(data) };
}

// Throws if the key is wrong (AES-GCM authentication fails).
async function decryptJson(key, { iv, data }) {
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(iv) },
    key,
    fromBase64(data)
  );
  return JSON.parse(new TextDecoder().decode(plain));
}

// Builds a new vault record for `credentials`. Returns { key, record }.
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

// Returns { key, credentials }, or throws "Wrong passphrase".
async function openVault(passphrase, record) {
  const key = await deriveKey(passphrase, fromBase64(record.salt), record.iterations);
  try {
    return { key, credentials: await decryptJson(key, record) };
  } catch {
    throw new Error("Wrong passphrase");
  }
}
