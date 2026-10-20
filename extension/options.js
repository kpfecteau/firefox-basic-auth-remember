const $ = (id) => document.getElementById(id);

function setStatus(text, isError = false) {
  $("status").textContent = text;
  $("status").classList.toggle("error", isError);
}

async function render() {
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
    del.addEventListener("click", async () => {
      await vault("delete", { pattern: key });
      renderRows();
    });

    tr.insertCell().append(edit, " ", del);
  }
}

$("setup-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if ($("setup-pass").value !== $("setup-confirm").value) {
    setStatus("Passphrases don't match.", true);
    return;
  }
  await vault("setup", { passphrase: $("setup-pass").value });
  e.target.reset();
  setStatus("Vault created and unlocked.");
  render();
});

$("unlock-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await vault("unlock", { passphrase: $("unlock-pass").value });
  } catch (err) {
    setStatus(err.message, true);
    return;
  }
  e.target.reset();
  setStatus("Unlocked.");
  render();
});

$("lock").addEventListener("click", async () => {
  await vault("lock");
  setStatus("Locked.");
  render();
});

// A two-click confirm instead of window.confirm(), which extension pages block.
$("reset").addEventListener("click", async (e) => {
  if (e.target.dataset.armed !== "yes") {
    e.target.dataset.armed = "yes";
    e.target.textContent = "Click again to delete everything";
    return;
  }
  await vault("reset");
  setStatus("All saved credentials deleted. Set a new passphrase.");
  render();
});

$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const pattern = normalizePattern($("host").value);
  if (!isValidPattern(pattern)) {
    setStatus("Invalid regular expression.", true);
    return;
  }
  await vault("save", { pattern, username: $("username").value, password: $("password").value });
  setStatus("");
  e.target.reset();
  renderRows();
});

$("use-current").addEventListener("click", async () => {
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
});

$("test-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const [host, port] = $("test-host").value.trim().split(":");
  const match = findCredential(await vault("list"), host, port, "http");
  $("test-result").textContent = match
    ? `Matches ${match.pattern} → ${match.username}`
    : "No saved credentials match.";
});

$("change-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if ($("change-next").value !== $("change-confirm").value) {
    setStatus("New passphrases don't match.", true);
    return;
  }
  try {
    await vault("changePassphrase", { current: $("change-current").value, next: $("change-next").value });
  } catch (err) {
    setStatus(err.message, true);
    return;
  }
  e.target.reset();
  setStatus("Passphrase changed.");
});

browser.extension.isAllowedIncognitoAccess().then((allowed) => {
  $("private-warning").hidden = allowed;
});

render();
