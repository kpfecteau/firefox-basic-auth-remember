const $ = (id) => document.getElementById(id);

async function render() {
  const all = await loadCredentials();
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
      await deleteCredential(key);
      render();
    });

    tr.insertCell().append(edit, " ", del);
  }
}

$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const pattern = normalizePattern($("host").value);
  if (!isValidPattern(pattern)) {
    $("status").textContent = "Invalid regular expression.";
    $("status").classList.add("error");
    return;
  }
  await saveCredential(pattern, $("username").value, $("password").value);
  $("status").textContent = "";
  e.target.reset();
  render();
});

$("use-current").addEventListener("click", async () => {
  const key = await currentSiteHostKey();
  $("status").classList.toggle("error", !key);
  if (!key) {
    $("status").textContent = "No website tab found.";
    return;
  }
  const cred = (await loadCredentials())[key];
  $("host").value = key;
  $("username").value = cred ? cred.username : "";
  $("password").value = cred ? cred.password : "";
  $("status").textContent = cred ? "Saved credentials found." : "";
});

$("test-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const [host, port] = $("test-host").value.trim().split(":");
  const match = findCredential(await loadCredentials(), host, port, "http");
  $("test-result").textContent = match
    ? `Matches ${match.pattern} → ${match.username}`
    : "No saved credentials match.";
});

browser.extension.isAllowedIncognitoAccess().then((allowed) => {
  $("private-warning").hidden = allowed;
});

browser.storage.onChanged.addListener(render);
render();
