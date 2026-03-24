# Synology Link — Obsidian Plugin

Search for files on your Synology NAS and insert links into your notes. Clicking a link opens the file directly from the NAS via an authenticated download URL.

## Features

- **Search** — instant keyword search via Synology Universal Search (debounced, case-insensitive, multi-word)
- **Insert links** — inserts `[filename](synology:///path/to/file.pdf)` at cursor
- **Click to open** — `synology://` links authenticate and open the file in your browser (works in both Reading View and Live Preview)
- **QuickConnect & direct URL** — supports both connection methods
- **Context menu & command palette** — right-click "Add Synology link" or use the command palette

## Install

1. Copy `main.js` and `manifest.json` into your vault at `.obsidian/plugins/synology-link/`
2. In Obsidian: Settings > Community plugins > disable Restricted mode > enable "Synology Link"
3. Go to the Synology Link settings tab and configure:
   - NAS URL (direct IP/hostname or QuickConnect URL)
   - Username / password
   - Search folder(s) — comma-separated NAS shared folder paths, e.g. `/Books,/Papers`
4. Click "Test" to verify the connection

Note that the **Universal Search** package must be installed on your Synology NAS (Package Center → Universal Search).

## Usage

- **Right-click** in the editor → "Add Synology link"
- **Command palette** → "Synology Link: Insert file link"
- If you select text first, it pre-fills the search and becomes the link display text

## Development

```bash
npm install
npm run build          # production build → main.js
npm run dev            # development build with sourcemaps
```

### Deploy to a vault for testing

```bash
./deploy.sh /path/to/your/vault
# or run without args to be prompted
./deploy.sh
```

Then restart Obsidian or toggle the plugin off/on to reload.

### Project structure

```
src/
├── main.ts            # Plugin entry point, command/menu registration
├── settings.ts        # Settings tab and defaults
├── synology-api.ts    # QuickConnect resolution, auth, Universal Search, download URLs
├── search-modal.ts    # SuggestModal with debounced NAS search
└── link-handler.ts    # Click handlers for synology:// links (Reading View + Live Preview)
```
