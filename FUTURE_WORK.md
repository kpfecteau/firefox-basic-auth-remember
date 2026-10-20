# Future work

Ideas for later versions, most valuable first. None of these exist yet. The
vault's message API (`handlers` in `extension/background.js`) currently has
`status`, `setup`, `unlock`, `lock`, `list`, `save`, `delete`,
`changePassphrase` and `reset`.

## Gaps users would notice

1. **Auto-lock after inactivity.** The vault stays unlocked until it's locked
   by hand or Firefox restarts. Add an option such as "lock after N minutes
   idle", using Firefox's `idle` API plus a timer, off by default. It's the
   main thing people expect from a password vault.
2. **Encrypted backup export and import.** If the profile is lost, the saved
   logins are gone, and there's no way to move them to another machine. The
   vault record in `storage.local` is already encrypted, so exporting it as a
   file and importing it back (unlocked with the passphrase) is a fairly small
   change and keeps the encryption intact.
3. **Test private windows.** Never tried. Check by hand that saved logins are
   used once "Run in Private Windows" is turned on in `about:addons`, then say
   what happens in the README and on the AMO listing. (The e2e suite can't
   cover it: Firefox crashes in always-private mode in the sandbox.)

## Small improvements

4. **Keyboard shortcut to lock**, with the `commands` API
   (e.g. Ctrl+Shift+L).
5. **End-to-end coverage for the popup.** Today only the store screenshots
   exercise it. The options-page approach (`test/e2e/options-steps.js`) could
   drive `popup.html` as a page in the same way.
6. **Support link on AMO:** point the listing's support site at the repo's
   GitHub Issues page so users have somewhere to report problems.

## Release process

7. **Release notes for each version:** a `CHANGELOG.md` whose text is also
   sent with each AMO submission, so the listing's version history says what
   changed.
8. **GitHub releases:** once a listed version is approved, download the
   signed `.xpi` from the Developer Hub and attach it to a GitHub release
   tagged `vX.Y.Z`. Keep signing on the maintainer's machine rather than in
   CI, because CI would need the AMO secret stored in GitHub.

## Not worth doing yet

- **Manifest V3.** Firefox still supports MV2 and hasn't announced an end
  date. In MV3 the background page can be unloaded when idle, which would
  throw away the in-memory vault key and lock the vault without warning.
  That makes it a design change, not a quick port.
