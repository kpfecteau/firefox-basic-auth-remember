# Publishing to addons.mozilla.org (AMO)

Files here are used for store submission only; nothing in this folder ships in
the extension.

- `metadata.json`: listing text, categories, license, and notes for Mozilla's
  reviewers (`version.approval_notes`). `npm run sign:listed` sends it with a
  new listed submission. The format is AMO's add-on API (v5) create payload.
- `icon-128.png`: the listing icon, uploaded with
  `npm run media:upload -- --icon` (see below) or on the add-on's "Edit
  Product Page" screen. Generated with the extension's icons by `npm run icons`.
- `screenshots/`: 1280x800 listing screenshots of the real popup and options
  page with example.com data. `screenshots/captions.json` sets their order
  and captions. Regenerate the images after UI changes with
  `npm run screenshots` (headless Firefox; `tools/screenshots/`), and upload
  them to the listing with `npm run media:upload` (see below).

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
npm run sign:listed     # public listing; submits for review and exits (doesn't wait)
```

`tools/sign.js` loads `.env.amo`, refuses to run while the values are still
placeholders, and never prints them. Variables already exported in your shell
take precedence over the file.

How `.env.amo` is protected:

- It's in `.gitignore`, so git won't commit it (`git status --ignored` lists it).
- `.claude/settings.json` denies Claude Code's Read and Edit tools on it, and
  those deny rules also apply to shell commands Claude runs in its sandbox.
- These are guardrails for Claude Code and git, not encryption: any program
  running as you can read the file. That includes the npm scripts when
  Claude runs them: the deny rule stops Claude's file tools, not programs it
  starts. The scripts are written so the values never reach their output
  (see below), which is what keeps them out of Claude's context.

### What the scripts print

- `npm run build` packages only `extension/`; the credentials file is at the
  repo root and never packaged (`test/manifest.test.js` checks `extension/`
  holds no credential files).
- `tools/sign.js` prints only variable names (missing or set). It passes the
  values to web-ext through the environment, not the command line (which
  other processes can list), and runs web-ext with `--no-config-discovery`,
  since web-ext's `--verbose` logs option values when a config file and the
  environment both set one. web-ext itself keeps the key and secret in
  private fields and logs only URLs, IDs and AMO's responses.
- `tools/upload-media.js` prints file names, preview IDs, wait times
  and AMO's error responses. The secret only signs a short-lived token sent in
  a request header, which is never logged.
- `npm run sign:check` reports whether the credentials are usable, by name,
  without contacting AMO. For stronger protection keep the secret
  in your password manager or the macOS Keychain and export it in the shell
  you sign from instead.

Signed files land in `web-ext-artifacts/` (gitignored). Unlisted versions are
approved automatically within a minute or two, so `sign:unlisted` waits and
downloads the signed file. Listed versions wait for Mozilla's review (hours to
days), so `sign:listed` passes `--approval-timeout=0`: it submits, prints the
add-on's Developer Hub page and exits; download the signed file there once
it's approved. Don't re-run it for the same version: AMO rejects a version
number it has already received, and each attempt counts against the rate limit.

## Screenshots

After the listed submission exists, upload the screenshots with their captions:

```sh
npm run media:upload -- --dry-run   # list what would be uploaded (no credentials needed)
npm run media:upload                # upload; refuses if the listing already has screenshots
npm run media:upload -- --resume    # continue an interrupted upload
npm run media:upload -- --replace   # delete the listing's screenshots, then upload these
```

`tools/upload-media.js` uses the same `.env.amo` credentials as signing.
AMO has no batch upload, and a caption can't be sent with the image, so each
screenshot is two writes (upload, then caption): 10 writes for all five.

**Rate limits.** AMO allows each user 3 writes a minute, 10 an hour and 24 a
day across add-on, version and screenshot changes, including signing
(addons-server `src/olympia/api/throttling.py`; reads don't count). The script
spaces writes 21 seconds apart, and when AMO answers 429 it waits as long as
AMO says, which can be most of an hour if you've just signed. Repeated failed
requests can get an account temporarily blocked, so let it wait rather than
re-running it. If a run is interrupted, `--resume` captions the screenshots
already uploaded instead of uploading them again.

## Icon

```sh
npm run media:upload -- --icon --dry-run   # show what would be set
npm run media:upload -- --icon             # set the listing icon to icon-128.png (1 write)
```

AMO takes the icon as one multipart PATCH of the add-on (square PNG or JPEG,
128x128 recommended) and resizes it in the background, so the new icon can
take a minute to appear. `--icon` leaves the screenshots alone.
