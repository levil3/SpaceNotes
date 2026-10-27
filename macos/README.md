# macOS Adapter

macOS-specific implementation belongs in this directory:

- `Sources/` and `Tests/`: AppKit, WKWebView, native menus and Swift tests.
- `bridge/`: the authenticated `window.levilNotes` bridge.
- `sidecar/`: Node sidecar transport and macOS file operations.
- `native/`: the native file helper.
- `scripts/`: per-arch macOS build, DMG verification and background E2E tooling.
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
cd .. && bash macos/scripts/build-macos.sh --arch arm64
```

For UI automation that must not interrupt the active desktop:

```bash
version="$(node -p 'require("./package.json").version')"
bash macos/scripts/run-wkwebview-e2e.sh \
  "build/macos/Levil Notes.app" \
  "docs/evidence/v${version}/e2e-wkwebview.json" \
  "build/macos/Levil Notes ${version}-arm64.dmg" \
  "docs/evidence/v${version}/diagnostics.log"
```

`docs/evidence/v0.2.0` is retained as the original macOS certification
baseline. It is historical evidence and never controls the packaged version.
The root `package.json` is the only version source for apps and DMGs.
