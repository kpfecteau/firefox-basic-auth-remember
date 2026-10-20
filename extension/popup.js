const $ = (id) => document.getElementById(id);

function setStatus(text, isError = false) {
  $("status").textContent = text;
  $("status").classList.toggle("error", isError);
}

function show(formId) {
  for (const id of ["setup-form", "unlock-form", "form"]) $(id).hidden = id !== formId;
  const first = $(formId).querySelector("input");
  if (first) first.focus();
}

async function fillFor(pattern) {
  const cred = (await vault("list"))[pattern];
  $("username").value = cred ? cred.username : "";
  $("password").value = cred ? cred.password : "";
  setStatus(cred ? "Saved credentials found." : "");
}

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

$("host").addEventListener("change", () => fillFor(normalizePattern($("host").value)));

$("use-current").addEventListener("click", async () => {
  const key = await currentSiteHostKey();
  if (!key) {
    setStatus("No website tab found.", true);
    return;
  }
  $("host").value = key;
  await fillFor(key);
});

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

$("delete").addEventListener("click", async () => {
  const pattern = normalizePattern($("host").value);
  await vault("delete", { pattern });
  $("username").value = "";
  $("password").value = "";
  setStatus(`Forgot ${pattern}.`);
});

$("lock").addEventListener("click", async () => {
  await vault("lock");
  $("unlock-pass").value = "";
  setStatus("Locked.");
  show("unlock-form");
});

$("manage").addEventListener("click", (e) => {
  e.preventDefault();
  browser.runtime.openOptionsPage();
  window.close();
});

init();
