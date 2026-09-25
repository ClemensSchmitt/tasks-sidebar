# Changelog

Notable user-facing changes are recorded here. Entries under **Unreleased** describe code on `main` that has not been included in a published VSIX.

## Unreleased

- Track task executions by their concrete VS Code execution, including independent controls for parallel runs.
- Add safe stop-then-start restart behavior and explicit running, stopping, waiting, failed, cancelled, unknown, and stale outcomes. Missing process-end evidence is not reported as success.
- Improve task discovery recovery, dependency visibility, and history restoration across extension-host reloads.
- Add search, filtering and sorting, workspace-folder/provider details, and task creation from the board.
- Add a VS Code compatibility guard, automated runtime and Extension Host coverage, and a cross-platform CI/release validation workflow.
- Improve keyboard focus, accessible labels, reduced-motion and theme-aware UI hooks. Manual screen-reader and theme verification remains a follow-up.

## 0.0.5 — 2026-08-18

- Publish the initial VSIX release of Tasks Sidebar through GitHub Releases.
- Show workspace tasks in an Activity Bar view, with run/stop controls, elapsed time, a runtime plan based on previous successful runs, and workspace-persisted history.
- Allow users to open `.vscode/tasks.json` and opt in to external task providers.
