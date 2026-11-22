# Chat Export Viewer

Read chat exports (`json`, `jsonl`, `txt`, `.zip`, or files with **no extension at all**) as a conversation you
can scroll and search — ChatGPT, Claude, SillyTavern. Runs fully offline on your phone: no account, no upload,
not even the `INTERNET` permission.

Exporting a chat usually ends with a `conversations.json` nobody opens again — tree-shaped `mapping`,
dozens of metadata fields, nested `parts`. This tool hides that noise and keeps only "who said what",
folding things like `<div class="status">` or `【status】` into collapsible blocks.

| Desktop (auto detect) | Phone |
| --- | --- |
| ![desktop](docs/screenshots/desktop-auto.png) | ![phone](docs/screenshots/mobile-files.png) |

## Install

Android 8.0+, sideload this: **[Download chat-viewer-1.1-debug.apk](https://github.com/Yunmoli1/chat-export-viewer/releases/latest/download/chat-viewer-1.1-debug.apk)**
(1.1, self-signed, ~69 KB, `com.dsh.chatviewer`). Check the manifest: there is **no `INTERNET` permission**,
and `allowBackup` is off, so the recent-files list never leaves the device via cloud backup.

No app needed either — open `prototype/index.html` in a browser (`file://` works, no server).

## What it does

- **Detects by content, not by filename.** Magic-byte sniffing (ZIP/PNG/JPEG/PDF/GZIP/SQLite are rejected
  with an explanation), encoding fallback UTF-8 → UTF-16 BOM → GB18030, then structure scoring for
  JSON / JSONL / chat txt, then semantics: find the collection where ≥60% of members are objects carrying
  both a role field and a text field.
- **Restores ChatGPT trees correctly.** `mapping` is a graph; walking it naively resurrects edited-away
  branches. It walks back from `current_node` via `parent`, reverses, and counts the discarded siblings.
- **Opens ZIP exports directly.** It reads the central directory itself (with a pure-JS inflate
  fallback for old WebViews), handles stored/deflate, ZIP64 and GBK filenames, scores entries by name
  and content to find the chat file, merges `conversations-000.json` shards, and falls back to a
  pickable file list with a "looks like chat" filter. Encrypted entries are explained, not guessed at.
- **Full-text search across every conversation**: hit list with "conversation · excerpt", click to jump
  and flash the message, Enter to cycle, multi-word AND. Substring scan, no index — instant for the
  file sizes the app accepts. On narrow screens the header grows a "Search" button that scrolls to the
  preview column and focuses the box (the single-column layout puts it far down the page).
- **Folds inline decorations** (status / inner thoughts / summary / OOC / choices) into collapsible,
  colour-coded blocks, classified with bilingual keyword tables plus `class` names and CJK pseudo-tags.
- **You decide the sides.** Per-role (me / AI / system / other) and per-block alignment, shared between
  auto and manual mode, persisted.
- **A draggable reading rail**: drag the thumb, click the track, or use the keyboard; tooltip shows
  "42% · message 17/86". On phones it pins to the right edge while the page scrolls.
- **Remembers your files**: SAF URI on Android, File System Access handle in Chrome/Edge, byte cache in
  IndexedDB elsewhere — with a graceful fallback message when the original is gone.
- **Manual mapping when the guess is wrong**: click through detected structural signatures, assign roles
  and text, and get a declarative recipe (`detect` / `locate` / `extract` / `assemble` / `display`) you can
  copy or download.

## Layout

```
prototype/   web prototype — parser engine, UI and end-to-end verification (the main body)
android/     WebView shell that wraps it into a single APK, no Gradle
sniffer/     Java byte-sniffing experiment, not shipped
docs/        design notes (Chinese) and screenshots
dist/        packaged APK
```

## Develop

Node 22+ only — no dependencies, `fetch` and `WebSocket` are global.

```bash
npm run lint      # repo conventions: BOM, no INTERNET permission, versions agree
npm test          # 86 logic assertions
npm run serve     # http://127.0.0.1:8765
npm run verify    # 10 end-to-end checks in headless Edge/Chrome (auto-launched, auto-cleaned)
npm run apk       # build the APK (needs an Android SDK + JDK 11+)
```

`npm run verify` looks for Edge/Chrome in the usual places; set `CV_BROWSER` if it cannot find one.
`npm run serve` uses port 8765 by default; `PORT=9000 npm run serve` if it is taken.

GitHub Actions runs `npm test` plus a check that `samples.js` is a deterministic build artefact.

The signing key lives in `android/keystore/` (`.gitignore`d, generated on the first build, reused afterwards).
Override with `CV_KEYSTORE` / `CV_KEYSTORE_PASS` / `CV_KEY_ALIAS`, or point `CV_APKSIGNER` at another
apksigner binary — see [android/README.md](android/README.md#签名).

## Limitations

- The web version parses everything in memory; the Android shell caps a single file at 16 MB.
  The two-pass streaming design in [docs/design-architecture.md](docs/design-architecture.md) is not implemented yet.
- ZIP is read-only: encrypted entries need a password (unsupported), nested zips are only pointed out,
  entries over 48 MB are not auto-read. No PDF/image export, no CSV. Search is a substring scan.
- HTML exports are parsed heuristically by tags and class names, not a real DOM.
- Built and verified on Windows only; scripts are Node so macOS/Linux should work but are untested.
- Self-signed; the key lives in `android/keystore/` and is not committed. Not a store release.

## Docs

Chinese-first design notes live in `docs/`: [architecture & market notes](docs/design-architecture.md),
[dual-mode mapping](docs/design-dual-mode.md), [file format detection appendix](docs/appendix-file-format-detection.md),
[prototype notes](prototype/README.md), [Android shell](android/README.md), [Java sniffer](sniffer/README.md).

## License

MIT — see [LICENSE](LICENSE). Provided as-is, but it cannot phone home: there is no network permission.
