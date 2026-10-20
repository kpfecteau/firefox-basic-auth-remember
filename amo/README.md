# Publishing to addons.mozilla.org (AMO)

Files here are used for store submission only; nothing in this folder ships in
the extension.

- `metadata.json`: listing text, categories, license, and notes for Mozilla's
  reviewers (`version.approval_notes`). `npm run sign:listed` sends it with a
  new listed submission. The format is AMO's add-on API (v5) create payload.
- `icon-128.png`: the listing icon, uploaded on the add-on's "Edit Product
  Page" screen. Generated with the extension's icons by `npm run icons`.

## Before the first submission

1. **License:** MIT (`version.license` in `metadata.json`, an AMO license
   slug).
2. **Support contact (optional):** add `"support_email": {"en-US": "..."}` or
   `"homepage": {"en-US": "https://..."}` to `metadata.json`.
3. **Add-on id:** `basic-auth-remember@local` in `extension/manifest.json`.
   Firefox stores saved logins under the id, so keeping it means an installed
   copy upgrades to the store version without losing its vault. If AMO says
   the id is taken or not allowed, change it, and existing users will start
   with an empty vault.
4. Bump `version` in `extension/manifest.json` for every upload.

## Signing

Create API credentials at https://addons.mozilla.org/developers/addon/api/key/
and export them; web-ext reads them from the environment:

```sh
export WEB_EXT_API_KEY=user:12345:67
export WEB_EXT_API_SECRET=...        # never commit this
npm run sign:unlisted   # signed .xpi for self-distribution, not listed in the store
npm run sign:listed     # public listing; goes through review
```

Signed files land in `web-ext-artifacts/` (gitignored). Screenshots for the
listing are uploaded by hand on AMO.
