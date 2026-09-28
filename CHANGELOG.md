# Changelog

## [Unreleased]

v0.1.1 remains unreleased pending final real-browser release acceptance.

### Added

- Privacy-safe, user-triggered support diagnostics with copyable status output.
- An explicit LeetCode compatibility regression gate for page state, tab
  ownership, and editor replay contracts.
- A reproducible release artifact workflow with versioned ZIP and SHA-256
  checksum output.

### Changed

- Repository support, issue triage, smoke evidence, and release lifecycle now
  reflect public post-release maintenance.
- Release packaging now exposes the project-named versioned artifact and keeps
  development, diagnostic, and secret-like files outside the extension ZIP.

### Fixed

- Corrected coarse macOS/Windows platform classification in diagnostic
  environment reporting.

## [0.1.0]

### Added

- Initial public Chrome Web Store release.
- Live LeetCode Python source/testcase synchronization.
- Local Pyodide execution and trace replay.
- List, matrix, linked-list, tree, graph, and recursion-oriented visualization.
- Runtime expression, decision, mutation, control-flow, and behavioral evidence.
- Failure-first inspection and pinned-baseline behavioral diff.
