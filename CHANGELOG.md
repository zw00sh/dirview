# Changelog

## [1.0.0] — 2026-03-15

### Added
- **Content search** with syntax-highlighted results: search file contents via ripgrep with progressive streaming, syntax highlighting (Shiki), case sensitivity and regex toggles, and configurable context lines.
- **File filter** ("find or filter files"): filter displayed files by name using substring matching, glob patterns (case-insensitive), or regex (with toggle). Works standalone or combined with content search.
- **Inline search results**: match lines rendered under files in the tree with line numbers, match highlighting, context lines, and clickable navigation. Collapsible per-file, with match truncation governed by the truncation threshold.
- **Search history**: up/down arrow navigation through previous search patterns and file filter inputs.
- **Sticky directory headers**: pinnable directory rows that stick to the top during scroll (separate setting for sidebar and tab).
- **Collapsible sections**: search, legend, and tree sections in the tab are independently collapsible with chevron indicators. Active search/filter badges shown on collapsed sections.
- **Language filter pill**: warning pill in the file filter row when a language filter is active, dismissable to clear all filters.
- **Directory-scope pill**: "in: dirname" pill in the file filter when a tab is scoped to a subdirectory, with dismiss to reset to workspace root.
- **Scan progress bar** added to the languages panel.

### Changed
- Search UI labels: main input placeholder is "Search Text", file filter label is "find or filter files" with "Search Files" placeholder.
- Globs are now case-insensitive (`--iglob`) in both content search scoping and filename search.
- Same-line search matches are merged into a single row with multi-range highlighting.
- Context lines are grouped with their parent match, with empty/whitespace-only lines trimmed from edges.
- Match groups are dedented to remove shared leading whitespace for cleaner display.
- Tab tree rendering: fold-style TREE header, root displayed as a node, root bar hidden.
- Tab styling matches native VS Code search panel (inputs, toolbar buttons, headers).
- Sidebar search panel removed (search is tab-only).
- Sidebar title updates from root workspace name.

### Fixed
- Expand All / Collapse All now correctly updates chevrons for compacted (single-child chain) directories.
- Search results in subdirectory tabs no longer return empty.
- Breadcrumb hover no longer highlights all path segments.
- Search context input no longer clips at narrow sidebar widths.
- Sticky header shadow works correctly in both sidebar and tab.
- Security, memory leak, and accessibility fixes across search and rendering code.

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
