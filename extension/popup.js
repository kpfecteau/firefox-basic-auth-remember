// Toolbar popup. Shows one of three forms depending on the vault state:
//   setup-form   no passphrase yet ("new"): choose one, migrating old logins
//   unlock-form  "locked": enter the passphrase
//   form         "unlocked": save/forget credentials for the current site
// All credential reads and writes go to the background via vault() (store.js).

/**
 * Shorthand for document.getElementById.
 *
 * @param {string} id  Element id.
 * @returns {HTMLElement|null}
 */
const $ = (id) => document.getElementById(id);

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
 * Shows exactly one of the popup's forms and focuses its first input.
 *
 * @param {"setup-form"|"unlock-form"|"form"} formId  Form to show.
 * @returns {void}
 */
function show(formId) {
  for (const id of ["setup-form", "unlock-form", "form"]) $(id).hidden = id !== formId;
  const first = $(formId).querySelector("input");
  if (first) first.focus();
}

/**
 * Fills the username and password fields with the credentials saved under
 * exactly `pattern` (no pattern matching), or clears them if there are none.
 *
 * @param {string} pattern  A saved host pattern, already normalized.
 * @returns {Promise<void>}
 * @throws {Error} "Vault is locked" if the vault was locked meanwhile.
 */
async function fillFor(pattern) {
  const cred = (await vault("list"))[pattern];
  $("username").value = cred ? cred.username : "";
  $("password").value = cred ? cred.password : "";
  setStatus(cred ? "Saved credentials found." : "");
}

/**
 * Shows the credential form and pre-fills it for the active tab: the saved
 * pattern that matches the tab's host (exact, wildcard or regex), or else the
 * tab's own host[:port]. Leaves the host empty for tabs without a host
 * (e.g. about: pages).
 *
 * @returns {Promise<void>}
 */
async function showCredentialForm() {
  show("form");
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  let url;
  try {
    url = new URL(tab.url);
  } catch {
    return;
  }
  if (!url.hostname) return;

  const scheme = url.protocol.replace(":", "");
  const match = findCredential(await vault("list"), url.hostname, url.port, scheme);
  $("host").value = match ? match.pattern : hostKeyFromUrl(tab.url);
  await fillFor($("host").value);
  if (match && match.pattern !== hostKeyFromUrl(tab.url)) {
    setStatus(`Matched by pattern ${match.pattern}`);
  }
}

/**
 * Entry point, run each time the popup opens: shows the private-window warning
 * if needed, then the form for the current vault state.
 *
 * @returns {Promise<void>}
 */
async function init() {
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
}

// Setup form: creates the vault after checking both passphrase fields match.
$("setup-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if ($("setup-pass").value !== $("setup-confirm").value) {
    setStatus("Passphrases don't match.", true);
    return;
  }
  await vault("setup", { passphrase: $("setup-pass").value });
  setStatus("Vault created and unlocked.");
  await showCredentialForm();
});

// Unlock form: on a wrong passphrase, shows the error and selects the field
// for retyping; on success, switches to the credential form.
$("unlock-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await vault("unlock", { passphrase: $("unlock-pass").value });
  } catch (err) {
    setStatus(err.message, true);
    $("unlock-pass").select();
    return;
  }
  setStatus("Unlocked. Reload the page to sign in.");
  await showCredentialForm();
});

// Editing the host field loads whatever is saved under the new value.
$("host").addEventListener("change", () => fillFor(normalizePattern($("host").value)));

// "Current host" button: replaces the host field with the active website
// tab's host[:port] and loads any credentials saved under it.
$("use-current").addEventListener("click", async () => {
  const key = await currentSiteHostKey();
  if (!key) {
    setStatus("No website tab found.", true);
    return;
  }
  $("host").value = key;
  await fillFor(key);
});

// Save: normalizes the host pattern, rejects an invalid /regex/, then saves.
$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const pattern = normalizePattern($("host").value);
  if (!isValidPattern(pattern)) {
    setStatus("Invalid regular expression.", true);
    return;
  }
  await vault("save", { pattern, username: $("username").value, password: $("password").value });
  setStatus(`Saved for ${pattern}. Reload the page to sign in.`);
});

// Forget: deletes the credentials saved under the pattern in the host field.
$("delete").addEventListener("click", async () => {
  const pattern = normalizePattern($("host").value);
  await vault("delete", { pattern });
  $("username").value = "";
  $("password").value = "";
  setStatus(`Forgot ${pattern}.`);
});

// Lock: locks the vault and switches to the unlock form.
$("lock").addEventListener("click", async () => {
  await vault("lock");
  $("unlock-pass").value = "";
  setStatus("Locked.");
  show("unlock-form");
});

// "Manage all…" link: opens the options page and closes the popup.
$("manage").addEventListener("click", (e) => {
  e.preventDefault();
  browser.runtime.openOptionsPage();
  window.close();
});

init();
