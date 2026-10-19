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

The extension resolves the task again, determines its workspace-folder URI, then opens that folder's `.vscode/tasks.json`.

The editor is opened at the file level. Tasks Sidebar does not navigate to an exact JSON object/line.

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

### Step 1: choose workspace folder

Single-root: use that folder.

Multi-root: show a Quick Pick with folder name + URI.

No workspace: show **Open a workspace before creating a task.**

### Step 2: enter label

Input prompt: **Task label**

Blank/whitespace-only input is rejected by validation.

Canceling the input aborts the workflow.

### Step 3: enter command

Input prompt: **Shell command**

Blank/whitespace-only input is rejected.

Canceling aborts.

### Step 4: read existing tasks.json

If the file exists, Tasks Sidebar reads and parses it as JSONC.

Comments and trailing commas are accepted for parsing.

If the file does not exist, the in-memory starting document is:

```json
{
  "version": "2.0.0",
  "tasks": []
}
```

### Step 5: validate structure

The parsed top-level document must be an object containing a `tasks` array.

If `tasks` is absent/not an array, creation fails. The extension does not silently replace an unrelated structure with a new array.

If `version` is absent/falsy, it becomes `2.0.0`.

### Step 6: append task

The appended object is:

```json
{
  "label": "<your label>",
  "type": "shell",
  "command": "<your command>"
}
```

Then the extension writes the whole document, opens it, and refreshes the board.

## Important JSONC formatting behavior

Tasks Sidebar **parses** existing task files as JSONC, but **writes** the Create-task result with `JSON.stringify(..., null, 2)`.

That means the structural JSON data is preserved, but source formatting details are not.

Creating a task can remove:

- line comments;
- block comments;
- trailing commas;
- custom indentation/formatting.

Example before:

```jsonc
{
  // Development tasks
  "version": "2.0.0",
  "tasks": [
    {
      "label": "build",
      "type": "shell",
      "command": "npm run build",
    },
  ],
}
```

After creating a `test` task, the file is normalized JSON:

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "build",
      "type": "shell",
      "command": "npm run build"
    },
    {
      "label": "test",
      "type": "shell",
      "command": "npm test"
    }
  ]
}
```

If comments/formatting are important, edit `tasks.json` manually instead of using Create task, or review the diff in source control afterward.

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

**The task could not be created. Check tasks.json permissions and JSON syntax.**

The message is intentionally broad; a structurally invalid `tasks` field can also produce it.

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

Tags are trimmed, duplicate values are ignored case-insensitively, and matching is case-insensitive. A task can have multiple tags. The board shows tag badges, offers a separate tag filter, and includes tags in search. The tag filter can be combined with the existing status filter.

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
