// Options page ("Manage all…"). Shows one of three sections depending on the
// vault state:
//   #setup     no passphrase yet ("new"): choose one, migrating old logins
//   #locked    "locked": unlock, or reset if the passphrase is forgotten
//   #unlocked  "unlocked": list/add/edit/delete credentials, test which
//              pattern matches a host, change the passphrase, lock
// All credential reads and writes go to the background via vault() (store.js).
// The page re-renders whenever the background broadcasts "stateChanged", so
// changes made from the popup show up here too.

/**
 * Shorthand for document.getElementById.
 *
 * @param {string} id  Element id.
 * @returns {HTMLElement|null}
 */
const $ = (id) => document.getElementById(id);

/**
 * Shows a message in the page's status line.
 *
 * @param {string} text      Message; "" clears it.
 * @param {boolean} isError  Styles the message as an error (red).
 * @returns {void}
 */
function setStatus(text, isError = false) {
  $("status").textContent = text;
  $("status").classList.toggle("error", isError);
}

/**
 * Wraps an event handler so vault errors (e.g. "Vault is locked" after the
 * popup locked it) show in the status line and the page re-syncs.
 *
 * @param {(e: Event) => Promise<void>|void} fn  The handler to wrap.
 * @returns {(e: Event) => Promise<void>} A listener for addEventListener.
 */
function handle(fn) {
  return async (e) => {
    try {
      await fn(e);
    } catch (err) {
      setStatus(err.message, true);
      render();
    }
  };
}

/**
 * Re-draws the page for the current vault state: shows the matching section,
 * the migration note when old plaintext logins exist, and the credential
 * table when unlocked. Also disarms the reset button, so it always needs two
 * clicks after being shown again.
 *
 * @returns {Promise<void>}
 */
async function render() {
  const reset = $("reset");
  delete reset.dataset.armed;
  reset.textContent = "Delete all saved credentials";

  const { state, legacyCount } = await vault("status");
  $("setup").hidden = state !== "new";
  $("locked").hidden = state !== "locked";
  $("unlocked").hidden = state !== "unlocked";

  if (state === "new" && legacyCount) {
    $("legacy-note").textContent = `Your ${legacyCount} existing saved login(s) will be encrypted.`;
    $("legacy-note").hidden = false;
  }
  if (state === "unlocked") await renderRows();
}

/**
 * Re-builds the credential table, sorted by pattern, with Edit (copy the row
 * into the form) and Delete buttons per row. Passwords are never shown in the
 * table; Edit puts them into the (masked) password field.
 *
 * @returns {Promise<void>}
 * @throws {Error} "Vault is locked" if called while locked.
 */
async function renderRows() {
  const all = await vault("list");
  const rows = $("rows");
  rows.replaceChildren();

  const keys = Object.keys(all).sort();
  if (keys.length === 0) {
    const tr = rows.insertRow();
    const td = tr.insertCell();
    td.colSpan = 3;
    td.textContent = "No saved credentials.";
    return;
  }

  for (const key of keys) {
    const tr = rows.insertRow();
    tr.insertCell().textContent = key;
    tr.insertCell().textContent = all[key].username;

    const edit = document.createElement("button");
    edit.textContent = "Edit";
    edit.addEventListener("click", () => {
      $("host").value = key;
      $("username").value = all[key].username;
      $("password").value = all[key].password;
    });

    const del = document.createElement("button");
    del.textContent = "Delete";
    del.addEventListener("click", handle(() => vault("delete", { pattern: key })));

    tr.insertCell().append(edit, " ", del);
  }
}

// Changes re-render via the background's "stateChanged" message (below), so
// the handlers here only report status.

// Setup form: creates the vault after checking both passphrase fields match.
$("setup-form").addEventListener("submit", handle(async (e) => {
  e.preventDefault();
  if ($("setup-pass").value !== $("setup-confirm").value) {
    setStatus("Passphrases don't match.", true);
    return;
  }
  await vault("setup", { passphrase: $("setup-pass").value });
  e.target.reset();
  setStatus("Vault created and unlocked.");
}));

// Unlock form; a wrong passphrase surfaces through handle().
$("unlock-form").addEventListener("submit", handle(async (e) => {
  e.preventDefault();
  await vault("unlock", { passphrase: $("unlock-pass").value });
  e.target.reset();
  setStatus("Unlocked.");
}));

// "Lock now" button.
$("lock").addEventListener("click", handle(async () => {
  await vault("lock");
  setStatus("Locked.");
}));

// A two-click confirm instead of window.confirm(), which extension pages block.
// render() disarms it, so a later visit to the locked screen needs two clicks again.
$("reset").addEventListener("click", handle(async (e) => {
  if (e.target.dataset.armed !== "yes") {
    e.target.dataset.armed = "yes";
    e.target.textContent = "Click again to delete everything";
    return;
  }
  await vault("reset");
  setStatus("All saved credentials deleted. Set a new passphrase.");
}));

// Add/update form: normalizes the host pattern, rejects an invalid /regex/,
// then saves.
$("form").addEventListener("submit", handle(async (e) => {
  e.preventDefault();
  const pattern = normalizePattern($("host").value);
  if (!isValidPattern(pattern)) {
    setStatus("Invalid regular expression.", true);
    return;
  }
  await vault("save", { pattern, username: $("username").value, password: $("password").value });
  setStatus("");
  e.target.reset();
}));

// "Current host" button: fills the form from the most recently viewed website
// tab (this page is itself the active tab, so it can't use that).
$("use-current").addEventListener("click", handle(async () => {
  const key = await currentSiteHostKey();
  if (!key) {
    setStatus("No website tab found.", true);
    return;
  }
  const cred = (await vault("list"))[key];
  $("host").value = key;
  $("username").value = cred ? cred.username : "";
  $("password").value = cred ? cred.password : "";
  setStatus(cred ? "Saved credentials found." : "");
}));

// "Test a host": shows which saved pattern would answer for host[:port],
// using the same matching as the background. Assumes http, so a port typed
// as :443 is treated as non-default.
$("test-form").addEventListener("submit", handle(async (e) => {
  e.preventDefault();
  const [host, port] = $("test-host").value.trim().split(":");
  const match = findCredential(await vault("list"), host, port, "http");
  $("test-result").textContent = match
    ? `Matches ${match.pattern} → ${match.username}`
    : "No saved credentials match.";
}));

// Change passphrase form; a wrong current passphrase surfaces through handle().
$("change-form").addEventListener("submit", handle(async (e) => {
  e.preventDefault();
  if ($("change-next").value !== $("change-confirm").value) {
    setStatus("New passphrases don't match.", true);
    return;
  }
  await vault("changePassphrase", { current: $("change-current").value, next: $("change-next").value });
  e.target.reset();
  setStatus("Passphrase changed.");
}));

// The background sends this after every change, including ones made from the
// popup, so the page never shows a stale table or lock state.
browser.runtime.onMessage.addListener((message) => {
  if (message.type === "stateChanged") render();
});

// Warns that logins in private windows will still prompt until the user
// allows the extension there (only the user can, in about:addons).
browser.extension.isAllowedIncognitoAccess().then((allowed) => {
  $("private-warning").hidden = allowed;
});

render();
