# Troubleshooting, Retry and diagnostics

This chapter is organized by symptom. Tasks Sidebar is conservative when evidence is incomplete: it preserves useful last-good information and reports Unknown/Stale rather than guessing a successful or cancelled outcome.

## First principles

Before destructive actions:

1. read the warning/status text;
2. use **Retry** or **Tasks: Refresh**;
3. inspect `.vscode/tasks.json` diagnostics;
4. inspect VS Code's Task/Terminal/Output surfaces;
5. note the board's version, host and provider labels;
6. preserve the smallest reproducible task definition.

Do not delete workspace files, history or extension data as a default troubleshooting step.

## Task list is empty

### No workspace is open

Symptom:

```text
No workspace is open. Open a workspace and try again.
```

Recovery:

1. open a folder/workspace in VS Code;
2. open the Tasks view;
3. choose Refresh.

### Workspace has no tasks

The board shows its normal empty state with Create task, Open tasks.json and Refresh.

This is not an error.

### Search/filter hides everything

If task snapshots exist but the current view produces none, the board says **No matching tasks**.

Use Reset or clear/change search/filter.

See [Search, filters and sorting](05-search-filter-sort.md).

## A workspace task is missing

Check:

- the task has a non-empty label/name;
- it is in the expected workspace folder;
- `.vscode/tasks.json` has no VS Code error diagnostics;
- external-provider assumptions are not involved;
- the task is exposed by VS Code's task API.

Saving `.vscode/tasks.json` triggers refresh automatically; explicit Refresh is also available.

For multi-root workspaces, verify the correct folder.

## An npm/provider task is missing

External providers are disabled by default.

Use:

**Tasks: Toggle external task providers**

or enable:

```json
{
  "tasksSidebar.includeExternalTasks": true
}
```

If aggregate task discovery fails, Tasks Sidebar retries provider types from workspace task files plus shell/process. Recovered tasks can remain visible with a warning.

The warning:

```text
Some task providers could not be queried. Tasks from available providers remain visible...
```

means discovery was partial, not necessarily empty.

Use Retry after checking workspace/remote connectivity and provider health.

## tasks.json has errors

Tasks Sidebar inspects VS Code diagnostics for the workspace task URI.

A warning can identify:

- host;
- workspace folder;
- number of errors.

Recovery:

1. choose **Open tasks.json**;
2. fix JSON/task syntax;
3. save;
4. choose Retry/Refresh if needed.

Tasks Sidebar's JSONC parser accepts comments and trailing commas for its own helper parsing, but VS Code remains the authority for valid task configuration.

## tasks.json cannot be read

A read/stat problem produces a permission/file-access warning.

Check:

- file permissions;
- workspace trust/context as applicable;
- remote connection;
- that the workspace folder is still mounted/available.

Do not copy the file to a local path just to make the extension work in a remote workspace; the extension intentionally uses VS Code URI/workspace filesystem APIs.

## Create task fails

Possible causes:

- no workspace open;
- canceled folder/input selection;
- malformed JSONC;
- top-level `tasks` is absent/not an array;
- file/directory write permission failure;
- remote filesystem issue.

The error message is:

**The task could not be created. Check tasks.json permissions and JSON syntax.**

If the file contains comments/custom formatting, also remember that successful Create task rewrites the document with normalized JSON and removes JSONC comments/trailing commas.

See [Commands, settings and tasks.json](07-commands-settings-tasks-json.md).

## Open tasks.json fails

The command tracks the operation it was performing, such as:

- checking tasks.json;
- creating the .vscode folder;
- creating tasks.json;
- opening tasks.json;
- showing tasks.json.

The reported error includes that operation.

In multi-root, rerun the command and ensure you chose the intended folder.

## External-provider setting cannot be changed

If workspace configuration update fails, Tasks Sidebar reports:

**The external task provider setting could not be changed.**

Check whether the workspace/settings file is writable and whether policy/settings restrictions apply.

You can inspect the current `tasksSidebar.includeExternalTasks` value in VS Code settings.

## “This task is already running”

Before Start, Tasks Sidebar reconciles VS Code's currently reported executions.

A Start is blocked when the logical task is already starting or has a non-stale live execution.

This is intentional protection against duplicate starts.

If you believe the run is gone, inspect the card lifecycle:

- Running;
- Stopping;
- Waiting for task end;
- Stale.

A reappearing stale execution can be restored to active before Start is accepted.

## “This task is no longer available”

The board can become stale relative to discovery if a definition was edited/removed between render and action.

Recovery:

1. Refresh;
2. locate the current task definition/card;
3. run/edit the current card.

An old live execution may remain visible as Orphaned.

## Task cannot start

If `vscode.tasks.executeTask()` fails, the error detail is shown after:

**The task could not be started:**

Check:

- underlying command exists;
- provider is installed/working;
- remote tool exists in the remote environment;
- standard VS Code task execution works outside Tasks Sidebar.

## Stop appears stuck

After Stop, the lifecycle becomes Stopping until VS Code supplies confirmation.

Do not treat Stopping itself as proof of termination.

If terminate throws/rejects, Tasks Sidebar reports a stop error and returns conservatively to an active/waiting state.

If confirmation never arrives before the timeout, the run can become Stale.

Check VS Code's terminal/process/task state before starting external cleanup.

## Waiting for task end

**Process ended · waiting for task end** means process-end evidence arrived but the higher-level task-end event has not yet finalized the execution.

Restart can be queued but a new run is not immediately launched on top of this state.

If task-end never arrives, bounded stale/unknown handling applies.

## Unknown outcome

Unknown means evidence was insufficient to decide a normal terminal outcome.

Examples:

- process ended but no exit code was available;
- task end occurred but process-end evidence never arrived;
- a persisted active observation disappeared after reload/reconnect.

Unknown is deliberately not Success.

## Stale

Stale means the execution is no longer observable enough for a trustworthy terminal claim.

Causes can include:

- lost end event;
- unconfirmed Stop timeout;
- execution disappears from VS Code's reported executions.

Stale is not equivalent to terminated.

If the same execution reappears, it can return to Running or Waiting for task end depending on prior process-end evidence.

## Reload/reconnect surprises

### Execution still reported

It is rehydrated as active. Elapsed timing is labelled from reload and a recovered success does not retrain the progress plan.

### Execution not reported

Persisted observation remains pending for a bounded window. If it never returns, outcome becomes Unknown.

### Previously stale execution reappears

It is restored before a duplicate Start can be accepted.

A lost connection by itself is never treated as proof of success/cancellation.

See [Compatibility and remote hosts](11-compatibility-remote.md).

## Background/watch task seems to run forever

That can be expected.

Background tasks are open-ended and are not made stale merely because ordinary elapsed time is long.

They can become stale if Stop is requested but unconfirmed or if the execution disappears from observation.

## Progress estimate looks wrong

The plan is the latest fresh confirmed successful duration.

It is not:

- an average;
- CPU time;
- based on failed/cancelled/unknown/stale runs;
- updated by recovered success after reload.

If behavior changed, history identity changes and a new plan may need to be learned.

See [History and progress](06-history-progress-persistence.md).

## Find task output or a task terminal

The Task Board has no output or terminal toolbar buttons. Open VS Code's Output or
Terminal panel directly. VS Code owns selection of the displayed output and active
terminal; Tasks Sidebar cannot map a task card or compound child to a specific surface.

See [Task output and terminals](08-output-terminal.md).

## Old/unsupported VS Code

Tasks Sidebar requires VS Code 1.85.0+.

If an older version attempts activation, the extension reports the minimum/current version and stops normal activation.

Install/use a supported VS Code version rather than bypassing the guard.

## Remote-host failures

For WSL, Dev Containers and Remote SSH:

- confirm the extension is installed in the active remote workspace host;
- confirm the board header says `Remote · <name>`;
- verify Node/commands required by your task exist remotely;
- inspect the remote workspace task file, not a local copy;
- distinguish a real disconnect from Developer: Reload Window.

These host classes are best-effort, not certified, while manual smoke records remain unrun.

## Warning + Retry behavior

Warnings are rendered in an alert region with a **Retry** button.

If the warning text is unchanged, the webview does not unnecessarily recreate it.

If Retry had keyboard focus and the warning changes, focus is preserved on the new Retry where possible; if the warning clears, focus falls back to the board.

## Last-good task list

After successful discovery, non-orphaned snapshots are cached in workspace state as idle snapshots.

When later discovery fails, compatible cached tasks can stay visible along with the warning.

This prevents a transient provider/file/connection error from making the user believe all known task definitions were deleted.

Last-good state is not proof that the current provider/file is healthy; heed the warning.

## Webview/action errors

Malformed or unsupported webview actions are rejected and reported as:

**The sidebar action could not be completed.**

Malformed backend render messages are ignored without erasing the existing board or warning.

If backend `postMessage` fails, Tasks Sidebar reports that the sidebar could not be updated.

These are defensive UI paths; Retry/Refresh is appropriate before more invasive action.

## Persistence write errors

History, active-observation and last-good snapshot writes use VS Code `workspaceState`.

A failed persistence update is reported. Current in-memory state may still work during the session, but do not assume it will survive reload.

## What to include in a bug report

Use [SUPPORT.md](../../SUPPORT.md) as the repository's support checklist.

Include:

- Tasks Sidebar version;
- exact VS Code version;
- operating system;
- workspace host: local, WSL, Dev Container or Remote SSH;
- board host label;
- task provider/source;
- single-root or multi-root;
- steps to reproduce;
- expected behavior;
- actual behavior;
- smallest relevant `.vscode/tasks.json` definition;
- exact warning/error text;
- relevant task-output excerpt;
- whether reload/reconnect/Stop occurred;
- if relevant, whether the execution was Running, Stopping, Waiting, Unknown or Stale.

Remove:

- credentials/tokens;
- environment variable values;
- private hostnames;
- private file paths;
- customer data.

The repository/issue tracker is currently private, so external users cannot submit there until public access exists. No public support email or Marketplace support channel is currently configured.

## Useful evidence without over-collecting

Prefer:

- exact error text;
- minimal task definition;
- version/host/provider labels;
- one short task-output excerpt;
- reproducible sequence.

Avoid posting full logs/workspaces when a small reproduction is enough.

## Related chapters

- [Lifecycle](03-execution-lifecycle.md)
- [Commands/tasks.json](07-commands-settings-tasks-json.md)
- [Output/terminal](08-output-terminal.md)
- [Compatibility/remote](11-compatibility-remote.md)
