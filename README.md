# Shiye — Web Highlights & Notes

English · [简体中文](README.zh-CN.md)

[MIT License](LICENSE) · [Privacy Policy](PRIVACY.md) · [Contributing](CONTRIBUTING.md) · [Publishing](docs/PUBLISHING.md)

Shiye (拾页) is a local-first Chrome and Edge extension for highlighting text, taking notes, and annotating screenshots. Each saved item keeps its source URL and reading position so you can return to the original context.

Built with vanilla JavaScript and Manifest V3. No account, backend, or runtime dependencies are required. The extension UI is currently in Simplified Chinese.

![Shiye note library](docs/assets/library.png)

## Install

Download a package from [GitHub Releases](https://github.com/blacker521/shiye-web-notes/releases):

- **`shiye-extension-v1.0.0.zip`** — the extension's runtime files.
- **`shiye-web-notes-v1.0.0.zip`** — the complete source and development documentation.

The extension is currently installed through developer mode; it is not listed in the Chrome Web Store.

1. Extract the ZIP and locate the directory containing `manifest.json`. You can also load this repository directly.
2. Open `chrome://extensions` in Chrome or `edge://extensions` in Edge.
3. Enable **Developer mode**, choose **Load unpacked**, and select that directory.
4. Pin Shiye to the browser toolbar and **refresh any article tabs that were already open**.

Keep the extracted directory in place: the browser loads the extension from it. To update, replace the files in the same directory, click **Reload** on the extension's management card, and refresh article and library tabs. Export a JSON backup before uninstalling or moving between installations with different extension IDs.

### Local HTML files

For `file:///` pages, open Shiye's extension details and enable **Allow access to file URLs**, then refresh the HTML page. This also works with HTML articles downloaded or cached by other applications.

Shiye checks this setting and shows instructions when access is missing. The extension cannot enable the browser's file-access setting itself.

The initial open-source release is **1.0.0**, including all current features and fixes.

## Features and usage

- **Text highlights and notes:** select article text to open the floating toolbar, choose one of four colors, and highlight or add a note. Click the small dot beside a highlight to edit it. Press `Ctrl/Cmd + Enter` in the note editor to save.
- **Page notes:** use the toolbar popup to record a thought about the page and save your current reading position.
- **Screenshot annotations:** capture the **currently visible area**, then crop, draw rectangles and arrows, use the freehand pen, or add text. Undo, reset, save to the library, or download a PNG.
- **Return to the source:** open a saved item from the library to visit its original URL and locate the marked passage. Cropped screenshots retain the crop's position within the source page.
- **Search and organize:** search titles, quotations, notes, and URLs; filter by type or source; sort by time; edit notes and colors; preview images; or delete records. Press `/` to focus library search.
- **Hide highlights:** temporarily hide or show highlights on the current page for that visit.

Screenshot editor shortcuts:

| Key | Action |
| --- | --- |
| `R` | Rectangle |
| `A` | Arrow |
| `P` | Freehand pen |
| `T` | Text |
| `C` | Crop |
| `Ctrl/Cmd + Z` | Undo |
| `Esc` | Cancel the current operation |

## Local storage and backups

Saved notes and images use `chrome.storage.local` and remain available after closing tabs or restarting the browser. Screenshot copies are stored with the notes, without relying on images hosted by the original website.

Temporary original screenshots use session storage first, with a local-storage fallback when necessary. Starting another capture removes temporary screenshots older than 24 hours; cleanup is not an exact scheduled deadline. Unsaved screenshot edits remain in memory. The editor warns before leaving with unsaved changes, but **unsaved drawing drafts cannot be restored**.

Exports always include **all notes**, regardless of current search or filter settings.

| Format | Purpose | Contents |
| --- | --- | --- |
| JSON backup | Restore or migrate | Notes, quotations, full URLs, text anchors, positions, timestamps, colors, and embedded screenshot data |
| Markdown | Read in tools such as Obsidian | Text, quotations, source links, and position details; download screenshot files separately |
| PNG / JPEG | Save annotated images | Download from the editor or item details; imported JPEG images retain their format |

JSON imports merge records by ID. New IDs are added; an existing record is replaced only if the imported `updatedAt` is later. Equal timestamps keep the local version. Importing does not remove other local records, and a previously deleted record can return if it exists in the backup. Duplicate IDs, invalid formats, or unsafe URLs reject the entire import without partially changing saved notes.

Limits are **20 MiB per image**, **10,000 notes**, **140 MiB for the normalized library**, and **150 MiB per backup file**. Before saving, Shiye also checks the size of a complete export so the backup can be imported again. Large imports use trusted local staging rather than sending the entire backup through extension messaging.

There is no browser cloud sync. Exports are initiated by you and downloaded to a browser-selected location; Shiye does not automatically rewrite files on disk. Uninstalling the extension, deleting the browser profile, or clearing extension data removes local notes. Export a JSON backup first.

## Source positioning and supported pages

Each record keeps the original full URL, including its query string and fragment, page title, timestamps, and scroll position. Text highlights also store the selected passage, surrounding context, and text offsets. These anchors help distinguish repeated passages and recover highlights when content is inserted before them. Page matching ignores the URL fragment and preserves the query string.

If the passage no longer matches, Shiye falls back to the saved scroll position and displays a notice. Opening a saved highlight waits up to about 10 seconds for asynchronously loaded article text. Major page changes, deleted content, or different login states can affect positioning.

Supported content is the top-level text of ordinary HTTP/HTTPS pages and authorized local HTML files. Current limitations include:

- Browser internal pages, extension stores, built-in PDF readers, and remote file servers.
- Text inside cross-origin iframes, closed Shadow DOM, or canvas elements.
- Incomplete positioning in hash-routed applications, virtual lists, and nested scroll containers.
- No full-page scrolling screenshots or OCR.

Local HTML items appear under a local-file source and retain their full paths. Moving, deleting, or clearing the source file breaks its original link; backed-up quotations, notes, and screenshots remain recoverable. A JSON backup does not include a complete copy of the HTML file.

## Permissions and privacy

| Permission | Purpose |
| --- | --- |
| HTTP/HTTPS host access | Show the selection toolbar and automatically restore highlights when you revisit pages |
| `file:///*` | Provide the same tools for local HTML after you enable file URL access |
| `favicon` | Display website icons using the browser's internal favicon resource |
| `activeTab` | Capture the visible area of the current tab after you invoke the extension |
| `scripting` | Inject tools into pages opened before the extension was installed |
| `storage`, `unlimitedStorage` | Store notes and images locally, subject to the application limits above |

Shiye has no developer-operated content-upload endpoint, telemetry, external scripts, external fonts, or third-party favicon proxy. It does not request access to the browser's history database. The browser's own favicon caching and network behavior are governed by its implementation and privacy settings.

Content scripts access only notes for their current page through the background worker; full storage is restricted to trusted extension contexts. Stored data and exported backups are not additionally encrypted and can contain private URLs, local paths, quotations, and screenshots. See the [Privacy Policy](PRIVACY.md) before sharing them.

## Try it locally

From the repository directory:

```bash
python3 -m http.server 8765 --bind 127.0.0.1
```

Open `http://127.0.0.1:8765/demo/article.html` to try selection, notes, screenshots, and source navigation. You can also open the HTML file directly after enabling file URL access.

## Development and verification

The extension needs no build step or runtime installation. Basic checks require Node.js 20+ and Python 3:

```bash
npm test
npm run check
npm run package
```

Browser tests additionally require Playwright and Chromium:

```bash
npm install --no-save --package-lock=false playwright
npx playwright install chromium
npm run test:e2e
npm run test:e2e:file
npm run test:e2e:icons
```

Set `PLAYWRIGHT_MODULE` to use an existing Playwright module or `PLAYWRIGHT_EXECUTABLE_PATH` to select a Chromium executable. Tests use temporary browser profiles and local demonstration content, then remove those profiles. They do not use your everyday browser profile.

Release verification covered 26 unit tests, 15 web-page checks, 12 local-file checks, 8 icon checks, and resource/CSP validation. Coverage includes backup restoration, source navigation, asynchronous text loading, strict page CSP, actual SVG rendering, favicon pixels and fallback behavior, and narrow-window layouts. Editor tests use page PNGs; native toolbar capture was separately verified on local HTML at 2880 × 2000 pixels.

## Code map

| Files | Responsibility |
| --- | --- |
| `manifest.json` | Extension metadata, permissions, and injection scope |
| `anchors.js`, `content.js`, `content.css` | Text anchoring, native highlights, selection tools, and page notes |
| `background.js`, `store.js` | Message authorization, serialized writes, validation, capture, and source navigation |
| `popup.*`, `page-access.js` | Toolbar popup, page detection, and connection timeouts |
| `library.*` | Note library, search, import, and export |
| `ui-icons.js`, `icons/ui.svg` | Bundled SVG icons, website favicons, and local-file icons |
| `screenshot.*` | Canvas annotations and image export |
| `tests/` | Unit, background-message, and browser-flow checks |

Built against the official [Tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs), [Storage API](https://developer.chrome.com/docs/extensions/reference/api/storage), [file-access API](https://developer.chrome.com/docs/extensions/reference/api/extension#method-isAllowedFileSchemeAccess), [favicon guidance](https://developer.chrome.com/docs/extensions/how-to/ui/favicons), and [extension messaging limits](https://developer.chrome.com/docs/extensions/develop/concepts/messaging#message-size-limits).
