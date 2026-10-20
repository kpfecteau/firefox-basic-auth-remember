// Options page ("Manage all logins"). The steel band at the top names the vault
// and its state; below it, one of three sections depending on that state:
//   #setup     no passphrase yet ("new"): choose one, migrating old logins
//   #locked    "locked": unlock, or reset if the passphrase is forgotten
//   #unlocked  "unlocked": list/add/edit/delete logins, test which pattern
//              matches a host, change the passphrase (Lock now is in the band)
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

// Pattern of the saved login being edited (after its Edit button was
// clicked), or null when the form adds a new login. Saving while editing
// replaces that entry, even if its host pattern was changed.
let editing = null;

/**
 * Puts the form into edit mode for a saved login: fills it in, retitles it,
 * shows Cancel, and highlights the login's row.
 *
 * @param {string} pattern  The saved pattern being edited.
 * @param {{username: string, password: string}} cred  Its saved login.
 * @returns {void}
 */
function startEditing(pattern, cred) {
  editing = pattern;
  $("host").value = pattern;
  $("username").value = cred.username;
  $("password").value = cred.password;
  $("form-title").textContent = "Edit login";
  $("form-submit").textContent = "Update login";
  $("cancel-edit").hidden = false;
  markEditingRow();
  $("password").focus();
  $("form").scrollIntoView({ block: "nearest" });
}

/**
 * Leaves edit mode: clears the form and restores its "add" title and button.
 *
 * @returns {void}
 */
function stopEditing() {
  editing = null;
  $("form").reset();
  $("form-title").textContent = "Add or update a login";
  $("form-submit").textContent = "Save login";
  $("cancel-edit").hidden = true;
  markEditingRow();
}

/**
 * Highlights the table row of the login being edited, if any.
 *
 * @returns {void}
 */
function markEditingRow() {
  for (const tr of $("rows").rows) {
    const isEditing = editing !== null && tr.dataset.pattern === editing;
    tr.classList.toggle("editing", isEditing);
    if (isEditing) tr.setAttribute("aria-current", "true");
    else tr.removeAttribute("aria-current");
  }
}

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
      setStatus(`${err.message}.`, true);
      render();
    }
  };
}

/**
 * Re-draws the page for the current vault state: the band's state line, the
 * matching section, the migration note when old plaintext logins exist, and
 * the logins table when unlocked. Also disarms the reset button, so it always
 * needs two clicks after being shown again.
 *
 * @returns {Promise<void>}
 */
async function render() {
  const reset = $("reset");
  delete reset.dataset.armed;
  reset.textContent = "Delete all saved logins";

  const { state, legacyCount } = await vault("status");
  $("setup").hidden = state !== "new";
  $("locked").hidden = state !== "locked";
  $("unlocked").hidden = state !== "unlocked";
  $("lock").hidden = state !== "unlocked";

  if (state === "new" && legacyCount) {
    $("legacy-note").textContent = `Your ${legacyCount} existing saved login(s) will be encrypted.`;
    $("legacy-note").hidden = false;
  }

  if (state !== "unlocked" && editing !== null) stopEditing();

  let stateText = state === "new" ? "No passphrase yet" : "Locked";
  if (state === "unlocked") {
    const count = await renderRows();
    stateText = `Unlocked, ${count} saved ${count === 1 ? "login" : "logins"}`;
  }
  $("vault").dataset.state = state;
  $("vault-state").textContent = stateText;
}

/**
 * Re-builds the logins table, sorted by pattern, with Edit (put the login in
 * the form, in edit mode) and Delete buttons per row. Passwords are never
 * shown in the table; Edit puts them into the (masked) password field. Leaves
 * edit mode if the login being edited no longer exists (e.g. it was deleted
 * from the popup).
 *
 * @returns {Promise<number>} How many logins are saved.
 * @throws {Error} "Vault is locked" if called while locked.
 */
async function renderRows() {
  const all = await vault("list");
  const rows = $("rows");
  rows.replaceChildren();

  const keys = Object.keys(all).sort();
  if (editing !== null && !(editing in all)) stopEditing();
  if (keys.length === 0) {
    const tr = rows.insertRow();
    const td = tr.insertCell();
    td.colSpan = 3;
    td.className = "empty";
    td.textContent = "No saved logins yet. Add one below, or open the toolbar popup on a site.";
    return 0;
  }

  for (const key of keys) {
    const tr = rows.insertRow();
    tr.dataset.pattern = key;
    const patternCell = tr.insertCell();
    patternCell.className = "literal";
    patternCell.textContent = key;
    const userCell = tr.insertCell();
    userCell.className = "literal";
    userCell.textContent = all[key].username;

    const edit = document.createElement("button");
    edit.textContent = "Edit";
    edit.addEventListener("click", () => startEditing(key, all[key]));

    const del = document.createElement("button");
    del.className = "danger";
    del.textContent = "Delete";
    del.addEventListener("click", handle(async () => {
      if (key === editing) stopEditing();
      await vault("delete", { pattern: key });
      setStatus(`Deleted the login for ${key}.`);
    }));

    const actions = tr.insertCell();
    actions.className = "row-actions";
    actions.append(edit, del);
  }
  markEditingRow();
  return keys.length;
}

// Changes re-render via the background's "stateChanged" message (below), so
// the handlers here only report status.

// Setup form: creates the vault after checking both passphrase fields match.
$("setup-form").addEventListener("submit", handle(async (e) => {
  e.preventDefault();
  if ($("setup-pass").value !== $("setup-confirm").value) {
    setStatus("The passphrases don't match.", true);
    return;
  }
  await vault("setup", { passphrase: $("setup-pass").value });
  e.target.reset();
  setStatus("Encrypted and unlocked.");
}));

// Unlock form; a wrong passphrase surfaces through handle().
$("unlock-form").addEventListener("submit", handle(async (e) => {
  e.preventDefault();
  await vault("unlock", { passphrase: $("unlock-pass").value });
  e.target.reset();
  setStatus("Unlocked.");
}));

// "Lock now" button in the band.
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
  setStatus("Deleted all saved logins. Choose a new passphrase to start again.");
}));

// Add/update form: normalizes the host pattern, rejects an invalid /regex/,
// then saves. In edit mode it replaces the login being edited (renaming it if
// the pattern changed), and refuses to rename onto another saved pattern so
// that login isn't silently overwritten.
$("form").addEventListener("submit", handle(async (e) => {
  e.preventDefault();
  const pattern = normalizePattern($("host").value);
  if (!isValidPattern(pattern)) {
    setStatus("That regular expression isn't valid.", true);
    return;
  }
  const renaming = editing !== null && pattern !== editing;
  if (renaming && pattern in (await vault("list"))) {
    setStatus(`There's already a login for ${pattern}. Edit or delete that one instead.`, true);
    return;
  }
  const replaces = editing;
  await vault("save", { pattern, username: $("username").value, password: $("password").value, replaces });
  if (replaces === null) setStatus(`Saved the login for ${pattern}.`);
  else if (renaming) setStatus(`Updated the login and moved it from ${replaces} to ${pattern}.`);
  else setStatus(`Updated the login for ${pattern}.`);
  stopEditing();
}));

// Cancel (edit mode only): discards the changes and returns to adding.
$("cancel-edit").addEventListener("click", () => {
  stopEditing();
  setStatus("");
});

// "Recent site" button: fills the form from the most recently viewed website
// tab (this page is itself the active tab, so it can't use that).
$("use-current").addEventListener("click", handle(async () => {
  const key = await currentSiteHostKey();
  if (!key) {
    setStatus("There's no website open to take the host from.", true);
    return;
  }
  const cred = (await vault("list"))[key];
  $("host").value = key;
  $("username").value = cred ? cred.username : "";
  $("password").value = cred ? cred.password : "";
  setStatus(cred ? `Loaded the saved login for ${key}.` : "");
}));

// "Test a host": shows which saved pattern would answer for host[:port],
// using the same matching as the background. Assumes http, so a port typed
// as :443 is treated as non-default.
$("test-form").addEventListener("submit", handle(async (e) => {
  e.preventDefault();
  const [host, port] = $("test-host").value.trim().split(":");
  const match = findCredential(await vault("list"), host, port, "http");
  $("test-result").textContent = match
    ? `Uses ${match.pattern}, signing in as ${match.username}.`
    : "No saved login matches this host.";
}));

// Change passphrase form; a wrong current passphrase surfaces through handle().
$("change-form").addEventListener("submit", handle(async (e) => {
  e.preventDefault();
  if ($("change-next").value !== $("change-confirm").value) {
    setStatus("The new passphrases don't match.", true);
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
