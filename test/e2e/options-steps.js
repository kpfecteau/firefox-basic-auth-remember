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
    const shown = await waitFor(() => statusText() === "Wrong passphrase.");
    check("unlock-error-shown", shown && $("status").classList.contains("error"), `status=${statusText()}`);
    const disarmed = await waitFor(() => resetLabel() === "Delete all saved logins");
    check("reset-disarmed-on-render", disarmed, `label=${resetLabel()}`);

    // Unlocking re-renders through the stateChanged broadcast.
    submit("unlock-form", { "unlock-pass": "pw2" });
    const unlocked = await waitFor(() => !$("unlocked").hidden && $("rows").rows.length > 0);
    const firstRow = $("rows").rows[0]?.cells[0]?.textContent;
    check("unlock-shows-table", unlocked && firstRow === "*.localhost:8765", `row=${firstRow}`);

    // Saving an invalid regex is refused before reaching the vault.
    submit("form", { host: "/[/", username: "u", password: "p" });
    const refused = await waitFor(() => statusText() === "That regular expression isn't valid.");
    check("invalid-regex-refused", refused && !("/[/" in (await vault("list"))), `status=${statusText()}`);

    // "Test a host" uses the same matching as the background.
    submit("test-form", { "test-host": "any.localhost:8765" });
    const matched = await waitFor(() => $("test-result").textContent.startsWith("Uses"));
    check("test-host", matched && $("test-result").textContent === "Uses *.localhost:8765, signing in as user.", $("test-result").textContent);

    submit("test-form", { "test-host": "nowhere.example" });
    const none = await waitFor(() => $("test-result").textContent === "No saved login matches this host.");
    check("test-host-no-match", none, $("test-result").textContent);

    // Mismatched new passphrases are caught on the page.
    submit("change-form", { "change-current": "pw2", "change-next": "a", "change-confirm": "b" });
    check("change-mismatch", await waitFor(() => statusText() === "The new passphrases don't match."), statusText());

    // The site-password field must never be type="password" (Firefox would
    // offer to save it) but must still be masked.
    const pw = $("password");
    const masked = getComputedStyle(pw).getPropertyValue("-webkit-text-security") === "disc";
    check("password-field-not-saveable", pw.type === "text" && masked, `type=${pw.type} masked=${masked}`);

    /**
     * Saved patterns in the vault, sorted.
     *
     * @returns {Promise<string[]>}
     */
    const patterns = async () => Object.keys(await vault("list")).sort();
    /**
     * Clicks the Edit button on the table row for `pattern`.
     *
     * @param {string} pattern
     * @returns {boolean} false if there is no such row.
     */
    const clickEdit = (pattern) => {
      const tr = [...$("rows").rows].find((r) => r.dataset.pattern === pattern);
      tr?.querySelector("button").click();
      return Boolean(tr);
    };
    const formTitle = () => $("form-title").textContent;

    // Edit enters edit mode for that row.
    const before = await patterns();
    clickEdit("*.localhost:8765");
    const inEdit =
      formTitle() === "Edit login" &&
      $("form-submit").textContent === "Update login" &&
      !$("cancel-edit").hidden &&
      $("host").value === "*.localhost:8765" &&
      $("password").value === "secret" &&
      document.querySelector("#rows tr.editing")?.dataset.pattern === "*.localhost:8765";
    check("edit-mode", inEdit, `title=${formTitle()}`);

    // Saving with the same pattern updates that entry in place.
    submit("form", { username: "user-edited" });
    await waitFor(() => statusText() === "Updated the login for *.localhost:8765.");
    const afterUpdate = await vault("list");
    check(
      "edit-updates-in-place",
      JSON.stringify(await patterns()) === JSON.stringify(before) && afterUpdate["*.localhost:8765"].username === "user-edited",
      `${statusText()} ${JSON.stringify(await patterns())}`
    );
    check("edit-mode-ends-after-save", await waitFor(() => formTitle() === "Add or update a login" && $("cancel-edit").hidden));

    // Changing the pattern while editing renames the entry, not a new one.
    await waitFor(() => clickEdit("*.localhost:8765"));
    submit("form", { host: "*.renamed.localhost:8765", username: "user" });
    await waitFor(() => statusText().startsWith("Updated the login and moved it"));
    const renamed = await patterns();
    check(
      "edit-renames",
      renamed.includes("*.renamed.localhost:8765") && !renamed.includes("*.localhost:8765") && renamed.length === before.length,
      JSON.stringify(renamed)
    );

    // Renaming onto another saved pattern is refused, and nothing changes.
    submit("form", { host: "other.test", username: "o", password: "o" });
    await waitFor(() => statusText() === "Saved the login for other.test.");
    await waitFor(() => clickEdit("other.test"));
    submit("form", { host: "*.renamed.localhost:8765" });
    const refusedRename = await waitFor(() => statusText().startsWith("There's already a login for *.renamed.localhost:8765"));
    const untouched = await vault("list");
    check(
      "edit-refuses-overwrite",
      refusedRename && untouched["other.test"]?.username === "o" && untouched["*.renamed.localhost:8765"]?.username === "user",
      statusText()
    );

    // Cancel leaves edit mode without saving.
    $("cancel-edit").click();
    check("edit-cancel", formTitle() === "Add or update a login" && $("host").value === "" && !document.querySelector("#rows tr.editing"));

    // In edit mode, Recent site only replaces the host: the edited login's
    // username and password stay. (background-steps.js left http tabs open on
    // *.localhost:8765 hosts, so there is a recent site.)
    await waitFor(() => clickEdit("other.test"));
    $("use-current").click();
    const hostFilled = await waitFor(() => $("host").value !== "other.test" && $("host").value !== "");
    check(
      "recent-site-keeps-login-in-edit",
      hostFilled && $("username").value === "o" && $("password").value === "o" && formTitle() === "Edit login",
      `host=${$("host").value} user=${$("username").value}`
    );
    $("cancel-edit").click();

    // Lock now hides the table again.
    $("lock").click();
    check("lock-now", await waitFor(() => !$("locked").hidden && $("unlocked").hidden));
  } catch (err) {
    check("unexpected-error", false, err && err.message);
  }

  browser.runtime.sendMessage({ type: "e2eOptions", results });
})();
