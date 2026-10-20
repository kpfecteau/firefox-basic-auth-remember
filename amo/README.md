# Publishing to addons.mozilla.org (AMO)

Files here are used for store submission only; nothing in this folder ships in
the extension.

- `metadata.json`: listing text, categories, license, and notes for Mozilla's
  reviewers (`version.approval_notes`). `npm run sign:listed` sends it with a
  new listed submission. The format is AMO's add-on API (v5) create payload.
- `icon-128.png`: the listing icon, uploaded on the add-on's "Edit Product
  Page" screen. Generated with the extension's icons by `npm run icons`.
- `screenshots/`: 1280x800 listing screenshots of the real popup and options
  page with example.com data, uploaded by hand on the same screen.
  Regenerate them after UI changes with `npm run screenshots` (headless
  Firefox; `tools/screenshots/`). Suggested captions:

  | File | Caption |
  | --- | --- |
  | `1-popup-signs-in.png` | The popup shows the site you're on and who it signs in as. |
  | `2-popup-locked.png` | Logins stay encrypted until you unlock once per Firefox session. |
  | `3-options-logins.png` | Manage every saved login: exact hosts, wildcards and regular expressions. |
  | `4-options-edit-and-test.png` | Edit a login in place, and test which saved login a host would use. |
  | `5-popup-dark.png` | Follows your light or dark system theme. |

## Before the first submission

1. **License:** MIT (`version.license` in `metadata.json`, an AMO license
   slug).
2. **Homepage:** https://github.com/kpfecteau/firefox-basic-auth-remember (`homepage` in `metadata.json`). To add a
   support email, add `"support_email": {"en-US": "..."}`; you can also set a
   support site (e.g. the repo's issues page) on AMO's Edit Product Page.
3. **Add-on id:** `basic-auth-remember@local` in `extension/manifest.json`.
   Firefox stores saved logins under the id, so keeping it means an installed
   copy upgrades to the store version without losing its vault. If AMO says
   the id is taken or not allowed, change it, and existing users will start
   with an empty vault.
4. Bump `version` in `extension/manifest.json` for every upload.

## Signing

Create API credentials at https://addons.mozilla.org/developers/addon/api/key/
and put them in `.env.amo` at the repo root. It already exists with
placeholder values (template: `.env.amo.example`). The JWT issuer goes in
`WEB_EXT_API_KEY` and the JWT secret in `WEB_EXT_API_SECRET`.

```sh
npm run sign:unlisted   # signed .xpi for self-distribution, not listed in the store
npm run sign:listed     # public listing; goes through review
```

`tools/sign.js` loads `.env.amo`, refuses to run while the values are still
placeholders, and never prints them. Variables already exported in your shell
take precedence over the file.

How `.env.amo` is protected:

- It's in `.gitignore`, so git won't commit it (`git status --ignored` lists it).
- `.claude/settings.json` denies Claude Code's Read and Edit tools on it, and
  those deny rules also apply to shell commands Claude runs in its sandbox.
- These are guardrails for Claude Code and git, not encryption: any program
  running as you can read the file. For stronger protection keep the secret
  in your password manager or the macOS Keychain and export it in the shell
  you sign from instead.

Signed files land in `web-ext-artifacts/` (gitignored). Screenshots for the
listing are uploaded by hand on AMO.
