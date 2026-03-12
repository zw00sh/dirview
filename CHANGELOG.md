# Changelog

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
