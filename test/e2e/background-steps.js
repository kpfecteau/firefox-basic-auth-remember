
// --- e2e steps, appended to a copy of background.js by test/e2e/run.sh ---
// Each step dumps "E2E <name> <PASS|FAIL> <detail>"; run.sh reports them.
// Every fetch uses a fresh *.localhost host so Firefox's HTTP-auth cache from
// an earlier step can't answer for us.

(async () => {
  /**
   * Prints one step result for run.sh to collect.
   *
   * @param {string} name     Step name (lowercase, dashes).
   * @param {boolean} ok      Whether the step passed.
   * @param {string} detail   Extra context printed after PASS/FAIL.
   * @returns {void}
   */
  const check = (name, ok, detail = "") => dump(`E2E ${name} ${ok ? "PASS" : "FAIL"} ${detail}\n`);
  /**
   * Fetches a URL from the background page; Firefox still routes the request
   * through onAuthRequired, so this exercises the real auth path.
   *
   * @param {string} url
   * @returns {Promise<number>} The final HTTP status after any auth/redirects.
   */
  const status = (url) => fetch(url).then((r) => r.status);
  // Pre-1.3.0 plaintext entry; one wildcard covers every *.localhost test host.
  const legacy = { "*.localhost:8765": { username: "user", password: "secret" } };

  try {
    await browser.storage.local.set({ [LEGACY_KEY]: legacy });
    const before = await handlers.status();
    check("status-new", before.state === "new" && before.legacyCount === 1, JSON.stringify(before));

    await handlers.setup({ passphrase: "pw1" });
    const raw = JSON.stringify(await browser.storage.local.get(null));
    check("migrated-encrypted", !raw.includes("secret") && !raw.includes("8765") && !raw.includes(`"${LEGACY_KEY}"`), raw.slice(0, 80));

    await handlers.lock();
    check("locked-falls-through", (await status("http://locked.localhost:8765/")) === 401);

    const wrong = await handlers.unlock({ passphrase: "nope" }).then(() => "accepted", (e) => e.message);
    check("wrong-passphrase", wrong === "Wrong passphrase", wrong);

    await handlers.unlock({ passphrase: "pw1" });
    check("unlocked-answers", (await status("http://ok.localhost:8765/")) === 200);

    const hop = await status("http://hop-a.localhost:8765/hop?to=hop-b.localhost");
    check("redirect-to-second-challenger", hop === 200, `status=${hop}`);

    const badChange = await handlers
      .changePassphrase({ current: "nope", next: "pw2" })
      .then(() => "accepted", (e) => e.message);
    check("change-needs-current", badChange === "Wrong passphrase", badChange);

    await handlers.changePassphrase({ current: "pw1", next: "pw2" });
    await handlers.lock();
    const oldPass = await handlers.unlock({ passphrase: "pw1" }).then(() => "accepted", (e) => e.message);
    await handlers.unlock({ passphrase: "pw2" });
    const kept = JSON.stringify(await handlers.list()) === JSON.stringify(legacy);
    check("change-passphrase", oldPass === "Wrong passphrase" && kept, `old=${oldPass} kept=${kept}`);
    check("answers-after-change", (await status("http://after-change.localhost:8765/")) === 200);

    // A tab that got ✓ must fall back to the global 🔒 once locked.
    const tab = await browser.tabs.create({ url: "http://badge.localhost:8765/" });
    await new Promise((r) => setTimeout(r, 1500));
    const tick = await browser.browserAction.getBadgeText({ tabId: tab.id });
    await handlers.lock();
    const afterLock = await browser.browserAction.getBadgeText({ tabId: tab.id });
    check("lock-clears-tab-badge", tick === "✓" && afterLock === "🔒", `before=${tick} after=${afterLock}`);
    await handlers.unlock({ passphrase: "pw2" });

    // The page sends "lock" through runtime messaging and waits for the
    // background's stateChanged broadcast; it reports back with e2ePage.
    const page = new Promise((resolve) => {
      browser.runtime.onMessage.addListener((m) => {
        if (m.type === "e2ePage") resolve(m);
      });
    });
    await browser.tabs.create({ url: browser.runtime.getURL("e2e-page.html") });
    const result = await page;
    check("page-messaging", result.listed && result.notified && result.state === "locked", JSON.stringify(result));

    await handlers.reset();
    const after = await handlers.status();
    const left = Object.keys(await browser.storage.local.get(null));
    check("reset", after.state === "new" && left.length === 0, `state=${after.state} keys=${left}`);
  } catch (err) {
    check("unexpected-error", false, err && err.message);
  }
  dump("E2E DONE\n");
})();
