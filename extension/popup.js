const $ = (id) => document.getElementById(id);

function setStatus(text, isError = false) {
  $("status").textContent = text;
  $("status").classList.toggle("error", isError);
}

async function fillFor(pattern) {
  const cred = (await loadCredentials())[pattern];
  $("username").value = cred ? cred.username : "";
  $("password").value = cred ? cred.password : "";
  setStatus(cred ? "Saved credentials found." : "");
}

async function init() {
  if (!(await browser.extension.isAllowedIncognitoAccess())) {
    $("private-warning").hidden = false;
  }

  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  let url;
  try {
    url = new URL(tab.url);
  } catch {
    return;
  }
  if (!url.hostname) return;

  const scheme = url.protocol.replace(":", "");
  const match = findCredential(await loadCredentials(), url.hostname, url.port, scheme);
  $("host").value = match ? match.pattern : hostKeyFromUrl(tab.url);
  await fillFor($("host").value);
  if (match && match.pattern !== hostKeyFromUrl(tab.url)) {
    setStatus(`Matched by pattern ${match.pattern}`);
  }
}

$("host").addEventListener("change", () => fillFor(normalizePattern($("host").value)));

$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const pattern = normalizePattern($("host").value);
  if (!isValidPattern(pattern)) {
    setStatus("Invalid regular expression.", true);
    return;
  }
  await saveCredential(pattern, $("username").value, $("password").value);
  setStatus(`Saved for ${pattern}. Reload the page to sign in.`);
});

$("delete").addEventListener("click", async () => {
  const pattern = normalizePattern($("host").value);
  await deleteCredential(pattern);
  $("username").value = "";
  $("password").value = "";
  setStatus(`Forgot ${pattern}.`);
});

$("manage").addEventListener("click", (e) => {
  e.preventDefault();
  browser.runtime.openOptionsPage();
  window.close();
});

init();
