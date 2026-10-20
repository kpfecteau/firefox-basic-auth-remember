// Drives the real options page in the e2e run. run.sh serves a copy of
// options.html as e2e-options.html with this script loaded after options.js,
// so it runs against the page's real DOM and handlers. Expects the vault to
// be locked with passphrase "pw2" and to contain "*.localhost:8765" (set up
// by background-steps.js). Leaves the vault locked.
//
// Reports [{ name, ok, detail }] to background-steps.js in an "e2eOptions"
// message; background-steps.js prints them as "options-<name>" steps.

(async () => {
  const results = [];

  /**
   * Records one step result.
   *
   * @param {string} name    Step name (lowercase, dashes).
   * @param {boolean} ok     Whether the step passed.
   * @param {string} detail  Extra context for the report.
   * @returns {void}
   */
  const check = (name, ok, detail = "") => results.push({ name, ok, detail });

  /**
   * Polls until `fn` returns truthy; the page re-renders asynchronously after
   * each vault call and stateChanged broadcast.
   *
   * @param {() => any} fn       Condition to wait for.
   * @param {number} timeoutMs   Give up after this long.
   * @returns {Promise<boolean>} true if the condition became truthy in time.
   */
  const waitFor = async (fn, timeoutMs = 5000) => {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      if (fn()) return true;
      await new Promise((r) => setTimeout(r, 50));
    }
    return false;
  };

  /**
   * Fills a form's fields and submits it the way a user would (running
   * validation and the page's submit listener).
   *
   * @param {string} formId               Form element id.
   * @param {Object<string,string>} values  Input id -> value.
   * @returns {void}
   */
  const submit = (formId, values) => {
    for (const [id, value] of Object.entries(values)) $(id).value = value;
    $(formId).requestSubmit();
  };

  const statusText = () => $("status").textContent;
  const resetLabel = () => $("reset").textContent;

  try {
    check("shows-locked", await waitFor(() => !$("locked").hidden && $("unlocked").hidden));

    // Delete all needs two clicks; one click only arms it.
    $("reset").click();
    const armed = resetLabel() === "Click again to delete everything";
    const stillThere = (await vault("status")).state === "locked";
    check("reset-first-click-arms", armed && stillThere, `label=${resetLabel()}`);

    // A wrong passphrase surfaces in the status line (via handle()), and the
    // re-render that follows disarms the reset button.
    submit("unlock-form", { "unlock-pass": "wrong" });
    const shown = await waitFor(() => statusText() === "Wrong passphrase");
    check("unlock-error-shown", shown && $("status").classList.contains("error"), `status=${statusText()}`);
    const disarmed = await waitFor(() => resetLabel() === "Delete all saved credentials");
    check("reset-disarmed-on-render", disarmed, `label=${resetLabel()}`);

    // Unlocking re-renders through the stateChanged broadcast.
    submit("unlock-form", { "unlock-pass": "pw2" });
    const unlocked = await waitFor(() => !$("unlocked").hidden && $("rows").rows.length > 0);
    const firstRow = $("rows").rows[0]?.cells[0]?.textContent;
    check("unlock-shows-table", unlocked && firstRow === "*.localhost:8765", `row=${firstRow}`);

    // Saving an invalid regex is refused before reaching the vault.
    submit("form", { host: "/[/", username: "u", password: "p" });
    const refused = await waitFor(() => statusText() === "Invalid regular expression.");
    check("invalid-regex-refused", refused && !("/[/" in (await vault("list"))), `status=${statusText()}`);

    // "Test a host" uses the same matching as the background.
    submit("test-form", { "test-host": "any.localhost:8765" });
    const matched = await waitFor(() => $("test-result").textContent.startsWith("Matches"));
    check("test-host", matched && $("test-result").textContent === "Matches *.localhost:8765 → user", $("test-result").textContent);

    submit("test-form", { "test-host": "nowhere.example" });
    const none = await waitFor(() => $("test-result").textContent === "No saved credentials match.");
    check("test-host-no-match", none, $("test-result").textContent);

    // Mismatched new passphrases are caught on the page.
    submit("change-form", { "change-current": "pw2", "change-next": "a", "change-confirm": "b" });
    check("change-mismatch", await waitFor(() => statusText() === "New passphrases don't match."), statusText());

    // Lock now hides the table again.
    $("lock").click();
    check("lock-now", await waitFor(() => !$("locked").hidden && $("unlocked").hidden));
  } catch (err) {
    check("unexpected-error", false, err && err.message);
  }

  browser.runtime.sendMessage({ type: "e2eOptions", results });
})();
