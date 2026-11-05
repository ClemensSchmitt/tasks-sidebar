# Commands, settings and tasks.json workflows

This chapter documents every command and setting contributed by Tasks Sidebar and the exact workspace-file behavior behind editing and task creation.

## Command reference

| Command Palette title | Command id | What it does |
| --- | --- | --- |
| Tasks: Refresh | `tasksSidebar.refresh` | Refresh discovery and publish a new board snapshot. |
| Tasks: Open tasks.json | `tasksSidebar.openTasksJson` | Open/create the selected workspace folder's `.vscode/tasks.json`. |
| Tasks: Create task | `tasksSidebar.createTask` | Append a simple shell task to the selected workspace task file. |
| Tasks: Toggle external task providers | `tasksSidebar.toggleExternalTasks` | Toggle `tasksSidebar.includeExternalTasks` at workspace scope. |

All four commands are registered when the extension activates from the Task Board view.

The board also exposes buttons for Refresh, Open tasks.json and Create task. The external-provider toggle is Command Palette/setting based, not a board toolbar button.

## Setting reference

### tasksSidebar.includeExternalTasks

Type: Boolean  
Default: `false`

When false, the board defaults to workspace-folder tasks from `.vscode/tasks.json`.

When true, npm, user, extension and other external/provider tasks can also appear.

The toggle command updates this setting with `ConfigurationTarget.Workspace`.

A configuration update error is reported to the user rather than silently changing only in memory.

See [Task discovery and providers](02-discovery-providers-identities.md).

## Tasks: Refresh

Refresh asks the board to publish current state.

A publish can:

- read `tasksSidebar.includeExternalTasks`;
- discover tasks;
- recover per-provider tasks after aggregate discovery failure;
- reconcile live executions;
- reconcile persisted observations;
- load dependency specs;
- read tasks.json diagnostics;
- update last-good snapshots;
- render the webview.

Refresh results are revision-ordered so an older slow refresh cannot overwrite a newer one.

Saving any workspace document whose URI path ends in `/.vscode/tasks.json` also triggers refresh automatically.

## Tasks: Open tasks.json

### Single-root workspace

If one workspace folder is open, the command uses that folder.

It builds:

```text
<workspace>/.vscode/tasks.json
```

If the file does not exist:

1. create `.vscode`;
2. create `tasks.json` with:

```json
{
  "version": "2.0.0",
  "tasks": []
}
```

3. open it in the editor.

### Multi-root workspace

If more than one workspace folder is open and the command is invoked without a specific card, Tasks Sidebar shows a Quick Pick containing folder name + URI.

Choosing a folder opens/creates that folder's task file.

Canceling the picker makes no changes.

### Card Edit action

A Workspace task card can expose **Edit task definition**.

The extension resolves the task again and selects its unique definition in the correct file. Folder tasks open their own `.vscode/tasks.json`; workspace-scoped tasks open the active `.code-workspace` file and select the object in `tasks.tasks`.

Navigation preserves the document exactly, including JSONC comments and trailing commas. Same-named tasks in another folder or another configuration section are never selected. Missing/renamed labels, duplicate labels in the same task array and duplicate JSON properties are treated as ambiguous; check the reported file and refresh the board.

### External task

An external-provider task has no guaranteed workspace tasks.json owned by Tasks Sidebar.

If an edit request targets such a task, the extension warns:

**This task is provided externally and has no workspace tasks.json to edit.**

### No workspace

The command reports:

**Open a workspace before editing tasks.json.**

### File errors

Stat/create/write/open/show failures are caught and reported with the operation that failed, such as checking, creating the folder, creating the file, opening the file or showing it.

The operation uses `vscode.workspace.fs` and VS Code URIs, so in a remote workspace it targets the remote workspace filesystem rather than constructing a local OS path.

## Tasks: Create task

This workflow creates a simple shell task, not an arbitrary VS Code task schema editor.

### Step 1: choose a storage target

In a saved workspace, the Quick Pick offers **Entire Workspace**, with the active `.code-workspace` URI, followed by each workspace folder with its name and URI.

**Entire Workspace** appends to the workspace file's `tasks.tasks` array. Choosing a folder appends to that folder's `.vscode/tasks.json`.

An unsaved workspace offers folder targets only. With a single folder and no saved workspace file, that folder is used directly. With no targets, the extension shows **Open a workspace before creating a task.**

### Steps 2–3: enter a label and shell command

The **Task label** and **Shell command** prompts reject blank input. Canceling any picker or input makes no changes.

### Step 4: validate the configuration

The selected file must contain a valid JSONC object. Duplicate JSON properties and non-object/non-array task sections are rejected rather than overwritten. Existing task configurations must use version `2.0.0`.

Missing task sections are initialized with `version: "2.0.0"` and a `tasks` array. A missing folder task file is created; a missing saved workspace file is reported as an error.

Save or revert existing unsaved changes before creating a task. If the buffer changes during creation, the extension stops instead of saving unrelated changes.

### Step 5: append and save

The new entry is:

```json
{
  "label": "<your label>",
  "type": "shell",
  "command": "<your command>"
}
```

Targeted JSONC edits preserve comments, existing task data and other workspace configuration. Formatting around the insertion may change. The file is opened, saved and the board refreshed; a created workspace task appears at workspace scope and can be run from its card.

Errors name the affected file and include the syntax, structure, permission or save failure. Review any unsaved editor changes after a save failure before retrying.

## Invalid tasks.json

There are two relevant paths.

### Board discovery/diagnostics

The board checks VS Code diagnostics for the task-file URI. If there are errors it can show a warning such as:

```text
<host> · <folder>: tasks.json has N errors. Fix the JSON syntax and retry.
```

Retry is available and the last-good task list can remain visible where possible.

### Create task

Create task parses the file directly. Invalid JSONC or an invalid top-level `tasks` structure causes creation to fail and reports:

**The task could not be created in `<file URI>`.**

The message includes the underlying error and an actionable recovery hint when available.

## Valid VS Code task syntax examples

### Simple shell task

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "Build",
      "type": "shell",
      "command": "npm run build",
      "problemMatcher": []
    }
  ]
}
```

### Process task

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "Node version",
      "type": "process",
      "command": "node",
      "args": ["--version"],
      "problemMatcher": []
    }
  ]
}
```

### Sequential dependencies

```json
{
  "version": "2.0.0",
  "tasks": [
    { "label": "compile", "type": "shell", "command": "npm run compile" },
    { "label": "test", "type": "shell", "command": "npm test" },
    {
      "label": "verify",
      "type": "shell",
      "command": "echo verified",
      "dependsOn": ["compile", "test"],
      "dependsOrder": "sequence"
    }
  ]
}
```

See [Compound tasks and dependencies](04-compound-tasks-dependencies.md).

## Tasks Sidebar tags

Add an optional string array to a workspace task definition:

```json
{
  "label": "Run smoke tests",
  "type": "shell",
  "command": "npm test",
  "tags": ["verification", "smoke"]
}
```

Tags are trimmed, duplicate values are ignored case-insensitively, and matching is case-insensitive. A task can have multiple tags. The board shows tag badges, offers a separate tag filter, and includes tags in search. Add or remove strings in the `tags` array and save `tasks.json` to change the assignment; the array is read again after reload. In **Tags (all required)**, select multiple tags to show only tasks containing every selected tag (AND). Tasks may contain additional tags. **Clear tags** removes the tag restriction. The tag filter can be combined with the existing status filter.

The `tags` property is Tasks Sidebar metadata read directly from `.vscode/tasks.json`; it does not change task execution. VS Code's built-in task JSON schema does not currently include this custom property and may mark it as unknown in the editor. Tasks Sidebar ignores that one schema diagnostic in its own task-file warning so the tag feature does not report its own metadata as a task-file error.

## Standard VS Code task ownership

Tasks Sidebar does not define a replacement task schema.

VS Code owns:

- validation of task types/providers;
- variables such as `${workspaceFolder}`;
- problem matchers;
- presentation options;
- platform-specific task syntax;
- provider-specific task definitions;
- compound execution behavior.

Use the standard VS Code task documentation for schema capabilities. Tasks Sidebar reads/runs the tasks that VS Code exposes.

## File and URI behavior on remote hosts

All task-file access uses VS Code URI/workspace APIs:

- `vscode.Uri.joinPath`
- `vscode.workspace.fs.stat`
- `readFile`
- `createDirectory`
- `writeFile`
- `openTextDocument`

Therefore a WSL, Dev Container or Remote SSH workspace uses the active workspace filesystem as supplied by VS Code.

Support status for those host classes remains best-effort until their manual smoke rows are completed. See [Compatibility and remote hosts](11-compatibility-remote.md).

## Related chapters

- [Discovery and providers](02-discovery-providers-identities.md)
- [Compound tasks](04-compound-tasks-dependencies.md)
- [Troubleshooting tasks.json](09-troubleshooting.md)
- [Compatibility and remote hosts](11-compatibility-remote.md)
