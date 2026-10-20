# Basic Auth Remember

A local Firefox extension that remembers HTTP Basic (and Digest) auth
credentials per host and supplies them automatically, so the login dialog
never appears for saved sites. Saved logins are encrypted with a passphrase
you unlock once per Firefox session.

## Why an extension?

Firefox's built-in password manager *can* save HTTP auth logins (tick
"Remember this password" in the dialog, with `signon.rememberSignons` on),
but it only **pre-fills** the dialog on later sessions — you still have to
click OK. There is no setting to auto-submit them (`signon.autologin.proxy`
only applies to proxies). This extension answers the challenge for you.

## Install (permanent, Firefox Developer Edition)

1. In `about:config`, set `xpinstall.signatures.required` to `false`
   (only honored in Developer Edition / Nightly).
2. Build the package:
   ```sh
   ./build.sh
   ```
3. In `about:addons` → gear icon → **Install Add-on From File…** → pick
   `basic-auth-remember.xpi`.
4. **Private windows:** in `about:addons` → Basic Auth Remember → Details, set
   **Run in Private Windows** to **Allow**. Firefox never lets an extension see
   private-window traffic without this, and no manifest setting can grant it.
   The popup and options page show a warning while it's off.
5. Re-run `./build.sh` and reinstall after changing code.

For quick hacking instead, use `about:debugging` → This Firefox →
**Load Temporary Add-on…** → `extension/manifest.json` (removed on restart).

## Usage

- The first time, the popup asks you to set a passphrase; after each
  Firefox restart it asks you to unlock.
- Click the toolbar button on a site: the host is pre-filled; enter the
  username/password and **Save**. Reload the page.
- **Current host** (popup and options page) fills the host field from the
  current tab, or on the options page the most recently viewed website tab.
  Edit it into a pattern (e.g. `*.example.com`) before saving if you like.
- **Manage all…** (or the add-on's Preferences) lists, edits and deletes
  saved entries, and has a **Test a host** box to see which entry matches.
- The toolbar badge shows ✓ when credentials were supplied on that tab and
  ✗ when the server rejected them.
- If saved credentials are wrong, the extension steps aside and Firefox's
  normal login dialog appears (no retry loop). Proxy auth is ignored.

### Host patterns

| Pattern | Matches |
| --- | --- |
| `example.com` | exactly `example.com` (default port) |
| `localhost:8080` | exactly that host and port |
| `*.example.com` | any subdomain, any port (`*` matches any characters, including dots) |
| `*.dev.test:8443` | any subdomain of `dev.test`, port 8443 only |
| `/^stage\d+\.corp$/` | a regular expression (case-insensitive) between slashes |

Exact entries win, then wildcards, then regexes; within a kind the longest
pattern wins. Wildcards and regexes are tested against both `host` and
`host:port`.

### Troubleshooting

Open `about:debugging` → This Firefox → Basic Auth Remember → **Inspect** →
Console. Every challenge logs either the matching pattern or
"No saved credentials for host[:port]".

## Testing

```sh
node --test test/*.test.js      # pattern matching and encryption unit tests
node test/server.js              # http://localhost:8765, user / secret
```

Save `localhost:8765` → `user` / `secret` in the popup and reload: the page
shows "Authenticated!" with no dialog. Save a wrong password: the native
dialog appears once.

## Encryption

Saved logins are encrypted with a passphrase you choose:

- AES-256-GCM, with the key derived from your passphrase by PBKDF2-SHA256
  (600,000 iterations, random salt). Only the ciphertext is written to the
  extension's `storage.local`.
- The key and decrypted logins live only in the background page's memory.
  After each Firefox restart the toolbar icon shows 🔒; open the popup and
  enter the passphrase once. While locked, sites show Firefox's normal
  login dialog.
- **Lock** in the popup or **Lock now** on the options page clears them
  from memory. **Change passphrase** is on the options page.
- A forgotten passphrase can't be recovered: **Delete all saved
  credentials** on the options page's locked screen wipes the vault so you
  can start over.
- Upgrading from 1.2.x: the first time you set a passphrase, your existing
  plaintext logins are encrypted and the plaintext copy is deleted.

While unlocked, anything that can inspect Firefox's memory or the extension's
background page (`about:debugging` → Inspect) can see the logins.
