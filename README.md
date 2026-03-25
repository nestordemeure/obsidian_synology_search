# Synology Link — Obsidian Plugin

Search for files on your Synology NAS and insert links into your notes. Links open File Station directly in your browser — they work everywhere: note body, Live Preview, Reading View, and frontmatter properties.

## Features

- **Search** — instant keyword search via Synology Universal Search (debounced, case-insensitive, multi-word)
- **Insert links** — inserts a standard markdown link pointing to File Station
- **Click to open** — opens File Station in your browser, works everywhere including **frontmatter properties**
- **QuickConnect & direct URL** — supports both connection methods
- **Context menu & command palette** — right-click "Add Synology link" or use the command palette

Note that the **Universal Search** package must be installed on your Synology NAS (Package Center → Universal Search).

## Install

### Manual install

1. Copy `main.js` and `manifest.json` into your vault at `.obsidian/plugins/synology-link/`
2. In Obsidian: Settings > Community plugins > disable Restricted mode > enable "Synology Link"
3. Go to the Synology Link settings tab and configure:
   - NAS URL (direct IP/hostname or QuickConnect URL)
   - Username / password
   - Search folder(s) — comma-separated NAS shared folder paths, e.g. `/Books,/Papers`
4. Click "Test" to verify the connection

### BRAT install

You can also install (and auto update) this plugin by installing the [BRAT Obsidian plugin](https://tfthacker.com/BRAT) then adding `https://github.com/nestordemeure/obsidian_synology_search` to its list of beta plugins.

## Usage

- **Right-click** in the editor → "Add Synology link"
- **Command palette** → "Synology Link: Insert file link"
- If you select text first, it pre-fills the search and becomes the link display text

## Development

```bash
npm install
npm run build          # production build → main.js
npm run dev            # development build with sourcemaps
npm run check          # TypeScript typecheck
```

### Deploy to a vault for testing

```bash
./local_deploy.sh /path/to/your/vault
# or run without args to be prompted
./local_deploy.sh
```

Then restart Obsidian or toggle the plugin off/on to reload.

### Release

Create a version bump, commit it, and push a tag that exactly matches the plugin version:

```bash
npm version patch --no-git-tag-version
git add package.json manifest.json versions.json
git commit -m "Release 0.1.1"
git tag 0.1.1
git push && git push --tags
```

GitHub Actions will publish a release with `manifest.json`, `main.js`, and `versions.json`.

### Project structure

```
src/
├── main.ts            # Plugin entry point, command/menu registration
├── settings.ts        # Settings tab and defaults
├── synology-api.ts    # QuickConnect resolution, auth, Universal Search, download URLs
├── search-modal.ts    # SuggestModal with debounced NAS search
└── link-handler.ts    # Backward-compat click handlers for legacy synology:// links
```
