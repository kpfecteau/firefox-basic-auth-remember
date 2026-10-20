
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
   * @returns {Promise<number|string>} The final HTTP status after any
   *   auth/redirects, or "error: <message>" if the fetch failed (e.g. Firefox
   *   gave up on an auth loop), so one broken step doesn't abort the run.
   */
  const status = (url) => fetch(url).then((r) => r.status, (e) => `error: ${e.message}`);
  /**
   * Awaits a promise that is expected to reject.
   *
   * @param {Promise<any>} promise
   * @returns {Promise<string>} The rejection's message, or "resolved" if it
   *   didn't reject.
   */
  const rejection = (promise) => promise.then(() => "resolved", (e) => e.message);
  /**
   * Waits for a message of the given type from an e2e page, or gives up.
   *
   * @param {string} type        Message type to wait for.
   * @param {number} timeoutMs   Give up after this long.
   * @returns {Promise<object|null>} The message, or null on timeout.
   */
  const pageMessage = (type, timeoutMs = 30000) =>
    new Promise((resolve) => {
      browser.runtime.onMessage.addListener((m) => {
        if (m.type === type) resolve(m);
      });
      setTimeout(() => resolve(null), timeoutMs);
    });
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

    // save/delete must survive a lock/unlock (i.e. persist() wrote them,
    // encrypted, to storage) and must not appear in storage in plaintext.
    await handlers.save({ pattern: "keep.test", username: "k", password: "kept-pw" });
    await handlers.save({ pattern: "gone.test", username: "g", password: "gone-pw" });
    await handlers.delete({ pattern: "gone.test" });
    await handlers.lock();
    await handlers.unlock({ passphrase: "pw2" });
    const reopened = await handlers.list();
    const stored = JSON.stringify(await browser.storage.local.get(null));
    check(
      "save-delete-persist",
      reopened["keep.test"]?.password === "kept-pw" && !("gone.test" in reopened) && !stored.includes("keep.test"),
      JSON.stringify(Object.keys(reopened))
    );
    await handlers.delete({ pattern: "keep.test" });

    // A wrong saved password: answered once, then rejected, so Firefox gets
    // the 401 (its dialog, in a tab) instead of a retry loop; the tab shows ✗.
    // The exact entry outranks the *.localhost wildcard.
    await handlers.save({ pattern: "wrongpw.localhost:8765", username: "user", password: "nope" });
    const wrongStatus = await status("http://wrongpw.localhost:8765/");
    check("wrong-saved-password", wrongStatus === 401, `status=${wrongStatus}`);
    await handlers.save({ pattern: "wrongpw-tab.localhost:8765", username: "user", password: "nope" });
    const wrongTab = await browser.tabs.create({ url: "http://wrongpw-tab.localhost:8765/" });
    await new Promise((r) => setTimeout(r, 1500));
    const cross = await browser.browserAction.getBadgeText({ tabId: wrongTab.id });
    check("wrong-password-badge", cross === "✗", `badge=${cross}`);
    await browser.tabs.remove(wrongTab.id);
    await handlers.delete({ pattern: "wrongpw.localhost:8765" });
    await handlers.delete({ pattern: "wrongpw-tab.localhost:8765" });

    // A host no saved pattern matches falls through (127.0.0.1 isn't *.localhost).
    check("no-match-falls-through", (await status("http://127.0.0.1:8765/")) === 401);

    // Handler guard rails while unlocked.
    check("setup-twice", (await rejection(handlers.setup({ passphrase: "x" }))) === "Vault already exists");
    check(
      "change-needs-new",
      (await rejection(handlers.changePassphrase({ current: "pw2", next: "" }))) === "New passphrase is required"
    );

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
    const page = pageMessage("e2ePage");
    await browser.tabs.create({ url: browser.runtime.getURL("e2e-page.html") });
    const result = (await page) || { timedOut: true };
    check("page-messaging", result.listed && result.notified && result.state === "locked", JSON.stringify(result));

    check("list-while-locked", (await rejection(handlers.list())) === "Vault is locked");
    check("save-while-locked", (await rejection(handlers.save({ pattern: "x", username: "", password: "" }))) === "Vault is locked");

    // Options page, driven by test/e2e/options-steps.js (vault is locked here).
    // It reports [{ name, ok, detail }] back in an e2eOptions message.
    const options = pageMessage("e2eOptions");
    await browser.tabs.create({ url: browser.runtime.getURL("e2e-options.html") });
    const optionResults = (await options)?.results || [{ name: "timed-out", ok: false, detail: "no report" }];
    for (const r of optionResults) check(`options-${r.name}`, r.ok, r.detail);

    await handlers.reset();
    const after = await handlers.status();
    const left = Object.keys(await browser.storage.local.get(null));
    check("reset", after.state === "new" && left.length === 0, `state=${after.state} keys=${left}`);

    // Guard rails that need no vault.
    check("unlock-without-vault", (await rejection(handlers.unlock({ passphrase: "pw2" }))) === "No vault yet");
    check("setup-needs-passphrase", (await rejection(handlers.setup({ passphrase: "" }))) === "Passphrase is required");
  } catch (err) {
    check("unexpected-error", false, err && err.message);
  }
  dump("E2E DONE\n");
})();
