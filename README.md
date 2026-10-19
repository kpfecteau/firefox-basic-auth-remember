# Basic Auth Remember

A local Firefox extension that remembers HTTP Basic (and Digest) auth
credentials per host and supplies them automatically, so the login dialog
never appears for saved sites.

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
4. Re-run `./build.sh` and reinstall after changing code.

For quick hacking instead, use `about:debugging` → This Firefox →
**Load Temporary Add-on…** → `extension/manifest.json` (removed on restart).

## Usage

- Click the toolbar button on a site: the host is pre-filled; enter the
  username/password and **Save**. Reload the page.
- **Manage all…** (or the add-on's Preferences) lists, edits and deletes
  saved entries. Hosts are `hostname` or `hostname:port` for non-default ports.
- If saved credentials are wrong, the extension steps aside and Firefox's
  normal login dialog appears (no retry loop). Proxy auth is ignored.

## Testing

```sh
node test/server.js   # http://localhost:8765, user / secret
```

Save `localhost:8765` → `user` / `secret` in the popup and reload: the page
shows "Authenticated!" with no dialog. Save a wrong password: the native
dialog appears once.

## Security note

Credentials are stored **unencrypted** in the extension's `storage.local`
inside your Firefox profile. Anyone who can read your profile directory can
read them. Fine for dev/staging sites; don't store anything critical.
