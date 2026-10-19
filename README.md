# Tasks Sidebar

A visual VS Code task board for tasks defined in `.vscode/tasks.json`.

For complete product behavior, edge cases and troubleshooting, see the **[Tasks Sidebar handbook](docs/manual/README.md)**.

## Install

Tasks Sidebar requires Visual Studio Code 1.85 or newer. Download the [Tasks Sidebar VSIX from GitHub Releases](https://github.com/ClemensSchmitt/tasks-sidebar/releases/tag/v0.0.6), then in VS Code open **Extensions: Install from VSIX...** from the Extensions view's `...` menu and select the downloaded `.vsix`.

The latest published GitHub release is **v0.0.6**. There is no Visual Studio Code Marketplace listing yet.

## Getting started

Add a task to `.vscode/tasks.json` in your workspace:

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "Example: Say hello",
      "type": "shell",
      "command": "echo Hello from Tasks Sidebar",
      "problemMatcher": []
    }
  ]
}
```

Open the **Tasks** activity-bar view. Select the play button on the task card to run it and the stop button to request a stop. If the task list is not current, run **Tasks: Refresh** from the Command Palette. VS Code's normal task configuration rules still apply; see the [VS Code task documentation](https://code.visualstudio.com/docs/debugtest/tasks).

## Commands and configuration

| Command Palette command | Action |
| --- | --- |
| `Tasks: Refresh` | Refresh task discovery and the board. |
| `Tasks: Open tasks.json` | Open the selected workspace task definition. |
| `Tasks: Create task` | Create a simple shell task in the selected workspace folder. |
| `Tasks: Toggle external task providers` | Toggle visibility of tasks from external providers for this workspace. |

The `tasksSidebar.includeExternalTasks` setting defaults to `false`. When enabled, npm, user, extension, and other external providers can appear in the board.

## Features

- Run, stop and safely restart individual task executions
- Smooth runtime progress with a plan based on the latest successful run
- Running, stopping, waiting-for-end, failed, cancelled, unknown and stale states
- Search by task name, provider, group or workspace folder
- Deterministic filters for running, failed, completed, unknown/stale and external tasks
- Deterministic sorting by name, status, elapsed time or folder
- Edit `tasks.json`, or create a shell task through the board
- Version, host and provider labels are visible in the sidebar
- English-only UI with keyboard focus, screen-reader labels and reduced-motion support

## Task discovery and provider policy

The extension uses the official `vscode.tasks.fetchTasks()` API and does not use mock data. By default it keeps only workspace tasks whose scope comes from a workspace `.vscode/tasks.json`. npm, user, extension and other external providers are opt-in through `Tasks: Toggle external task providers` or `tasksSidebar.includeExternalTasks`. If aggregate discovery fails, the extension retries provider types declared in workspace task files and keeps any results it can recover, while showing a warning.

The provider/source is always shown. If two providers expose the same display name, they remain distinct when their source or definition differs. Exact duplicate logical definitions are rendered once; parallel `TaskExecution` instances are still represented separately. This avoids duplicate cards without hiding real parallel runs.

The board does not provide toolbar buttons for task output or terminal focus. Use VS Code's Output and Terminal panels directly; the task API does not expose a task-specific output or terminal handle.

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
- The plan uses the latest successful measured duration. Failed, cancelled, unknown, stale and recovered runs remain visible but do not change the plan or display their attempted duration.
- Up to 20 duration samples and 200 history records are retained.
- Runtime uses a monotonic clock. Clock changes cannot create negative durations or make progress move backwards.
- Reduced-motion preference disables non-essential animation and transitions; the progress state remains available as text and ARIA values.

## Compatibility and remote behavior

| Host class | Support level | Validation status |
| --- | --- | --- |
| Local Windows, macOS and Linux workspaces | Supported | CI runs source-based Extension Host tests and installed-VSIX probes on each OS with VS Code 1.85.0 and Stable. |
| WSL | Best effort; not certified | Not run for this change. |
| Dev Containers | Best effort; not certified | Not run for this change. |
| Remote SSH | Best effort; not certified | Not run for this change. |

The CI Linux jobs run a local Linux Extension Host; they do not certify WSL, a Dev Container or Remote SSH. Each remote host class must be checked and recorded separately before it is described as validated. The repeatable manual procedure and blank run record are in [the remote workspace smoke test](test/remote-smoke/README.md).

The extension declares `extensionKind: workspace`, so it runs in the extension host for the selected workspace. The board identifies that host as `Local extension host` or `Remote · <name>`; provider and file error messages use the same host label. WSL, Dev Container and SSH use VS Code's workspace task and URI-based file APIs, but their support remains best effort until the corresponding smoke run is recorded.

After a reload or reconnect, executions that VS Code reports are restored. If an execution previously marked stale is reported again by the same extension host, the next reconciliation restores it to its active state before a new Start request is accepted. When no process-end event was observed, an unconfirmed stop request is cleared so the task can be stopped again; when process-end evidence exists, the stop intent is retained while the extension waits for task-end. A new Start request is blocked while that execution is reported. If VS Code no longer reports an observed execution, the extension eventually records it as unknown/stale; a lost connection alone is not treated as proof of success or a confirmed stop. Task files are read and edited through the selected workspace folder's VS Code APIs.

VS Code 1.85.0 or newer is required by package metadata and an activation guard. Older versions receive an actionable error if the VSIX is installed manually. The user interface is currently English-only; translations are not included. Automated UI contract tests cover theme tokens, focus/reduced-motion hooks, labels and indeterminate progress semantics. Contrast and screen-reader behavior still need manual checks against representative VS Code themes and assistive technology.

## Development

```bash
npm install
npm run check
npm test
npm run test:extension
npm run package
npm run test:vsix
```

`npm run test:extension` launches a real VS Code Extension Development Host against a fixture workspace. CI runs it on Windows, macOS and Linux, on VS Code 1.85.0 and stable. Press `F5` to start an Extension Development Host; the view appears under the Tasks activity-bar icon. The suite also checks the generated sidebar controls, webview action routing and failure reporting; the runtime suite covers deterministic search, filter and sort behavior.

`npm run test:vsix` audits the generated VSIX, installs it with the VS Code CLI into fresh extension and user-data directories, then runs an Extension Host smoke test against that installed package. The test opens the Tasks Activity Bar view and checks activation and the refresh command. CI records the actual VS Code version and package file list in a `vsix-install-probe.json` artifact for each supported matrix entry.

## Support and issues

See [SUPPORT.md](SUPPORT.md) for bug-report instructions and useful diagnostic details. The GitHub [issue tracker](https://github.com/ClemensSchmitt/tasks-sidebar/issues) is currently available only to repository users because this repository is private; public users will need public repository access before they can report an issue there. No public Marketplace support channel is available yet.

This project is distributed under the [MIT License](LICENSE). See the [changelog](CHANGELOG.md) for release history and unreleased changes.

### Task output, terminals and editing

The Task Board has no toolbar buttons for task output or terminal focus. Use VS Code's
Output and Terminal panels directly. The [public VS Code API](https://code.visualstudio.com/api/references/vscode-api#TaskExecution)
exposes a task and termination on TaskExecution, but no task-specific terminal or output
handle, so Tasks Sidebar cannot target those surfaces for an individual task.

**Edit** on a workspace task selects its unique definition in that folder's tasks.json,
including JSONC files. Duplicate labels within one file, missing/renamed definitions,
and external provider tasks produce a message instead of navigating to a guessed task.
Navigation does not modify the file. **Create Task** is unchanged.
