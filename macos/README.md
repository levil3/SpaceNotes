# macOS Adapter

macOS-specific implementation belongs in this directory:

- `Sources/` and `Tests/`: AppKit, WKWebView, native menus and Swift tests.
- `bridge/`: the authenticated `window.levilNotes` bridge.
- `sidecar/`: Node sidecar transport and macOS file operations.
- `native/`: the native file helper.
- `scripts/`: universal build, DMG verification and background E2E tooling.
- `web/macos.css`: platform-only presentation overrides.

The React application, `electron/api.cjs`, `electron/vault.cjs`,
`electron/git.cjs` and the `window.levilNotes` contract are shared with Windows.
They must remain a single implementation. A normal macOS host-only change should
not require editing files outside this directory.

Three locations intentionally stay at the repository root because the toolchain
requires them:

- `.github/workflows/build-macos.yml` must be discoverable by GitHub Actions.
- `.github/workflows/release.yml` owns atomic Windows and macOS release publishing.
- `electron/main.cjs` contains one Darwin-only lazy hook for local Electron
  development. Windows must never resolve the macOS sidecar at startup.

## Verify

```bash
npm test
npm run build:web
cd macos && swift test
cd .. && bash macos/scripts/build-universal.sh
```

For UI automation that must not interrupt the active desktop:

```bash
bash macos/scripts/run-wkwebview-e2e.sh \
  "build/macos/Levil Notes.app" \
  docs/evidence/v0.2.0/e2e-wkwebview.json \
  "build/macos/Levil Notes 0.2.0.dmg" \
  docs/evidence/v0.2.0/diagnostics.log
```
