# Tasks Sidebar

A visual VS Code task board for tasks defined in `.vscode/tasks.json`.

## Features

- Run, stop and safely restart individual task executions
- Smooth runtime progress with a plan based on the latest successful run
- Running, stopping, waiting-for-end, failed, cancelled, unknown and stale states
- Search by task name, provider, group or workspace folder
- Deterministic filters for running, failed, completed, unknown/stale and external tasks
- Deterministic sorting by name, status, elapsed time or folder
- Open VS Code's selected task output or focus its active task terminal
- Edit `tasks.json`, or create a shell task through the board
- Version, host and provider labels are visible in the sidebar
- English-only UI with keyboard focus, screen-reader labels and reduced-motion support

## Task discovery and provider policy

The extension uses the official `vscode.tasks.fetchTasks()` API and does not use mock data. By default it keeps only workspace tasks whose scope comes from a workspace `.vscode/tasks.json`. npm, user, extension and other external providers are opt-in through `Tasks: Toggle external task providers` or `tasksSidebar.includeExternalTasks`. If aggregate discovery fails, the extension retries provider types declared in workspace task files and keeps any results it can recover, while showing a warning.

The provider/source is always shown. If two providers expose the same display name, they remain distinct when their source or definition differs. Exact duplicate logical definitions are rendered once; parallel `TaskExecution` instances are still represented separately. This avoids duplicate cards without hiding real parallel runs.

`Open task output` delegates to VS Code's selected task output target; `Focus task terminal` focuses VS Code's active task terminal. These are board-level actions, not per-card selectors: VS Code owns the output/terminal mapping for shell, process, compound and remote tasks, so the board does not guess which child terminal belongs to a compound task. A process task may have no terminal to focus.

## Runtime safety

- Parent and child executions are shown as related task cards. Stopping a parent stops only the selected parent execution; children are not implicitly terminated because VS Code owns compound-task orchestration.
- Sequential dependencies are evaluated in declared order; a later dependency cannot be considered satisfied while an earlier dependency is running, unresolved, failed or unknown. Parallel dependencies are aggregated independently.
- Parent and child task histories keep separate logical identities and duration samples; compound execution time is never merged into an equivalent user-run sample.
- Each concrete execution receives its own runtime ID; parallel executions do not overwrite one another and can be stopped independently.
- Runtime identity includes provider, display name, scope and definition. A rename or definition edit can orphan an old visible execution. History identity is separate: a rename with unchanged behavior keeps its plan, while a behavior change starts a new history.
- Exit code `0` is success, a non-zero exit code is failure, a confirmed stop is cancellation. Missing process-end or exit-code evidence never becomes success.
- Background/watch tasks remain visibly running. Lost end events or a stop without confirmation become stale after a bounded timeout; the extension does not claim the process was killed.
- Restart is stop-then-start. A restart requested while stopping waits for the terminal event; a stale execution remains visible while a new execution may start. A failed or idle task starts directly.
- Discovery, JSON, configuration, file, refresh and webview errors are caught. The last valid task list remains visible when possible and the sidebar offers Retry.

## History, timing and progress

- Elapsed time is monotonic host elapsed time. Suspend/resume time is intentionally counted as elapsed wall time; active CPU time is not claimed. Persisted wall-clock timestamps are metadata only.
- The plan uses the latest successful measured duration. Failed, cancelled, unknown, stale and recovered runs remain visible but do not change the plan.
- Up to 20 duration samples and 200 history records are retained.
- Runtime uses a monotonic clock. Clock changes cannot create negative durations or make progress move backwards.
- Reduced-motion preference disables non-essential animation and transitions; the progress state remains available as text and ARIA values.

## Compatibility and remote behavior

| Host | Support level | Validation |
| --- | --- | --- |
| Local Windows, macOS and Linux | Supported | Extension-host smoke tests on stable VS Code and 1.85.0 run in CI for each OS. |
| WSL, Dev Container and Remote SSH | Best effort; not certified | Uses the remote workspace extension host and URI-based VS Code APIs; no automated remote-host runner is currently available. |

The extension runs in the workspace host (`extensionKind: workspace`). The host label in the board and error messages distinguishes local from remote execution. On reconnect/reload, executions still reported by VS Code are restored. If the host no longer reports an execution, it is marked unknown/stale after the observation grace period; the extension never claims that a remote process was stopped just because its connection disappeared. Editing and task execution use the selected workspace folder's VS Code APIs.

VS Code `1.85.0` or newer is required by package metadata and an activation guard. The user interface is currently English-only; translations are not included. Automated UI contract tests cover theme tokens, focus/reduced-motion hooks, labels and indeterminate progress semantics. Contrast and screen-reader behavior still need manual checks against representative VS Code themes and assistive technology.

## Development

```bash
npm install
npm run check
npm test
npm run test:extension
npm run package
```

`npm run test:extension` launches a real VS Code Extension Development Host against a fixture workspace. CI runs it on Windows, macOS and Linux, on VS Code 1.85.0 and stable. Press `F5` to start an Extension Development Host; the view appears under the Tasks activity-bar icon.
