// Answers HTTP auth challenges with stored credentials. If the stored
// credentials are rejected (a second challenge for the same request), we fall
// through to Firefox's normal login dialog instead of looping.

const answered = new Set();

function setBadge(tabId, text, color) {
  if (tabId < 0) return;
  browser.browserAction.setBadgeText({ tabId, text }).catch(() => {});
  browser.browserAction.setBadgeBackgroundColor({ tabId, color }).catch(() => {});
}

browser.webRequest.onAuthRequired.addListener(
  async (details) => {
    if (details.isProxy) return {};
    if (answered.has(details.requestId)) {
      answered.delete(details.requestId);
      console.warn("Saved credentials rejected:", details.url);
      setBadge(details.tabId, "✗", "#c33");
      return {};
    }

    const { host, port } = details.challenger;
    const scheme = new URL(details.url).protocol.replace(":", "");
    const cred = findCredential(await loadCredentials(), host, port, scheme);
    if (!cred) {
      console.info("No saved credentials for", hostKey(host, port, scheme));
      return {};
    }

    console.info(`Supplying credentials (${cred.pattern}) for`, details.url);
    answered.add(details.requestId);
    setBadge(details.tabId, "✓", "#2a7");
    return {
      authCredentials: { username: cred.username, password: cred.password },
    };
  },
  { urls: ["<all_urls>"] },
  ["blocking"]
);

function forget(details) {
  answered.delete(details.requestId);
}
browser.webRequest.onCompleted.addListener(forget, { urls: ["<all_urls>"] });
browser.webRequest.onErrorOccurred.addListener(forget, { urls: ["<all_urls>"] });
