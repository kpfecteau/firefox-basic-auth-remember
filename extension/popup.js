// Toolbar popup. The header always names the site in the active tab and says
// what the extension will do there. Below it, one of three forms depending on
// the vault state:
//   setup-form   no passphrase yet ("new"): choose one, migrating old logins
//   unlock-form  "locked": enter the passphrase
//   form         "unlocked": save/forget credentials for a host pattern
// All credential reads and writes go to the background via vault() (store.js).

/**
 * Shorthand for document.getElementById.
 *
 * @param {string} id  Element id.
 * @returns {HTMLElement|null}
 */
const $ = (id) => document.getElementById(id);

// The active tab, set once by init(). tabUrl is its parsed URL and tabHost its
// host key ("host" or "host:port"); both are null when the tab isn't a
// website (about: pages, extension pages).
let tabUrl = null;
let tabHost = null;

/**
 * Finds the saved credentials that apply to the active tab, using the tab's
 * real scheme so explicit ports are judged correctly.
 *
 * @returns {Promise<{pattern: string, username: string, password: string}|null>}
 *   The best match (see findCredential in store.js), or null.
 * @throws {Error} "Vault is locked" if called while locked.
 */
async function matchForTab() {
  if (!tabUrl) return null;
  const scheme = tabUrl.protocol.replace(":", "");
  return findCredential(await vault("list"), tabUrl.hostname, tabUrl.port, scheme);
}

/**
 * Shows a message in the popup's status line.
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
 * Shows exactly one of the popup's forms and focuses its first input. The
 * footer's Lock button only appears with the credential form (i.e. while
 * unlocked).
 *
 * @param {"setup-form"|"unlock-form"|"form"} formId  Form to show.
 * @returns {void}
 */
function show(formId) {
  for (const id of ["setup-form", "unlock-form", "form"]) $(id).hidden = id !== formId;
  $("lock").hidden = formId !== "form";
  const first = $(formId).querySelector("input");
  if (first) first.focus();
}

/**
 * Updates the header for the active tab: its host, plus one line saying what
 * will happen there (signs in as whom, nothing saved, locked, or not set up).
 * The header's data-state picks the status dot's style in popup.css.
 *
 * @param {"new"|"locked"|"unlocked"} state  Current vault state.
 * @returns {Promise<void>}
 */
async function refreshHeader(state) {
  let headerState;
  let text;
  if (state === "new") {
    [headerState, text] = ["new", "Choose a passphrase to start saving logins"];
  } else if (state === "locked") {
    [headerState, text] = ["locked", "Locked. Unlock to sign in automatically."];
  } else if (!tabHost) {
    [headerState, text] = ["idle", "Open a site to save its login"];
  } else {
    const match = await matchForTab();
    if (match) {
      // The host field below shows which pattern matched, so the header
      // only says who.
      [headerState, text] = ["answer", `Signs in as ${match.username}`];
    } else {
      [headerState, text] = ["none", "No saved login for this site"];
    }
  }
  $("site").dataset.state = tabHost ? headerState : "idle";
  $("site-host").textContent = tabHost || "No website in this tab";
  $("site-state").textContent = text;
}

/**
 * Fills the username and password fields with the credentials saved under
 * exactly `pattern` (no pattern matching), or clears them if there are none.
 * Forget only shows when there is something saved under `pattern`.
 *
 * @param {string} pattern  A saved host pattern, already normalized.
 * @returns {Promise<boolean>} true if credentials were found.
 * @throws {Error} "Vault is locked" if the vault was locked meanwhile.
 */
async function fillFor(pattern) {
  const cred = (await vault("list"))[pattern];
  $("username").value = cred ? cred.username : "";
  $("password").value = cred ? cred.password : "";
  $("delete").hidden = !cred;
  return Boolean(cred);
}

/**
 * Shows the credential form and pre-fills it for the active tab: the saved
 * pattern that matches the tab's host (exact, wildcard or regex), or else the
 * tab's own host[:port]. Leaves the host empty when the tab isn't a website.
 *
 * @returns {Promise<void>}
 */
async function showCredentialForm() {
  show("form");
  if (!tabHost) return;
  const match = await matchForTab();
  $("host").value = match ? match.pattern : tabHost;
  await fillFor($("host").value);
  // With a saved login the user is most likely here to change the password.
  if (match) $("password").focus();
}

/**
 * Entry point, run each time the popup opens: reads the active tab, shows the
 * private-window warning if needed, then the header and form for the current
 * vault state.
 *
 * @returns {Promise<void>}
 */
async function init() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  try {
    tabUrl = /^https?:/.test(tab.url) ? new URL(tab.url) : null;
  } catch {
    tabUrl = null;
  }
  tabHost = tabUrl ? hostKeyFromUrl(tabUrl.href) : null;

  if (!(await browser.extension.isAllowedIncognitoAccess())) {
    $("private-warning").hidden = false;
  }

  const { state, legacyCount } = await vault("status");
  if (state === "new") {
    if (legacyCount) {
      $("legacy-note").textContent = `Your ${legacyCount} existing saved login(s) will be encrypted.`;
      $("legacy-note").hidden = false;
    }
    show("setup-form");
  } else if (state === "locked") {
    show("unlock-form");
  } else {
    await showCredentialForm();
  }
  await refreshHeader(state);
}

// Setup form: creates the vault after checking both passphrase fields match.
$("setup-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if ($("setup-pass").value !== $("setup-confirm").value) {
    setStatus("The passphrases don't match.", true);
    return;
  }
  await vault("setup", { passphrase: $("setup-pass").value });
  setStatus("Encrypted and unlocked.");
  await showCredentialForm();
  await refreshHeader("unlocked");
});

// Unlock form: on a wrong passphrase, shows the error and selects the field
// for retyping; on success, switches to the credential form.
$("unlock-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await vault("unlock", { passphrase: $("unlock-pass").value });
  } catch (err) {
    setStatus(`${err.message}. Try again.`, true);
    $("unlock-pass").select();
    return;
  }
  setStatus("Unlocked. Reload the page to sign in.");
  await showCredentialForm();
  await refreshHeader("unlocked");
});

// Editing the host field loads whatever is saved under the new value.
$("host").addEventListener("change", async () => {
  const pattern = normalizePattern($("host").value);
  const found = await fillFor(pattern);
  setStatus(found ? `Loaded the saved login for ${pattern}.` : "");
});

// "This site" button: replaces the host field with the active website tab's
// host[:port] and loads any credentials saved under it.
$("use-current").addEventListener("click", async () => {
  const key = await currentSiteHostKey();
  if (!key) {
    setStatus("There's no website open to take the host from.", true);
    return;
  }
  $("host").value = key;
  const found = await fillFor(key);
  setStatus(found ? `Loaded the saved login for ${key}.` : "");
});

// Save login: normalizes the host pattern, rejects an invalid /regex/, then
// saves.
$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const pattern = normalizePattern($("host").value);
  if (!isValidPattern(pattern)) {
    setStatus("That regular expression isn't valid.", true);
    return;
  }
  await vault("save", { pattern, username: $("username").value, password: $("password").value });
  $("delete").hidden = false;
  setStatus("Saved. Reload the page to sign in.");
  await refreshHeader("unlocked");
});

// Forget: deletes the credentials saved under the pattern in the host field.
$("delete").addEventListener("click", async () => {
  const pattern = normalizePattern($("host").value);
  await vault("delete", { pattern });
  $("username").value = "";
  $("password").value = "";
  $("delete").hidden = true;
  setStatus(`Forgot the login for ${pattern}.`);
  await refreshHeader("unlocked");
});

// Lock: locks the vault and switches to the unlock form.
$("lock").addEventListener("click", async () => {
  await vault("lock");
  $("unlock-pass").value = "";
  setStatus("");
  show("unlock-form");
  await refreshHeader("locked");
});

// "Manage all logins" link: opens the options page and closes the popup.
$("manage").addEventListener("click", (e) => {
  e.preventDefault();
  browser.runtime.openOptionsPage();
  window.close();
});

init();
