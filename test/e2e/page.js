// Extension page used by the e2e run: exercises the same runtime-messaging
// path the popup and options page use.
(async () => {
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
