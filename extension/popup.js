const $ = (id) => document.getElementById(id);

function setStatus(text) {
  $("status").textContent = text;
}

async function fillFor(key) {
  const cred = (await loadCredentials())[key];
  $("username").value = cred ? cred.username : "";
  $("password").value = cred ? cred.password : "";
  setStatus(cred ? "Saved credentials found." : "");
}

async function init() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  try {
    $("host").value = hostKeyFromUrl(tab.url);
  } catch {
    $("host").value = "";
  }
  if ($("host").value) await fillFor($("host").value);
}

$("host").addEventListener("change", () => fillFor($("host").value.trim().toLowerCase()));

$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const key = $("host").value.trim().toLowerCase();
  await saveCredential(key, $("username").value, $("password").value);
  setStatus(`Saved for ${key}. Reload the page to sign in.`);
});

$("delete").addEventListener("click", async () => {
  const key = $("host").value.trim().toLowerCase();
  await deleteCredential(key);
  $("username").value = "";
  $("password").value = "";
  setStatus(`Forgot ${key}.`);
});

$("manage").addEventListener("click", (e) => {
  e.preventDefault();
  browser.runtime.openOptionsPage();
  window.close();
});

init();
