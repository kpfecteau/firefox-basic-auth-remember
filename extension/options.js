const $ = (id) => document.getElementById(id);

function setStatus(text, isError = false) {
  $("status").textContent = text;
  $("status").classList.toggle("error", isError);
}

// Wraps an event handler so vault errors (e.g. "Vault is locked" after the
// popup locked it) show in the status line and the page re-syncs.
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

$("unlock-form").addEventListener("submit", handle(async (e) => {
  e.preventDefault();
  await vault("unlock", { passphrase: $("unlock-pass").value });
  e.target.reset();
  setStatus("Unlocked.");
}));

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

$("test-form").addEventListener("submit", handle(async (e) => {
  e.preventDefault();
  const [host, port] = $("test-host").value.trim().split(":");
  const match = findCredential(await vault("list"), host, port, "http");
  $("test-result").textContent = match
    ? `Matches ${match.pattern} → ${match.username}`
    : "No saved credentials match.";
}));

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

browser.extension.isAllowedIncognitoAccess().then((allowed) => {
  $("private-warning").hidden = allowed;
});

render();
