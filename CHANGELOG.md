# Changelog

## [1.3.0] — 2026-03-17

### Added
- **Virtual scrolling in the sidebar** — the sidebar now uses the same virtual scroller as the tab, with JS-driven sticky overlay for directory header pinning. Enables smooth performance on large repositories.
- **Files to include / files to exclude** — the file filter now uses glob patterns (comma-separated) matching VS Code's native search include/exclude UI. The exclude input is hidden behind a "..." toggle button. Replaces the previous regex/glob dual-mode filter.
- Legend stats now reflect search/include/exclude filters independently of language filters — toggling a language no longer zeroes out counts for unselected languages.

### Changed
- Sticky headers "off" icon changed from a pennant/flag to a pin with diagonal strikethrough, used consistently in both the tab toolbar and the sidebar title bar.
- Deduplicated scanner, match grouping, and improved type safety across the codebase.

### Fixed
- "Error: Scan aborted" no longer flashes when rapidly toggling refresh or show hidden files. Aborted scans are silently suppressed while the queued scan completes.

## [1.2.1] — 2026-03-16

### Fixed
- File filter regex now matches against the workspace-relative path (e.g., `src/api/index.ts`) instead of just the filename. Filtering by "api" now correctly includes files inside `api/` directories, matching VSCode native search behavior.
- Search status text now shows filtered counts when a client-side file filter or language filter is active, instead of raw ripgrep totals.
- Search status text now updates correctly after toggling language filters in the legend while search results are displayed.
- Fixed status text timing: filtered counts are deferred to post-render callback so they reflect the actual visible results.

### Changed
- File scanner moved to a worker thread for ~76% total scan speedup on local filesystems. Remote filesystems fall back to main-thread `vscode.workspace.fs`.
- Sort button tooltip shows "(size unavailable on remote filesystems)" when connected to a remote workspace.
- Removed debounce for client-side regex file filters (renders complete in <16ms).

## [1.2.0] — 2026-03-16

### Added
- **Virtual scrolling** in the tab view: renders only visible rows (~50) regardless of tree size. Expand-all on the linux kernel (28k files) drops from 3.6–5.1s to ~47ms.
- Centered empty state messages with icons for all placeholder views (initializing, scanning, no workspace, no results, error).
- "No results found" empty state when search or filter produces zero matches.
- Dynamic search debounce: skips the 300ms delay when narrowing a small result set (< 500 files).
- File count shown in status line for client-side regex file filters.

### Fixed
- Glob file filter in subtree tabs showing no results due to incorrect workspace root path conversion.
- Glob file filter showing no results because workspace root was missing from ancestor path index.

## [1.1.3] — 2026-03-16

### Fixed
- Expand/collapse all now correctly recognizes implicitly expanded nodes when a filter or search is active.
- Filter clear button ordering now matches the main search input layout (regex toggle, then clear).
- Search collapse bug: clicking an implicitly expanded dir during search now collapses on the first click.
- File filter placeholder text now displays correctly on load.

### Changed
- Content search regex is enabled by default, with inline validation feedback for invalid regex patterns.
- Separate clear buttons for content search and file filter inputs.
- Tab title now uses the workspace name instead of hardcoded "Breakdown".
- Filtering extracted into a pre-render `filterTree()` layer for cleaner architecture.
- Split monolithic test file into 10 focused test modules for maintainability.

## [1.1.2] — 2026-03-16

### Fixed
- Search now works on all platforms: resolves VSCode's bundled ripgrep when the npm package is unavailable, with graceful fallback to `vscode.workspace.findFiles` for file-glob filtering when no ripgrep binary is found.
- Windows path compatibility: search ancestor path expansion now normalizes backslashes to forward slashes.

### Changed
- File filter defaults to regex mode (plaintext acts as substring match). Glob mode passes filters to ripgrep as-is without `*text*` wrapping.
- Regex toggle button moved inside the file filter input border, matching the main search input layout.
- Tree fully auto-expands when any filter or search is active, so all matches are visible.

## [1.1.1] — 2026-03-16

### Changed
- Tab opens immediately on startup instead of waiting for the scan to complete.

## [0.5.1] — 2026-03-13

### Changed
- New extension icon: stacked segmented bars with language colors, replacing the old folder-with-bars design. Updated across marketplace, activity bar, and tab title.

## [0.5.0] — 2026-03-13

### Added
- Legend display toggle (`%` / `#`) in the Languages panel title bar and tab legend header — switch between raw file counts and percentages.
- Dynamic sort mode icons in the sidebar title bar and tab toolbar — icon updates to reflect the active sort (files / name / size).
- Incremental DOM patching for tree re-renders — only changed nodes are updated, reducing flicker and improving performance on large trees.
- Scan abort: in-flight scans are cancelled when a newer scan is triggered, preventing stale results from overwriting fresh ones.
- Lazy child rendering and deferred layout — tree children are rendered on first expand, cutting initial render cost.
- Truncated file rows now show a proportional bar, sort-aware counts, and a tooltip.
- Per-directory file-count column uses a fixed 44 px width so bars stay aligned across rows.

### Fixed
- Double-clicking the expand button no longer collapses the directory.
- Sidebar truncation toggle is now isolated from tab views (toggling in the sidebar no longer affects open tabs).
- Tab truncation toggle no longer bleeds into the sidebar state.
- Truncated-row label is no longer ellipsised by the proportional bar.

## [0.4.0] — 2026-03-13

### Added
- Editor tab toolbar breadcrumb now shows a dimmed `./ ` prefix before the directory path, pixel-aligned with tree node names below.

## [0.3.2] — 2026-03-13

### Fixed
- Scan bar animation no longer freezes during heavy tree renders (GPU-composited transform instead of main-thread background-position).
- Scan bar now actually appears during local re-renders (expand all, toggle truncation, sort change) — previously it was shown and hidden before the browser could paint.

## [0.3.1] — 2026-03-12

### Fixed
- Corrected repository URL in package manifest.

## [0.1.0] — 2026-03-12

Initial release.

### Features
- Colored proportional bars showing per-directory language composition (GitHub linguist colors)
- Sidebar tree view with expandable/collapsible directories
- Editor tab view with toolbar, sortable columns, and language legend
- Standalone Languages legend panel
- Sort by file count, name, or size
- Show/hide files excluded by `.gitignore` or `files.exclude`
- File truncation to keep the tree compact
- Drill-down: click a directory in the tab view to set it as root
- Native VSCode context menus (copy path, reveal in Explorer, open file, open in terminal)
- Auto-rescan on file changes with configurable threshold
- Loading progress bar during scan
- Expand All / Collapse All commands
