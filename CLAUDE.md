# Dirview — Development Instructions

## Overview

VSCode extension that visualizes per-directory file type composition as GitHub-style colored proportional bars. Provides three panels: a sidebar tree view, an editor tab view (with toolbar and legend), and a standalone languages legend panel.

## Development Principles

- **Tab is the primary view; sidebar is summarised** — the editor tab (`tab.ts`) is the full-featured view. The sidebar (`main.ts`) is a secondary, summarised companion suited to its narrow width. New features default to the tab; apply them to the sidebar only when they make sense at narrow widths. The two views share modules via `index.ts` but have independent state.
- **Document new features thoroughly** — when implementing a new feature or changing existing behavior, update inline code comments explaining the design rationale, update the "User Actions & Rendering Effects" tables in this file, and add any non-obvious architectural decisions as comments at the point of implementation.
- **Add tests for bugs** - when bug fixing, add tests to ensure this and similar classes of bugs don't crop up again.

## Build & Watch

```bash
npm run compile        # Production build: esbuild (minified) + copy CSS
npm run compile:dev    # Dev build: esbuild (unminified) + copy CSS
npm run watch          # Continuous: esbuild watch + CSS watcher
npm run watch:dev      # Continuous: same as watch but unminified
```

Output goes to `out/`. esbuild bundles the extension (`out/extension.js`), a scan worker thread (`out/scanWorker.js`), and three webview IIFE bundles (`out/webview/{main,tab,languages}.js`) from TypeScript sources. CSS files are copied from `src/views/webview/` to `out/webview/` by `scripts/copyWebview.js`.

The `--dev` flag controls minification: dev builds are unminified for easier debugging.

## Architecture

### Backend (TypeScript)

| File | Purpose |
|------|---------|
| `src/extension.ts` | Entry point: activate/deactivate, command registration, wires scanner→providers→watcher |
| `src/config.ts` | Persists toggle state (showIgnored, truncation, sortMode) to workspaceState |
| `src/scanner/fileScanner.ts` | Scan orchestration: dispatches to worker thread (local) or `scanDirRemote` (remote). Remote scan uses `vscode.workspace.fs`. |
| `src/scanner/scanWorker.ts` | Worker thread entry point for local scans. Contains `scanDirLocal()` using raw `fs` APIs. Bundled separately by esbuild → `out/scanWorker.js`. |
| `src/scanner/scanWorkerClient.ts` | Main-thread wrapper: spawns long-lived worker, promise-based API, abort support. |
| `src/scanner/ignoreFilterBase.ts` | Pure JS ignore filter (no vscode). Shared by worker and main thread. |
| `src/scanner/ignoreFilter.ts` | VSCode wrapper around `IgnoreFilterBase` for remote scans (reads `files.exclude` config, loads `.gitignore` via `vscode.workspace.fs`) |
| `src/scanner/types.ts` | Core interfaces: DirNode, FileNode, FileTypeStats |
| `src/scanner/constants.ts` | VCS directory blacklist (.git, .hg, .svn, .bzr, _darcs) |
| `src/language/languageMap.ts` | Extension/filename → {name, color} via linguist-languages, with PREFERRED map for ambiguous extensions |
| `src/highlight/highlighter.ts` | Syntax highlighting support for search result matches |
| `src/views/sidebarProvider.ts` | WebviewViewProvider for sidebar panel |
| `src/views/tabProvider.ts` | Multi-instance WebviewPanel manager for editor tabs. Each tab is keyed by its root directory path ('' = full workspace). Supports opening any directory subtree in its own tab. |
| `src/views/languagesProvider.ts` | WebviewViewProvider for standalone languages legend |
| `src/views/providerUtils.ts` | Shared provider utilities: webview HTML generation, message posting helpers |
| `src/views/getNonce.ts` | CSP nonce generator |
| `src/scanner/concurrency.ts` | Concurrency-limited async map utility for parallel scanning |
| `src/watcher/fileWatcher.ts` | FileSystemWatcher with 500ms debounce, auto-disables above threshold |

### Frontend (TypeScript — webview)

Webview source lives in `src/views/webview/`. Each entry point is bundled by esbuild into a self-contained IIFE.

| File | Purpose |
|------|---------|
| `main.ts` | Sidebar entry point: init and message handler. Options: skipDepthZeroGuides, hideCounts |
| `tab.ts` | Tab entry point: toolbar buttons, sort cycling, filter legend, truncation/ignored toggles, search |
| `languages.ts` | Standalone legend panel entry point |
| `index.ts` | Barrel re-export of all shared modules |
| `state.ts` | State factory (createState) |
| `messaging.ts` | VSCode postMessage wrapper |
| `search.ts` | Search bar UI + search utilities |
| `utils.ts` | Formatting, sorting, stats aggregation |
| `icons.ts` | SVG icon helpers |
| `h.ts` | Typed hyperscript helper for DOM construction |
| `filter.ts` | Pre-render tree filtering layer: produces shallow-cloned tree with only visible nodes |
| `setup.ts` | Common setup (legend rendering, shared init) |
| `types.ts` | Shared TypeScript interfaces |
| `renderer/` | Tree renderer: `index.ts` (core entry, row construction), `render-tree.ts`, `dom-patch.ts`, `events.ts`, `matches.ts` |
| `virtual/` | Virtual scrolling: `scroller.ts` (viewport-aware row rendering), `flatten.ts` (tree→flat row list), `sticky-overlay.ts` (sticky headers in virtual scroll), `types.ts` |

### Stylesheets

| File | Purpose |
|------|---------|
| `style.css` | Tree/bar/tooltip styling using VSCode CSS variables |
| `tab.css` | Tab-specific layout (toolbar, legend section, flex column body) |
| `languages.css` | Legend item styling (swatch, active/inactive states) |

### Data Flow

```
FileWatcher → doScan() → scanWorkspace()
                              ├─ local: ScanWorkerClient → Worker Thread → DirNode tree
                              └─ remote: scanDirRemote (main thread) → DirNode tree
                                    ↓
                        ┌───────────┼────────────┐
                        ↓           ↓            ↓
                     Sidebar    Languages      Tab
                     Provider    Provider     Provider
                        ↓           ↓            ↓
                     main.ts   languages.ts   tab.ts
                        └───────────┴────────────┘
                             shared modules (index.ts)
```

## CDP Debug Bridge

Evaluates JavaScript directly inside webview iframes via CDP (Chrome DevTools Protocol). Works on any build — no special compile flags needed.

### How it works

1. **`launch-cdp.sh [workspace-path]`** starts VSCode with two debug ports:
   - Accepts an optional workspace path argument (defaults to `test-repos/source`)
   - `--remote-debugging-port=9222` — Electron renderer (screenshots, DOM, key presses via MCP)
   - `--inspect-extensions=9223` — Extension host Node inspector (JS eval in extension context)

2. **`debug-eval.js`** connects directly to CDP on port 9222, discovers the webview iframe target for the requested view (sidebar/tab/languages), navigates to its inner content frame, and evaluates scripts via `Runtime.evaluate` with `awaitPromise` support.

3. For `host` target, it connects to port 9223 instead and evaluates in the extension host's Node.js context.

### Usage

```bash
# Terminal 1: Launch the debug instance (defaults to test-repos/source)
./scripts/launch-cdp.sh
# Or with a specific workspace:
./scripts/launch-cdp.sh /path/to/workspace

# Terminal 2: Write a script file, then eval it in a specific frame
npm run debug-eval -- tab /tmp/debug-script-foo.js
npm run debug-eval -- sidebar                        # default script: /tmp/dirview-debug.js
npm run debug-eval -- languages
npm run debug-eval -- host                           # eval in extension host Node context
```

The `chrome-devtools` MCP server (configured in `.claude.json`) connects to port 9222 for renderer-level tools: screenshots, key presses (`Meta+r` to reload), DOM snapshots.

### Evaluating JS in a webview

**Workflow** — zero permission prompts (covered by the existing `Bash(npm run:*)` permission):

```bash
# 1. Write the script to a file using the Write tool.
#    The script runs inside the target webview and must produce a result string.
#    End with JSON.stringify(...) for structured output.

# 2. Eval it.
npm run debug-eval -- tab /tmp/debug-script-foo.js
```

**Useful patterns inside debug scripts:**

```js
// Computed style inspection
const el = document.querySelector('.dir-row');
const cs = getComputedStyle(el);

// Live style mutation to test a fix without recompiling
el.style.alignItems = 'center';
const heightAfter = el.offsetHeight;
el.style.alignItems = '';  // restore

// Layout measurement
const rect = el.getBoundingClientRect();

// Always end with a serialisable result
JSON.stringify({ height: rect.height, width: rect.width });
```

### Key files

| File | Role |
|------|------|
| `scripts/launch-cdp.sh` | Launches isolated VSCode with both debug ports |
| `scripts/debug-eval.js` | Connects to CDP, finds webview iframe targets, evaluates scripts via `Runtime.evaluate` |
| `src/views/buildWebviewHtml.ts` | Generates webview HTML with CSP and script/style tags |

## Publishing

To publish a new version to the VS Code Marketplace:

1. Bump the version in `package.json` (follow semver)
2. **Review all commits since the last version bump** — run `git log <last-version-commit>..HEAD --oneline` to find the previous version bump commit (message is just the version number, e.g. `0.3.2`). Check every commit since then and ensure all changes are reflected in `CHANGELOG.md`. Commits may have been made across multiple conversations and easily missed.
3. Before committing, update `CHANGELOG.md` with a summary of changes for the new version.
4. Run `npm run compile`
5. Run `vsce publish`

`vsce` and the publisher PAT are pre-configured. The marketplace URL is:
https://marketplace.visualstudio.com/items?itemName=zwoosh.dirview

After publishing, commit the version bump:
```bash
git add package.json CHANGELOG.md && git commit -m "x.y.z"
```

## Testing

```bash
npm test              # vitest run
```

Note: `test-repos/` contains sample repositories used for visual testing of the scanner. The test files inside them are not part of the project's test suite.

**Tests are required for new functionality.** Tests are colocated with their modules (e.g. `filter.test.ts`, `dom-patch.test.ts`, `expand-collapse.test.ts`). When adding or changing logic, add tests in the corresponding `*.test.ts` file alongside the source. Run `npm test` to confirm all tests pass before considering a task complete.

## Extension Commands

- `dirview.refresh` — Manual rescan
- `dirview.toggleIgnored` / `dirview.toggleIgnoredOff` — Show/hide ignored files (gitignore + files.exclude; VCS dirs like .git always excluded)
- `dirview.cycleSortFiles` / `dirview.cycleSortName` / `dirview.cycleSortSize` — Cycle sort mode (three separate commands, one per active mode icon)
- `dirview.openInTab` — Open in editor tab
- `dirview.toggleTruncation` / `dirview.toggleTruncationOff` — Toggle file truncation
- `dirview.toggleStickyHeaders` / `dirview.toggleStickyHeadersOff` — Toggle sticky directory headers
- `dirview.expandAll` / `dirview.collapseAll` — Expand/collapse all directories
- `dirview.languagesShowPct` / `dirview.languagesShowCount` — Toggle percentage/count display in languages panel
- `dirview.contextCopyPath` — Copy file/dir path (context menu)
- `dirview.contextRevealInExplorer` — Reveal in Explorer (context menu)
- `dirview.contextOpenFile` — Open file (context menu)
- `dirview.contextOpenInTerminal` — Open in terminal (context menu)
- `dirview.contextCopyLineText` — Copy line text (context menu)
- Context keys: `dirview.showIgnored`, `dirview.truncationEnabled`, `dirview.allExpanded`, `dirview.sortMode`, `dirview.stickyHeadersEnabled`
- Config: `dirview.autoRescanThreshold` (default 10000), `dirview.maxDepth` (default 0 = unlimited), `dirview.truncateThreshold` (default 3), `dirview.openTabOnStartup` (default false), `dirview.allowDuplicateTabs` (default true)

## User Actions & Rendering Effects

### Tree interactions (both views)

| Action | Effect |
|--------|--------|
| Click directory row | Toggles expand/collapse. On collapse: resets truncation for that dir, full re-render. On expand: toggles chevron + children visibility (no re-render). |
| Click file row | Opens the file in VSCode editor (`vscode.open`). |
| Click indent guide | Collapses the ancestor directory that guide belongs to. Triggers re-render. |
| Hover directory row | Shows tooltip below the bar with per-language breakdown (swatch, name, %, count). |
| Click "N more files" row | Expands truncated files inline (no full re-render). Adds dir to `truncationExpanded`. |
| Click "N empty directories" row | Expands empty dir group inline, rendering each empty dir node. |
| Per-dir expand children button | 3-tier escalation: (1) target collapsed → expand target only; (2) target expanded, not all children expanded → expand all direct children; (3) all children expanded → recursively expand entire subtree. |
| Per-dir collapse children button | 3-tier de-escalation (mirrors expand): (1) any descendant beyond direct children expanded → collapse those deeper descendants (direct children stay open); (2) direct children expanded but nothing deeper → collapse all direct children; (3) no children expanded → collapse target itself. |
| Per-dir open-in-tab button | Posts `openDirInTab` message to host. Host calls `tabProvider.openForDir(path)`, which opens a new editor tab rooted at that directory. No re-render of the originating view. |

### Sidebar-specific actions

| Action | Lifecycle | Effect |
|--------|-----------|--------|
| Cycle Sort (title bar) | `dirview.cycleSortFiles`/`cycleSortName`/`cycleSortSize` → `config.cycleSortMode()` → `sidebarProvider.updateSortMode()` → re-posts `update` message | Re-sorts tree. No rescan. Icon changes to reflect active sort mode. |
| Toggle Ignored (title bar) | `dirview.toggleIgnored[Off]` → `config.setShowIgnored()` → `doScan()` → all providers updated | Full rescan with/without ignored files. Tree re-renders with new data. |
| Toggle Truncation (title bar) | `dirview.toggleTruncation[Off]` → `config.setTruncationEnabled()` → threshold sent to sidebar only | Re-renders sidebar tree with truncation enabled/disabled. Clears expanded truncation state if threshold changed. Tabs manage their own truncation state independently. |
| Expand All (title bar) | `dirview.expandAll` → posts `expandAll` to sidebar webview | 3-tier expand (same as per-dir hover button, applied at workspace root level). Re-renders. |
| Collapse All (title bar) | `dirview.collapseAll` → posts `collapseAll` to sidebar webview | 3-tier collapse (same as per-dir hover button, applied at workspace root level). Clears truncation/empty-group expanded state. Re-renders. |
| Refresh (warning banner) | Webview posts `refresh` → `onRefresh` → `doScan()` | Full rescan and update. |

### Tab-specific actions

| Action | Lifecycle | Effect |
|--------|-----------|--------|
| Sort button | Local only: cycles `files`→`name`→`size`, calls `render()` | Re-sorts tree. Updates tab title ("Tree (count/name/size)") and sort button tooltip. No message to host. |
| Toggle Ignored button | Posts `toggleIgnored` → host dispatches `dirview.toggleIgnored[Off]` → `doScan()` | Full rescan. Tab updates eye icon on `update` response. |
| Toggle Truncation button | Posts `toggleTruncation` → host computes threshold → posts `updateTruncation` back | Re-renders with new threshold. Updates fold/unfold icon. |
| Expand/Collapse All button | Local only: `tieredExpandAll`/`tieredCollapseAll` + `render()` | 3-tier expand/collapse (same as per-dir hover buttons, applied at workspace root level). On collapse, clears truncation/empty-group state. |
| Search/file filter | Local regex or glob filter applied client-side. Dynamic debounce based on tree size. | Filters tree to matching files. Status bar shows "N of M files". Clears expand state so matching dirs auto-expand. Regex mode is default; glob mode available via toggle. |
| Legend language click | Toggles language in `activeFilters`, posts `filter` to host (no-op), re-renders locally | When filters activate: clears expand state (all dirs auto-expand to show matches). Only matching files/dirs shown. Legend items get active/inactive styling. |
| Legend header click | Local toggle | Shows/hides the legend items, rotates chevron. |

### Languages panel actions

| Action | Effect |
|--------|--------|
| Click language item | Toggles filter. Posts `filter` to host → forwarded to sidebar via `sidebarProvider.setFilter()`. Both legend and sidebar re-render with filter applied. Tab is NOT affected. |

### Automatic triggers

| Trigger | Effect |
|---------|--------|
| File system change | FileWatcher (500ms debounce) → `doScan()` → all views updated (all open tabs receive updated subtrees) |
| Workspace folder add/remove | `doScan()` → all views updated |
| `dirview.truncateThreshold` config change | New threshold sent to sidebar + all open tabs, all re-render |
| Webview becomes visible | Cached data replayed (100ms delay) |

### Rendering details

- **Folder compaction**: Single-child directory chains (no files) are collapsed into `"a / b / c"` display names.
- **Bar scaling**: Bars are proportional to `metric / maxMetric` where maxMetric is the largest value among non-root nodes. Tab uses `sqrt()` scaling; sidebar uses linear.
- **Sort modes**: `files` = descending by file count, `name` = ascending alphabetical, `size` = descending by byte size. Files within a directory are always sorted alphabetically regardless of mode.
- **Empty dir grouping**: 2+ consecutive empty sibling dirs are grouped into a single "N empty directories" row (only when no filter is active).
- **Virtual scrolling**: Tab view uses virtual scrolling (renders only visible rows + buffer) for large tree performance. Sidebar does not use virtual scrolling.
- **Pre-render filtering**: `filter.ts` produces a shallow-cloned tree with only visible nodes before rendering, so the renderer has no filtering logic.
- **Language filter behavior**: When filters activate, `expanded` map is cleared so all dirs auto-expand (any dir matching the filter shows its contents). `dirMatchesFilter` checks if any of a dir's stats match an active filter.
- **File filter (search bar)**: Tab supports regex and glob file filter modes. Regex is the default. Uses hybrid search: resolves VSCode's bundled ripgrep for content search, falls back to `findFiles` API. File count status shows filtered vs total counts.
- **Empty states**: Centered `emptyState()` component with icons for loading, no results, and error states across all views.
- **Context menus**: Dir and file rows set `data-vscode-context` for right-click menus (copy path, reveal in explorer, open file, open in terminal, copy line text).

## Requirements

Behavioral requirements are defined in `requirements.md` at the project root. This is the authoritative source for how the program should behave.

When working on this codebase:
- **Consult** `requirements.md` before modifying any user-facing functionality, to understand the expected behavior.
- **Update** `requirements.md` when adding or changing features, so it stays in sync with the code.
- **Ask the user to review** any proposed changes to `requirements.md` before making them — requirements changes affect the behavioral contract of the extension.
