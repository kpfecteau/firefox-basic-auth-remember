// Answers HTTP auth challenges with stored credentials. If the stored
// credentials are rejected (a second challenge for the same request), we fall
// through to Firefox's normal login dialog instead of looping.

const answered = new Set();

browser.webRequest.onAuthRequired.addListener(
  async (details) => {
    if (details.isProxy) return {};
    if (answered.has(details.requestId)) {
      answered.delete(details.requestId);
      return {};
    }

    const { host, port } = details.challenger;
    const scheme = new URL(details.url).protocol.replace(":", "");
    const all = await loadCredentials();
    const cred = all[hostKey(host, port, scheme)];
    if (!cred) return {};

    answered.add(details.requestId);
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
