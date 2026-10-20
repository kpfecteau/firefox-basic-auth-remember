# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

A local, unsigned Firefox (Developer Edition) WebExtension, Manifest V2, that answers HTTP Basic/Digest auth challenges with saved logins so the browser's login dialog never appears. Logins are keyed by host pattern and stored encrypted under a passphrase the user unlocks once per Firefox session. There is no bundler, package.json or npm dependency: the `extension/` folder is the shipped extension as-is.

## Commands

```sh
./build.sh                                  # zip extension/ into basic-auth-remember.xpi (gitignored)
npx -y web-ext@8 lint -s extension          # Mozilla's extension linter
node --test test/*.test.js                  # unit tests (Node's built-in runner)
node --test --test-name-pattern "regex" test/match.test.js   # a single unit test by name
test/e2e/run.sh                             # headless Firefox end-to-end suite (~15s)
node test/server.js                         # local Basic-auth server on :8765 (user / secret)
```

- Don't run `node --test test/`: it also picks up `test/server.js`, which never exits.
- `test/e2e/run.sh` needs Firefox Developer Edition at the default macOS path (override with `FIREFOX=...`). It copies `extension/` to a temp dir, appends `test/e2e/background-steps.js` to the copy's `background.js`, adds two test pages, runs it with `web-ext run`, and greps `E2E <step> PASS|FAIL` lines from Firefox's stdout (`dump()`). Individual e2e steps can't be run on their own; it exits non-zero on any FAIL or a timeout.
- The user installs the extension by reinstalling the rebuilt `.xpi` from `about:addons` (needs `xpinstall.signatures.required = false`). After behavior changes, rebuild with `./build.sh`.

## Architecture

All scripts are plain browser scripts loaded with `<script>` tags (no modules), so top-level functions and constants are shared globals across the files a page loads.

- **`background.js`** is the only code that holds credentials. It listens to `webRequest.onAuthRequired` (blocking) and answers with the best matching saved login. It owns vault state (`vaultKey`, decrypted `credentials`) in memory only, and exposes a message API in the `handlers` object (`status`, `setup`, `unlock`, `lock`, `list`, `save`, `delete`, `changePassphrase`, `reset`). Loaded after `store.js` and `vault.js` (see `manifest.json`).
- **`popup.js` / `options.js`** never touch storage. They call the background through `vault(type, payload)` in `store.js` (`runtime.sendMessage`). After any mutating handler succeeds, the background broadcasts `{type: "stateChanged"}` and the options page re-renders from it. Handler errors reject the caller's promise with the same message; the options page's `handle()` wrapper shows them in its status line.
- **`store.js`** holds the shared, mostly pure helpers: host keys and host-pattern matching (`hostKey`, `findCredential`, exact > longest wildcard > longest regex), pattern normalization/validation, and `currentSiteHostKey`.
- **`vault.js`** holds pure WebCrypto helpers: PBKDF2-SHA256 (600k iterations) derives a non-extractable AES-256-GCM key; the record `{version, salt, iterations, iv, data}` is stored in `storage.local` under `"vault"`. `"credentials"` is the legacy plaintext key from before 1.3.0, migrated and deleted by `setup`.
- **Styling:** `theme.css` has the shared tokens and controls (the steel/brass header `.band`, buttons, inputs, `.secret`); `popup.css` and `options.css` hold only page layout.

## Non-obvious behavior to preserve

- **Default ports:** Firefox reports `details.challenger.port` as `-1` for a default port. `hostKey()` treats any non-positive port as default; exact keys omit default ports.
- **No retry loop:** `answered` maps `requestId` → set of `"host:port"` challengers already answered. A second challenge from the same challenger means the saved password was rejected, so the extension returns `{}` and Firefox shows its own dialog (badge ✗). It's keyed per challenger because a request keeps its id across redirects to other hosts.
- **Badges:** Firefox clears a tab's badge when the page navigates, which happens after the auth challenge, so per-tab ✓/✗ is stored in `pendingBadges` and re-applied on `tabs.onUpdated` status `complete`. `lock()` clears per-tab badges so the global 🔒 shows.
- **Site-password fields are deliberately `type="text"` with class `secret`** (masked via `-webkit-text-security`). Firefox's password manager only captures forms with a field that has ever been `type="password"`, and ignores `autocomplete="off"` by default. Vault passphrase fields stay `type="password"`. `test/html.test.js` guards this. The trade-off (screen readers may read the field aloud) is documented in the README.
- **Editing on the options page:** `editing` holds the pattern being edited; saving sends `replaces` so the background renames the entry in one write. Renaming onto an existing pattern is refused in the UI.
- Locking doesn't clear Firefox's own HTTP-auth session cache, so sites already signed into stay signed in until restart. The e2e suite uses a fresh `*.localhost` host per step for the same reason.
- Private windows only work once the user enables "Run in Private Windows" in `about:addons`; nothing in the manifest can grant it. The e2e suite can't cover private mode: Firefox crashes in always-private mode in the sandboxed environment.

## Testing notes

- Unit tests load `store.js` / `vault.js` into a `vm` context, providing stubs such as a fake `browser` object or Node's WebCrypto.
- `test/e2e/options-steps.js` drives the real options page and matches exact UI strings, so copy changes on that page need matching test updates.
- The popup UI has no e2e coverage. To check visual changes, render the page standalone with a fake `browser` shim and use `firefox -headless --screenshot`.
