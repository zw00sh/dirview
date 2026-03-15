# Dirview — Behavioral Requirements

This document is the authoritative source for how Dirview should behave. All user-facing functionality is specified here.

## Views

Dirview provides two panels in a dedicated activity bar container, plus multi-instance editor tabs:

1. **Languages panel** — a filterable legend showing workspace-wide language composition
2. **Tree panel (sidebar)** — a summarised directory tree with proportional bars, suited to narrow widths
3. **Editor tab** — the full-featured view with toolbar, inline legend, inline search, and breadcrumb navigation; any directory can be opened in its own tab

The tab is the primary view; the sidebar is a secondary companion. New features default to the tab and are applied to the sidebar only when they make sense at narrow widths.

## Workspace Scanning

- The extension recursively walks all workspace folders using `vscode.workspace.fs`, building a `DirNode` tree.
- Each file is classified by language using `linguist-languages` (extension/filename → name + color). Ambiguous extensions use a PREFERRED map for deterministic results.
- Files classified as "Other" receive a neutral gray color (`#8b8b8b`).
- Each `DirNode` aggregates file count, byte size, and per-language stats from its entire subtree.
- All workspace folders are scanned in parallel; roots appear in the same order as `workspaceFolders`.

### Depth Limiting

- `dirview.maxDepth` (default: 0 = unlimited) caps scanning depth. Directories beyond the limit are returned as empty nodes.

### Symlink Handling

- Symlinks to directories are followed but tracked per-branch to detect cycles. A symlink that would re-enter an already-visited path is treated as an empty directory.

## Filtering (Ignore / Show Ignored)

Three layers of filtering apply when "Show Ignored" is off (the default):

1. **VCS directories** (`.git`, `.hg`, `.svn`, `.bzr`, `_darcs`) are always excluded regardless of the toggle.
2. **`.gitignore`** — the root `.gitignore` plus per-directory `.gitignore` files (cached per directory).
3. **`files.exclude`** — VS Code's `files.exclude` setting, applied via glob matching.

When "Show Ignored" is on, only VCS directories are excluded.

Toggling the ignored state triggers a full rescan affecting all views.

## File Watching & Auto-Rescan

- A `FileSystemWatcher` watches `**/*` for file creation and deletion events.
- Events are debounced at 500ms; if events keep arriving, a maximum wait of 5 seconds forces a scan.
- Auto-rescan is disabled when the total file count exceeds `dirview.autoRescanThreshold` (default: 10,000). When disabled, a warning banner appears with a manual Refresh button.
- Workspace folder add/remove events trigger an immediate rescan.

## Tree Rendering

### Directory Rows

- Each directory row displays: indent guides, a chevron, the directory name, a flex spacer, a proportional bar, and a file count (or byte size in size sort mode).
- Empty directories (0 files in subtree) show a dash (`—`) at 50% opacity instead of a count.
- Hovering a directory row reveals action buttons: expand children, collapse children, and open-in-tab.

### Proportional Bars

- Bars are colored segments representing per-language file composition within the directory's subtree.
- Bar width is proportional to `metric / maxMetric`, where `maxMetric` is the largest value among non-root nodes.
- The **tab** uses square-root scaling (`sqrt(pct) * maxBarWidth`); the **sidebar** uses linear scaling.
- Root nodes are excluded from maxMetric calculation so they always render at full width.

### File Rows

- Each file row displays: indent guides, a colored language dot, the filename, a flex spacer, a right-aligned language dot, and the file size (tab only; sidebar hides file sizes).
- Clicking a file row opens it in the VS Code editor.

### Folder Compaction

- Single-child directory chains with no files are collapsed into a single row with a joined display name (e.g. `a / b / c`).
- Each segment in a compacted path has its own context menu (right-click for copy path, reveal, etc.).

### Empty Directory Grouping

- Two or more consecutive empty sibling directories are grouped into a single "N empty directories" row.
- Grouping is disabled when a language filter or search is active.
- Clicking the row expands the group to show individual directory nodes.

### File Truncation

- When enabled, directories with more files than `dirview.truncateThreshold` (default: 3) show only the first N files, followed by an "N more files" row.
- The "N more files" row displays: up to 5 colored language dots, a bar showing language composition, and a file count.
- Clicking the row expands all truncated files inline.
- Truncation is disabled when a content search is active (all matched files must be visible).
- Truncation is disabled when only a single directory is displayed (root node has no directory children).
- Truncation state resets when a directory is collapsed.

### Indent Guides

- Tree depth is visualized with vertical indent guide lines.
- Hovering a guide highlights all guides at the same depth belonging to the same ancestor.
- Clicking a guide collapses the ancestor directory it belongs to (disabled when a language filter is active).
- The sidebar skips guides at depth 0 (no leftmost guide); the tab shows guides at all depths.

### Tooltips

- Hovering a directory row shows a tooltip below the bar with per-language breakdown: color swatch, language name, percentage, and file count.
- The tooltip repositions to stay within the viewport.
- Scrolling hides the tooltip.

### Incremental DOM Patching

- On rescan, existing tree DOM is patched rather than replaced, preserving scroll position and avoiding flicker.
- Directory nodes are matched by their `data-node-path` attribute; matched nodes are updated in-place (bar widths, file counts, children). Unmatched nodes are replaced.

## Sorting

Three sort modes cycle in order: **files** → **name** → **size**.

| Mode | Directory order | Description |
|------|----------------|-------------|
| `files` | Descending by total file count | Default mode |
| `name` | Ascending alphabetical | |
| `size` | Descending by total byte size | File count column switches to show byte size |

- Files within a directory are always sorted alphabetically regardless of the directory sort mode.
- Sorting is view-local: the sidebar sort mode is persisted to workspace state and controlled via a title bar button; each tab manages its own sort mode independently.

## Expand / Collapse

### Single Directory Toggle

- Clicking a directory row toggles its expand/collapse state.
- On collapse, truncation state for that directory resets.
- On expand, if children were not yet rendered (lazy rendering), a full re-render occurs; otherwise only the chevron and children visibility toggle (no re-render).

### Per-Directory Action Buttons

**Expand button** — 3-tier progressive escalation:
1. Target is collapsed → expand target only
2. Target is expanded, not all direct children expanded → expand all direct children
3. All direct children expanded → recursively expand entire subtree

**Collapse button** — mirrors expand with 3-tier de-escalation:
1. Any descendant beyond direct children is expanded → collapse those deeper descendants (direct children stay open)
2. Some/all direct children expanded, nothing deeper → collapse all direct children
3. No children expanded → collapse target itself

### Expand All / Collapse All (Toolbar)

Uses the same 3-tier logic as per-directory buttons, applied at the workspace root level:

**Expand All**:
1. Any top-level item not expanded → expand all top-level items
2. All top-level items expanded → recursively expand entire subtree

**Collapse All**:
1. Any top-level item has expanded descendants → collapse those, keep top-level items open
2. Only top-level items expanded → collapse all top-level items
3. Nothing expanded → no-op

Collapse All also clears truncation-expanded and empty-group-expanded state. When search is active, Collapse All also collapses all file match groups. Expand All expands all file match groups.

## Language Filtering

### Languages Panel

- Displays all languages detected in the workspace, sorted by file count descending.
- Each item shows: a color swatch, the language name, and either a file count or percentage.
- The display mode toggles between counts and percentages via a title bar button.
- Clicking a language item toggles it as a filter. Active items are highlighted; inactive items are dimmed.
- Filter changes are forwarded to the sidebar tree. The tab view is NOT affected by the languages panel filter.

### Tab Legend

- The tab has its own inline legend that works independently from the languages panel.
- Clicking a language in the tab legend toggles a view-local filter.
- When filters activate, the expand state is cleared and all directories auto-expand to show matching files.
- Only files and directories matching at least one active filter are displayed.
- The legend section is collapsible via its header.

### Display Mode Toggle

- Both the languages panel and the tab legend support toggling between file count and percentage display.
- Languages panel: controlled by a title bar icon button.
- Tab legend: controlled by an inline `%` / `#` toggle button within the legend header.

## Search

Search is available in the inline **Search section** in the editor tab.

### Content Search

- Typing a query in the search input triggers a content search using ripgrep (`@vscode/ripgrep`).
- Search is debounced at 300ms.
- Options: case sensitivity toggle (Aa), regex mode toggle (.*).
- A "files to include" field supports glob patterns to narrow the search scope (e.g. `src/**/*.ts`).
- Results are delivered progressively (batched every 50 files or 200ms) and rendered incrementally.
- Syntax highlighting is applied to match lines via Shiki, patched in after the initial plain-text render.
- Match lines show: line number, trimmed line text with the match highlighted, and context-windowed truncation for long lines (max 120 visible characters, centered on the match).
- Match lines per file are governed by the truncation threshold (`dirview.truncateThreshold`). Additional matches show a clickable "+ N more matches" row that expands inline.
- Clicking a match line opens the file at that line.
- Files with inline search matches are collapsible: clicking the file row (outside the filename) toggles match visibility. Clicking the filename opens the file.
- Files with matches show a chevron before the colored dot to indicate collapsibility.
- Collapsible file matches respond to Expand All / Collapse All.
- Files with matches do NOT show per-row hover action buttons (expand children, collapse children, open-in-tab).

### Filename Search

- If the main input contains glob characters (`*`, `?`, `/`) or the "files to include" field has a pattern with no content query, a filename-only search is performed.
- Filename search lists matching file paths without inline match lines.

### Search Limits

- Maximum 2,000 files and 20,000 matches per search. Results are marked as truncated when limits are reached.
- Status line shows: "N results in M files" during/after search, or "No results" for zero matches.

### Search + Tree Integration

- When a content search is active, the tree filters to show only files with matches and their ancestor directories.
- Directories are auto-expanded to reveal matched files; the expand state is rebuilt from scratch for each new search.
- File truncation (directory-level) is disabled during active search so all matched files are visible. Match-line truncation within each file is controlled by the truncation threshold.
- Clearing the search (Escape or clear button) restores the full tree.

### Search + Language Filter Interaction

- When a language filter is active alongside a search, only files matching both the search and the language filter are shown.
- A warning pill appears in the search bar's "files to include" row when a language filter is active.

### Tab Search

- Each tab has its own independent search instance scoped to its root directory.
- The search section is collapsible via its header.

## Editor Tab

### Opening Tabs

- Any directory in the tree can be opened in its own tab via the hover action button or context menu.
- The root workspace view is opened via the "Open in Editor Tab" toolbar command.
- Each tab is keyed by its root directory path. Opening the same directory focuses the existing tab.
- `dirview.openTabOnStartup` (default: false) opens the root tab automatically when a workspace is opened.

### Toolbar

The tab toolbar contains (left to right):
- **Breadcrumb title**: clickable path segments showing the tab's root directory. Each segment navigates the tab to that ancestor directory. Segments have context menus (copy path, reveal in explorer).
- **Sort button**: cycles through sort modes locally.
- **Truncation toggle**: enables/disables file truncation for all tabs.
- **Ignored toggle**: shows/hides ignored files (triggers a rescan affecting all views).
- **Sticky headers toggle**: enables/disables sticky directory headers (pin/unpin icon). Enabled by default. When enabled, expanded directory header rows stick to the top of the scroll container as the user scrolls. Toggling affects both sidebar and all open tabs. State is persisted to workspace state. Also available as a sidebar title bar button.
- **Expand All / Collapse All**: 3-tier expand/collapse for the tab's tree.

### Navigation

- Clicking a breadcrumb segment navigates the tab to that directory (re-roots the tab).
- The tab title and panel data update to reflect the new root.

### State Independence

- Each tab has independent: sort mode, expand/collapse state, language filter, search state, and truncation-expanded state.
- Truncation enabled/disabled is shared across all tabs (toggling it in one tab affects all tabs).
- Ignored file toggle triggers a global rescan affecting all views.

## Context Menus

Right-clicking a directory or file row provides:

| Item | Availability | Action |
|------|-------------|--------|
| Copy Path | Directories, files, match lines | Copies the absolute path to clipboard |
| Reveal in Explorer | Directories, files, match lines | Opens VS Code's file explorer at that path |
| Open File | Files only | Opens the file in the editor |
| Open in Integrated Terminal | Directories only | Opens a terminal at that directory |
| Copy Line Text | Match lines only | Copies the full raw line text to clipboard |

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `dirview.autoRescanThreshold` | 10000 | Max files before auto-rescan is disabled |
| `dirview.maxDepth` | 0 | Max scan depth (0 = unlimited) |
| `dirview.truncateThreshold` | 3 | Files shown per directory before truncation (0 = no truncation) |
| `dirview.openTabOnStartup` | false | Auto-open the Breakdown tab on workspace open |

## Multi-Root Workspaces

- Each workspace folder is scanned independently with its own ignore filter state.
- When multiple workspace folders exist, a header row with the folder name appears above each root's children.
- The tab breadcrumb shows the workspace folder name as the first segment.
