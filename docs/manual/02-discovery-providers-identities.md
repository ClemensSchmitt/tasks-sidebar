# Task discovery, providers and identities

Tasks Sidebar does not maintain its own independent task registry. It asks Visual Studio Code for tasks and then applies a visibility and identity policy so the board remains predictable.

## Discovery source

The extension uses `vscode.tasks.fetchTasks()`. The returned VS Code `Task` objects are the source for normal discovery.

By default, Tasks Sidebar keeps only tasks that:

- have source `Workspace`;
- are scoped to an actual workspace folder **or** to the active `.code-workspace` file;
- have a non-empty name.

This makes `.vscode/tasks.json` workspace tasks the default board content.

## External provider mode

External tasks are opt-in through either:

- **Tasks: Toggle external task providers**; or
- `tasksSidebar.includeExternalTasks`.

The setting is Boolean, defaults to `false`, and the toggle command updates it at workspace scope.

When enabled, npm, extension, user and other task providers can appear. The **External providers** filter then selects tasks whose source is not `Workspace`.

There is no dedicated board-toolbar toggle for this setting.

## Provider/source labels

Every card exposes its source/provider. The source is part of logical task identity, so two tasks with the same visible label are not automatically the same task.

Example:

- `Workspace · build`
- `npm · build`

They can coexist because their providers differ.

## Recovery when aggregate discovery fails

If the broad `fetchTasks()` call fails, the extension performs a narrower recovery attempt.

It starts with provider types `shell` and `process`, then reads each workspace `.vscode/tasks.json` and adds any explicitly declared task `type` values. Each provider type is queried separately with `fetchTasks({ type })`.

If some providers can still return tasks:

- recovered tasks remain visible;
- exact duplicate logical tasks are deduplicated;
- the board shows a warning that some providers could not be queried;
- Retry is available.

If recovery returns no usable tasks, the normal discovery failure path is used. When a last-good task snapshot exists, the extension keeps compatible previous information visible rather than clearing the board merely because refresh failed.

See [Troubleshooting and recovery](09-troubleshooting.md).

## JSONC while inspecting provider types

Workspace task files are parsed as JSONC for this recovery logic. Line comments, block comments and trailing commas are accepted. Invalid files simply contribute no provider types to fallback discovery; file diagnostics are handled separately by the board warning logic.

## Multi-root workspaces

Workspace-folder URI is significant throughout discovery.

Two folders can each define a task named `build`:

```text
workspace
├─ api/.vscode/tasks.json      -> build
└─ web/.vscode/tasks.json      -> build
```

These remain distinct because their workspace scope differs.

The card can show the folder name, search includes folder name, and folder sorting uses that name. Removing one workspace folder hides tasks tied to that URI without implicitly removing another root's tasks.

Global/external tasks without a workspace-folder URI are visible only when external-provider mode permits them.

## Logical task identity

A logical task id is derived from:

1. source/provider;
2. display name;
3. scope/workspace URI;
4. task definition.

The definition is canonicalized by sorting object keys before serialization. Therefore merely changing JSON object key order does not create a new logical identity.

### Rename

Changing only the display label creates a new **logical** identity.

If the old task is still running when the definition is renamed, the old concrete execution can remain visible as **Orphaned** because VS Code may still report that old execution while discovery now exposes only the renamed task.

### Behavioral definition edit

Changing behavior such as the command also creates a new logical identity.

This prevents a running execution from being silently treated as the edited definition.

## Exact duplicate deduplication

During one discovery pass, Tasks Sidebar keeps one metadata/card definition per logical id. If VS Code exposes the exact same logical definition more than once, only one idle definition card is rendered.

This does **not** collapse genuine parallel runtime executions. Multiple concrete `TaskExecution` objects for the same logical task can still be represented separately.

## Same-name tasks

Same display name is not enough for deduplication.

These remain distinct when any identity component differs:

- provider/source;
- workspace scope;
- definition;
- name itself.

Examples:

| Visible name | Source | Folder | Definition | Result |
| --- | --- | --- | --- | --- |
| build | Workspace | api | npm run build | distinct |
| build | Workspace | web | npm run build | distinct |
| build | npm | api | provider-defined npm task | distinct |
| build | Workspace | api | dotnet build | distinct from first api build |

## Runtime identity

A concrete execution receives a session-local id such as `execution-1`.

This id identifies the specific `TaskExecution` currently tracked by one extension-host session. It is used so Stop can target one concrete execution even when multiple executions share a logical task definition.

Parallel executions are therefore not merged into one live card.

### Runtime ids do not survive extension-host reload

The `execution-N` number is not persisted as durable identity. After reload/reconnect, reconciliation uses logical identity, workspace URI and the number of matching live observations. If two matching executions existed before reload and VS Code reports one afterward, one persisted observation is consumed by that live match and another can remain pending.

See [Compatibility, reload and reconnect](11-compatibility-remote.md).

## History identity

History identity is intentionally different from logical identity.

It includes source, scope and behavior definition while ignoring presentation fields `label` and `taskName`.

Consequences:

- renaming a task while behavior stays the same can keep the existing runtime plan/history;
- changing behavior starts a separate history;
- different workspace-folder scopes keep separate histories;
- legacy history keys can be migrated to the newer scheme.

This prevents a cosmetic rename from discarding useful successful-run timing while avoiding reuse of timing for genuinely changed work.

## Parent/child and dependency identity

Dependencies are parsed from each workspace folder's task file. Dependency names are resolved within the same folder by label.

A limitation follows from that label-based lookup: if multiple distinct logical task definitions in the same folder deliberately share exactly the same label, task cards can still be distinct, but dependency-name resolution cannot promise stronger disambiguation than the label supplied by VS Code/tasks.json.

Cross-root dependencies are not implicitly matched by label. A dependency that cannot be resolved in the same folder remains **unresolved**.

See [Compound tasks and dependencies](04-compound-tasks-dependencies.md).

## Orphaned executions

An orphaned execution is a live task execution that no longer has a matching current discovered definition, usually because the task was renamed, edited or removed while running.

The board keeps it visible rather than hiding a still-relevant runtime observation.

An orphan:

- retains its concrete execution state;
- may still be stopped if it is a live tracked execution;
- can become stale or finish independently;
- is excluded from the last-good idle snapshot cache so it is not resurrected later as a normal idle definition.

## Discovery and refresh timing

Discovery can run because of:

- VS Code startup completion, even when the sidebar is closed;
- explicit Refresh;
- workspace-folder changes;
- saving or externally editing `/.vscode/tasks.json`;
- changing the external-task-provider setting;
- task execution and completion events.

Discovery results are kept in the extension host and sent to the view when it opens.
A ready handshake replays the latest snapshot if the Webview loads after the
initial publication. The 1-second timer updates elapsed/progress data only;
it does **not** call providers or restart task discovery. This prevents slow
providers from being repeatedly superseded by the timer.

**Multi-root startup recovery:** VS Code can temporarily return tasks from
only some workspace folders on startup. The sidebar compares fetched tasks
against configured built-in `shell` and `process` task labels in each
root's `.vscode/tasks.json`. If a root's configured tasks are not yet
available, the board reports which folders are pending, preserves last-known
compatible task cards provisionally, and automatically retries using a
backoff from 1.5 seconds up to 60 seconds. After a complete scan, a
low-frequency 60-second refresh continues to pick up provider updates.
Empty task files do not trigger the retry backoff. The canonical VS Code
task registry remains authoritative for execution: cached cards never
execute stale commands directly, and a renamed/deleted task must be
resolved again before launch.

Startup/Reload Window timing still depends on the VS Code startup event and
the workspace/provider response time. Remote-host and cold-start performance
must be measured in a real Extension Host before promising a fixed SLA.

Each publish receives a revision number. If an older asynchronous discovery finishes after a newer one, the old result is discarded instead of overwriting fresher state.

This matters particularly with slow providers or remote filesystems.

## Related chapters

- [Installation and Task Board walkthrough](01-installation-first-run.md)
- [Execution lifecycle and parallel runs](03-execution-lifecycle.md)
- [Compound tasks and dependencies](04-compound-tasks-dependencies.md)
- [Troubleshooting discovery](09-troubleshooting.md)
- [Compatibility and remote workspaces](11-compatibility-remote.md)
