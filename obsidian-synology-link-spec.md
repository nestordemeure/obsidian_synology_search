# Obsidian Synology Link Plugin — Project Spec

## Overview

An Obsidian community plugin that lets users search for files on a Synology NAS (via QuickConnect or direct URL) and insert authenticated links into their notes. The primary use case is a user who takes reading notes in Obsidian and wants to link those notes to the corresponding book files (PDFs, EPUBs, etc.) stored on their NAS.

---

## Core User Flow

1. User right-clicks in the editor.
2. Context menu shows **"Add Synology link"** alongside Obsidian's native "Add link" / "Add external link" options.
3. Clicking it opens a modal with a text input field.
4. If the user had text selected, the search field is pre-populated with that text.
5. As the user types (debounced ~300ms), the plugin searches the Synology NAS via the File Station API and displays results in a dropdown.
6. User selects a file from the dropdown.
7. A markdown link is inserted at the cursor position (or wrapping the selected text).

The plugin should also register this as a **command** ("Synology: Insert file link") so it is accessible via the command palette and can be assigned a hotkey.

---

## Synology Integration

### Authentication

- Use the Synology DSM Web API.
- Authenticate via `SYNO.API.Auth` (`/webapi/auth.cgi`) to obtain a session ID (`_sid`).
- The plugin must handle **QuickConnect URL resolution**. QuickConnect IDs (e.g., `mynas`) need to be resolved to an actual reachable address. The resolution flow:
  1. POST to `https://global.quickconnect.to/Serv.php` with the QuickConnect ID to get server info (relay, direct connect, etc.).
  2. Try direct LAN/WAN addresses first, then fall back to Synology's relay tunnel.
  3. Cache the resolved URL for the session to avoid repeated resolution.
- If the user provides a direct URL (e.g., `https://mynas.synology.me:5001`) instead of a QuickConnect ID, skip resolution and use it directly.
- Sessions should be cached in memory and re-authenticated lazily when they expire (File Station returns error 119 for expired sessions).

### File Search

- Use `SYNO.FileStation.Search` API:
  1. `start` method: initiates an async search task on the NAS. Parameters:
     - `folder_path`: the configured root folder(s) to search within.
     - `pattern`: the user's search query (supports wildcards; wrap input in `*query*` for substring matching).
     - `extension`: optionally filter by file extensions (e.g., `pdf,epub,djvu,mobi`).
  2. `list` method: polls the search task for results. Returns file paths, names, sizes.
  3. `stop` method: cancels the search task (call on modal close or new search).
- Debounce the search: wait 300ms after the user stops typing before firing a new search. Cancel any in-progress search task before starting a new one.
- Scope searches to user-configured folder path(s).

### Link Generation

- Store links using a **custom URI scheme**: `synology://` followed by the file path on the NAS.
- Format inserted into the note: `[display text](synology:///path/to/file.pdf)`
  - Display text defaults to the filename (without extension), or the user's selected text if they had a selection.
- Register a **markdown post-processor** that intercepts clicks on `synology://` links. On click:
  1. Authenticate (or reuse cached session).
  2. Construct a File Station download URL: `/webapi/entry.cgi?api=SYNO.FileStation.Download&version=2&method=download&path=<encoded_path>&_sid=<session_id>`
  3. Open the URL in the user's default browser.

---

## UI Components

### Settings Tab

The plugin settings panel should have:

| Setting | Type | Description |
|---|---|---|
| Connection type | Dropdown | "QuickConnect ID" or "Direct URL" |
| QuickConnect ID | Text | e.g., `mynas` (shown when connection type is QuickConnect) |
| Direct URL | Text | e.g., `https://192.168.1.50:5001` (shown when connection type is Direct URL) |
| Username | Text | DSM login username |
| Password | Password | DSM login password (stored via Obsidian's `saveData` — note: this is NOT encrypted, warn the user) |
| Search folder(s) | Text | Comma-separated NAS folder paths to search, e.g., `/volume1/Books,/volume1/Papers` |
| File extensions | Text | Comma-separated extensions to filter by, e.g., `pdf,epub,djvu,mobi`. Empty = all files. |
| Connection test button | Button | Attempts authentication and shows success/failure notice |

### Search Modal

- Subclass `SuggestModal<FileResult>` from the Obsidian API.
- `getSuggestions(query: string)`:
  - Debounce 300ms.
  - Fire Synology File Station search.
  - Return results as they arrive (poll the search task).
  - Show a loading indicator while the search is in progress.
- `renderSuggestion(item: FileResult, el: HTMLElement)`:
  - Show filename (bold) and parent folder path (muted/smaller) so the user can distinguish files with similar names.
  - Show file size.
- `onChooseSuggestion(item: FileResult)`:
  - Insert the `synology://` link at the cursor position.
  - If text was selected, wrap it as the link display text.
- Pre-populate the input field with selected text if any.
- On modal close, cancel any in-progress search tasks.

---

## Technical Architecture

### File Structure

```
obsidian-synology-link/
├── manifest.json
├── package.json
├── tsconfig.json
├── esbuild.config.mjs
├── src/
│   ├── main.ts              # Plugin entry point, command/menu registration
│   ├── settings.ts           # Settings tab, types, defaults
│   ├── synology-api.ts       # All Synology API communication
│   ├── search-modal.ts       # SuggestModal subclass
│   └── link-handler.ts       # Markdown post-processor for synology:// links
```

### Key Types

```typescript
interface SynologyLinkSettings {
  connectionType: 'quickconnect' | 'direct';
  quickConnectId: string;
  directUrl: string;
  username: string;
  password: string;
  searchFolders: string;    // comma-separated
  fileExtensions: string;   // comma-separated
}

interface FileResult {
  path: string;             // full NAS path, e.g., /volume1/Books/Author - Title.pdf
  name: string;             // filename
  size: number;             // bytes
  isdir: boolean;
}
```

### Synology API Client (`synology-api.ts`)

This module encapsulates all NAS communication. Key responsibilities:

- **`resolveQuickConnect(id: string): Promise<string>`** — Resolves a QuickConnect ID to a reachable base URL. Cache the result.
- **`authenticate(): Promise<string>`** — Returns a session ID. Cache it; re-auth on 119 errors.
- **`getBaseUrl(): Promise<string>`** — Returns the resolved/direct base URL.
- **`searchFiles(query: string, folders: string[], extensions: string[]): Promise<FileResult[]>`** — Manages the full search lifecycle (start → poll → return results). Should accept an `AbortSignal` or similar mechanism so the modal can cancel in-flight searches.
- **`getDownloadUrl(path: string): Promise<string>`** — Authenticates if needed and returns a working download URL.
- **`testConnection(): Promise<boolean>`** — For the settings panel.

All HTTP requests should use Obsidian's `requestUrl()` function (avoids CORS issues, works on mobile).

### Link Handler (`link-handler.ts`)

- Register a `markdownPostProcessor` that finds rendered `<a>` elements with `href` starting with `synology://`.
- Replace their click behavior: prevent default, call `getDownloadUrl()`, open in browser via `window.open()`.
- Style these links with a small icon or CSS class so they're visually distinct (optional but nice).

---

## Error Handling

- **Connection failures**: Show an Obsidian `Notice` with a clear message (e.g., "Cannot reach Synology NAS. Check your connection settings.").
- **Auth failures**: "Authentication failed. Check your username and password in Synology Link settings."
- **Empty search results**: Show "No files found" in the modal dropdown.
- **QuickConnect resolution failure**: Fall back gracefully; suggest the user try a direct URL instead.
- **Search timeout**: If the search task doesn't return results within ~10 seconds, show a notice and cancel.
- All errors should be caught and surfaced as user-friendly `Notice` messages, never silent failures or raw error dumps.

---

## Build & Development

- Use **TypeScript**.
- Use **esbuild** for bundling (standard for Obsidian plugins).
- Target: `manifest.json` with `minAppVersion` of `1.0.0`.
- The plugin should have zero runtime dependencies beyond the Obsidian API — all Synology communication is plain HTTP via `requestUrl()`.
- Include a `.gitignore` for `node_modules/`, `main.js`, `data.json`, and `.env`.
- Create a `.env.example` file with dummy credentials for developer reference:
  ```
  SYNOLOGY_QUICKCONNECT_ID=mynas
  SYNOLOGY_DIRECT_URL=https://192.168.1.50:5001
  SYNOLOGY_USERNAME=testuser
  SYNOLOGY_PASSWORD=testpassword123
  SYNOLOGY_SEARCH_FOLDERS=/volume1/Books,/volume1/Papers
  SYNOLOGY_FILE_EXTENSIONS=pdf,epub,djvu,mobi
  ```
- Also create a `.env` file with the same dummy content so the developer can immediately fill in real credentials for testing. This file is gitignored so real credentials are never committed.
- The `.env` file is **for manual testing only** (e.g., curl scripts, standalone test harnesses). The plugin itself reads credentials from Obsidian's settings UI / `saveData`, not from `.env`.

### `manifest.json`

```json
{
  "id": "synology-link",
  "name": "Synology Link",
  "version": "0.1.0",
  "minAppVersion": "1.0.0",
  "description": "Search and link to files on your Synology NAS directly from Obsidian.",
  "author": "",
  "isDesktopOnly": false
}
```

---

## Scope & Non-Goals

### In scope
- Right-click menu integration ("Add Synology link")
- Command palette command
- Live search via File Station API with debouncing
- Custom `synology://` protocol links
- Click-to-open via authenticated download URLs
- QuickConnect resolution
- Direct URL support
- Settings UI with connection test
- Pre-population of search from text selection

### Not in scope (for v1)
- File preview/thumbnails in the modal
- Uploading files to the NAS
- Browsing NAS folders (tree view)
- Local file caching/index
- Two-factor authentication for DSM
- HTTPS certificate validation bypass (users should configure their NAS with a valid cert or use QuickConnect)
- Editing or renaming files on the NAS

---

## Synology API Reference (Quick Reference)

All endpoints are at `<base_url>/webapi/entry.cgi` (DSM 7+) or `<base_url>/webapi/<api_path>` (DSM 6).

### Auth
```
POST /webapi/entry.cgi
api=SYNO.API.Auth&version=6&method=login
&account=<user>&passwd=<pass>&session=FileStation&format=sid
```
Response: `{ "data": { "sid": "..." }, "success": true }`

### Info (discover API paths)
```
GET /webapi/entry.cgi
api=SYNO.API.Info&version=1&method=query&query=all
```

### Search — Start
```
POST /webapi/entry.cgi
api=SYNO.FileStation.Search&version=2&method=start
&folder_path=<path>&pattern=<query>&_sid=<sid>
```
Response: `{ "data": { "taskid": "..." }, "success": true }`

### Search — List (poll)
```
POST /webapi/entry.cgi
api=SYNO.FileStation.Search&version=2&method=list
&taskid=<taskid>&_sid=<sid>&limit=20&offset=0
```
Response: `{ "data": { "files": [...], "finished": true/false, "total": N }, "success": true }`

### Search — Stop
```
POST /webapi/entry.cgi
api=SYNO.FileStation.Search&version=2&method=stop
&taskid=<taskid>&_sid=<sid>
```

### Download (for link handler)
```
GET /webapi/entry.cgi
api=SYNO.FileStation.Download&version=2&method=download
&path=<encoded_path>&mode=open&_sid=<sid>
```

### QuickConnect Resolution
```
POST https://global.quickconnect.to/Serv.php
Body: { "version": 1, "command": "get_server_info", "id": "<quickconnect_id>", "serverID": "DiskStation" }
```
Response includes `server.interface`, `server.external`, `service.relay_ip`, `service.port`, etc. Try interfaces in order: LAN → WAN → relay.

---

## Testing Notes

- To test without a real NAS, the `synology-api.ts` module should be structured so it can be easily mocked. Keep all HTTP calls behind the API client interface.
- The QuickConnect resolution can be tested against real QuickConnect IDs (they're public endpoints).
- For manual testing, the Synology File Station API can be exercised directly via curl or Postman.
