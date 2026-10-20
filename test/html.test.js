// Markup checks for the popup and options page: node --test test/*.test.js
//
// Saved sites' passwords must never be in a type="password" field, because
// Firefox's password manager only offers to save logins from forms that have
// one; they use a CSS-masked text field (class "secret") instead. The vault
// passphrase fields stay type="password" (saving those is fine).
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

/**
 * Returns the opening tag of the <input> with the given id.
 *
 * @param {string} html  Page markup.
 * @param {string} id    Input id.
 * @returns {string|undefined} The tag text, or undefined if not found.
 */
const inputTag = (html, id) => html.match(new RegExp(`<input[^>]*\\bid="${id}"[^>]*>`, "s"))?.[0];

for (const page of ["popup.html", "options.html"]) {
  const html = fs.readFileSync(path.join(__dirname, "../extension", page), "utf8");

  test(`${page}: site password field is masked text, not type=password`, () => {
    const tag = inputTag(html, "password");
    assert.ok(tag, "no #password input");
    assert.match(tag, /type="text"/);
    assert.match(tag, /class="[^"]*\bsecret\b[^"]*"/);
  });

  test(`${page}: passphrase fields stay type=password`, () => {
    const ids = [...html.matchAll(/<input[^>]*\bid="([a-z-]*pass[a-z-]*|change-[a-z]+|setup-confirm)"/g)].map((m) => m[1]);
    assert.ok(ids.length > 0);
    for (const id of ids.filter((i) => i !== "password")) {
      assert.match(inputTag(html, id), /type="password"/, id);
    }
  });
}

test("theme.css masks .secret fields", () => {
  const css = fs.readFileSync(path.join(__dirname, "../extension/theme.css"), "utf8");
  assert.match(css, /input\.secret\s*\{[^}]*-webkit-text-security:\s*disc/);
});
