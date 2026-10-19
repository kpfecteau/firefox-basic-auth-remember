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
  await saveCredential($("host").value.trim().toLowerCase(), $("username").value, $("password").value);
  e.target.reset();
  render();
});

browser.storage.onChanged.addListener(render);
render();
