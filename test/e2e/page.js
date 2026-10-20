// Extension page used by the e2e run (served as e2e-page.html, loaded after
// store.js). It exercises the same runtime-messaging path the popup and
// options page use:
//   1. vault("list") reaches the background handlers and returns credentials;
//   2. vault("lock") makes the background broadcast "stateChanged" to pages;
//   3. vault("status") then reports "locked".
// It reports { listed, notified, state } back to background-steps.js in an
// "e2ePage" message.
(async () => {
  // Resolves true when the stateChanged broadcast arrives, false after 3s.
  const notified = new Promise((resolve) => {
    browser.runtime.onMessage.addListener((m) => {
      if (m.type === "stateChanged") resolve(true);
    });
    setTimeout(() => resolve(false), 3000);
  });

  const listed = Object.keys(await vault("list")).length > 0;
  await vault("lock");
  const result = { listed, notified: await notified, state: (await vault("status")).state };
  browser.runtime.sendMessage({ type: "e2ePage", ...result });
})();
