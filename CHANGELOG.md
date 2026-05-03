# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html):

- **MAJOR** version when there are incompatible API or data-format changes.
- **MINOR** version when functionality is added in a backwards-compatible way.
- **PATCH** version for backwards-compatible bug fixes.

## How to add a changelog entry

When you make a user-visible change, append a bullet under the appropriate section of `## [Unreleased]`:

```
## [Unreleased]

### Added
- New `Foo` button in the Manager that does Bar.

### Changed
- `Manage > Settings > Rate limit` now defaults to 2300 ms.

### Fixed
- Liquipedia bulk import no longer skips pages whose title contains parentheses.

### Removed
- Dropped support for the legacy v3 builds.json schema.
```

When `npm run release:patch|minor|major` is run, the last `## [Unreleased]` heading is renamed to `## [X.Y.Z] - YYYY-MM-DD` and a fresh empty `## [Unreleased]` block is inserted on top.

---

## [Unreleased]

### Fixed

- **Release workflow no longer fails on the post-build cache-save step on Windows.** `Swatinem/rust-cache@v2` was tar-gzipping the cargo `target/` after `tauri build`, but on Windows runners the MSVC linker / NSIS bundler / signtool processes still hold file handles long enough to make `tar.exe` exit with a sharing violation — turning every tag release red even though all installers had already uploaded successfully. Set `save-if: false` on the rust-cache step in `release.yml` so the unreliable save phase is skipped on tag builds; restore is still allowed (consuming caches CI populated on `main`).

## [2.0.1] - 2026-05-02

### Fixed

- **Renderer no longer crashes on launch with `Missing #app in index.html`.** v2.0.0 shipped a stale `byId("app")` lookup in `src/renderer/dom.ts` that referenced an element that does not exist in `index.html`. Because it was the first DOM lookup at module load, it threw before any event listeners were wired up — so the window rendered but every click was a no-op. Removed the unused `app` field from both the `Dom` interface and the initializer.

## [2.0.0] - 2026-05-02

### Added

- **Single-window Manager / Overlay mode toggle.** The same window now switches between a decorated, full-UI **Manager** (build editing, importing, updates, settings) and a frameless, always-on-top **Overlay** (in-game build display). Toggle via the segmented control in the header or the new global `Ctrl+Alt+M` hotkey. The OS-level chrome (decorations, AOT, frame size) is reshaped per-mode and the chosen mode is persisted in `settings.json` so the next launch boots into the same view.
- **Catalog-stale banner on Manager boot.** When the bundled catalog snapshot is older than 30 days, or no automatic check has run within `scanIntervalHours`, the Manager view shows a banner with a one-click **Re-sync from Liquipedia** button.
- **Variant grouping in pickers.** Liquipedia builds with multiple variants (e.g. Forge FE → 9 Pool / 12 Pool / 12 Hatch / Overpool) now group together: collapsible `<details>` clusters in the Manager sidebar (auto-expanded on search match or when a child has a pending update), `<optgroup>`s in the Overlay build picker.
- **Throttled silent on-launch update scan.** `autoCheckUpdatesOnLaunch` now defaults to **on**, but a new `scanIntervalHours` setting (default 24, range 1–168) caps the frequency. The throttle uses persisted `lastUpdateCheckAt`, survives restarts, and stays quiet on success — only toasts when Liquipedia actually has newer revisions.
- **Release-time Liquipedia scrape pipeline.** New `src-tauri/src/bin/scrape.rs` Rust CLI reuses the runtime parser; `scripts/scrape-liquipedia.mjs` walks every per-race / per-matchup / per-difficulty Liquipedia category, unions with the new `data/known-build-pages.txt` safety net, then streams page titles through the Rust binary. Outputs the bundled `data/builds.json` plus a per-page `data/scrape-coverage.json` audit. `scripts/release.mjs` runs the scrape automatically before the version bump (skip with `--skip-scrape`).
- **Per-page wikitext fixture tests.** `src-tauri/tests/parser_fixtures.rs` pins the parser against checked-in Liquipedia snapshots (Forge FE, 1 Gate Core, 14 CC) so future edits cannot silently regress variant detection.

### Changed

- **Bundled `data/builds.json` regenerated from Liquipedia at release time.** Replaces the 25 hand-typed builds with the full Liquipedia catalog. Every shipped build now carries a real `revisionId` so the update-available badge starts dark on first install.
- **Settings file format bumped to v2.** Adds `lastView`, `managerWindowSize`, `overlayWindowSize`, `scanIntervalHours`, `lastUpdateCheckAt`. Forward-only migration: existing `settings.json` is re-deserialised through the typed `Settings` (serde defaults backfill missing fields) and written back on launch.
- **Manager UI restructured into a 2-column layout.** Sidebar (filters + scrollable build list + actions) on the left, tab nav + scrolling tab content on the right. Every flex/grid child in the chain has `min-height: 0`, scroll containers live one level above the content, and tabs sit outside the scroll region — fixing the cutoff/scroll bugs from v1.
- **Update result includes a separate `unknown` bucket.** `CheckUpdatesResult` now distinguishes truly outdated builds (newer revision on Liquipedia) from builds with no stored `revisionId` (imported before tracking, informational only). The Updates tab surfaces both; the overlay badge counts only the `outdated` bucket.

### Fixed

- **Inline-variant Liquipedia pages are now parsed correctly.** Pages like Forge FE (vs. Zerg) lay out 2-4 variants side by side using `{{col-begin}} / {{colbreak}} / {{col-end}}` plus `;` sub-headings inside a single `{{build}}` template. The parser previously flattened all of that into a single 28-step build; it now walks the build body line-by-line, flushes the in-progress variant on every column marker or definition term, and prepends the shared prelude bullets (e.g. 8/8/11 lead-in) to each variant so every output build is complete.
- **The "update available" badge no longer stays permanently lit.** Builds with `revisionId == null` are no longer treated as outdated; the badge counts only builds where Liquipedia actually has a newer revision than the locally stored one. NoStoredRev builds still show in the Updates tab so users can refresh once to enable diffing.
- **Always-on-top focus-keeper is mode-aware.** In Manager mode the window no longer yanks itself above other apps every time you click the taskbar. The Windows AOT workaround stays intact for Overlay mode.
- **When a Liquipedia import yields no parsed `{{build}}` steps, the placeholder overlay step is now plain-language guidance instead of developer-style wording.**
- **Removed a stale `src/main/` path mention from the Liquipedia API module header comment** (no behavior change).

## [1.0.0] - 2026-05-01

Initial public release. Cross-platform Tauri 2 + Rust desktop overlay for StarCraft: Brood War / Remastered, with a built-in Liquipedia importer and update scanner. Native bundles for Windows, macOS, and Linux.

### Overlay

- Always-on-top desktop overlay for Windows, macOS, and Linux. Runs on top of StarCraft when the game is in **Windowed (Fullscreen)** mode.
- All 9 race matchups (TvT/TvP/TvZ, PvT/PvP/PvZ, ZvT/ZvP/ZvZ) with race-themed colors.
- Build orders shown as a clean paginated list with configurable page size — no per-step "click next".
- Race-color accent stripe on the build card, alternating-row steps list, hairline borders, translucent panels, soft toasts.
- Search, favorites, compact mode (auto-engages on short windows below 560 px tall), opacity slider, configurable default race.
- Cross-platform window opacity: `SetLayeredWindowAttributes` on Windows, `NSWindow setAlphaValue:` on macOS, `gtk_widget_set_opacity` on Linux.
- Global hotkeys: race / opponent / next-prev build / page paging / favorite / compact / hide.
- `F12` and `Ctrl+Shift+I` toggle DevTools in any build; `BW_DEVTOOLS=1` env var auto-opens DevTools on launch.
- Fatal-error red banner inside the overlay window if the renderer fails to boot.
- Custom hex + BW monogram app icon (`assets/icon.svg`); reads cleanly at 16 px and 256 px.

### Liquipedia integration

- `{{build}}` template parser with multi-variant pages, infobox extraction (creator, popularizer, race, matchups), counters and difficulty tags.
- Single-page preview/import and bulk import per race in "common" (curated subset) or "all" modes.
- Updates tab diffs each Liquipedia-sourced build's stored revision id against the latest wiki revision; selectively or wholesale refresh outdated builds while preserving favorite, userNotes, and recentlyUsedAt.
- Custom-edited builds (`customEdited` flag) are protected from refreshes unless explicitly forced.
- Configurable User-Agent and rate-limit (default 2300 ms) for Liquipedia API calls.

### Architecture

- **Tauri 2 + Rust backend.** UI runs in the OS-bundled WebView (WebView2 / WKWebView / WebKitGTK); no Chromium download. Windows installer is ~5–10 MB; idle RAM ~30–80 MB.
- **TypeScript renderer**, bundled by esbuild into a single self-contained ESM file (`dist-frontend/renderer.js`). The renderer uses `@tauri-apps/api/core invoke()` and `@tauri-apps/api/event listen()` to call into Rust.
- **Rust backend** (`src-tauri/src/`) owns: persistent storage (`storage.rs`, `SCHEMA_VERSION = 4`), Liquipedia client + parser + importer (`liquipedia/`), window/opacity/global-shortcut wiring (`window.rs`), and the `#[tauri::command]` surface (`commands.rs`).

### Build + release pipeline

- Per-OS bundles produced by `npm run tauri:build`: NSIS `.exe` + `.msi` (Windows), universal `.dmg` + `.app.tar.gz` (macOS), `.AppImage` + `.deb` (Linux).
- `npm run dev` runs `esbuild --watch` for the renderer plus `npx tauri dev` for the Rust backend; renderer changes hot-reload, Rust changes recompile + relaunch.
- `npm run size` (via [scripts/report-size.mjs](scripts/report-size.mjs)) prints the size of the latest bundle artifacts.
- `scripts/release.mjs`: `npm run release:patch|minor|major` bumps the version across `package.json` / `Cargo.toml` / `tauri.conf.json`, refreshes `Cargo.lock`, rotates the **last** `## [Unreleased]` heading in CHANGELOG.md, commits as `chore(release): vX.Y.Z`, and tags `vX.Y.Z`.
- GitHub Actions CI: a `quality` job (Ubuntu) runs `format:check`, `lint`, `typecheck`, `cargo fmt --check`, `cargo clippy -- -D warnings`, and `cargo test`; a `package` matrix (Windows + macOS + Ubuntu) builds the renderer and runs `cargo build --tests`.
- GitHub Actions Release: tag-push triggers a Windows + macOS + Ubuntu matrix using [`tauri-apps/tauri-action`](https://github.com/tauri-apps/tauri-action), uploads bundles to a draft Release named `BW Build Overlay vX.Y.Z`.
- Node 24 LTS pinned via `package.json` `engines` and `.nvmrc`. Rust pinned via [`rust-toolchain.toml`](rust-toolchain.toml) (`stable` channel, `clippy` + `rustfmt` components).

### Caveats

- **macOS `.app` / `.dmg` are unsigned.** First launch is blocked by Gatekeeper; right-click → Open the first time, or run `xattr -d com.apple.quarantine /Applications/"BW Build Overlay.app"`.
- **Linux `.deb` depends on `libwebkit2gtk-4.1-0`.** AppImage is a self-contained alternative for distros that don't ship that package.
- **Always-on-top vs Windows taskbar.** Tauri 2 has a known issue where clicking the taskbar can drop the overlay behind it. The app installs a focus-loss listener that re-applies `set_always_on_top(true)` to mitigate this; SC:R itself must run in **Windowed (Fullscreen)** mode for any always-on-top window to work.
