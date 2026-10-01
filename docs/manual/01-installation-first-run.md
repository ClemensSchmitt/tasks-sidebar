# Installation, first run and Task Board walkthrough

This chapter takes a new user from a VSIX file to the first successful task run, then identifies every visible Task Board area and explains which parts belong to Tasks Sidebar versus VS Code.

## Requirements

Tasks Sidebar requires **Visual Studio Code 1.85.0 or newer**. The package metadata declares this minimum and activation performs its own version check. If an older VS Code version loads the extension anyway, Tasks Sidebar shows an error containing the required and current versions and does not continue normal activation.

The extension declares `extensionKind: ["workspace"]`. In a local workspace it runs in the local extension host. In a remote workspace, VS Code may run it in the workspace/remote extension host; see [Compatibility, remote hosts and reconnects](11-compatibility-remote.md).

## Install from a VSIX

The current published GitHub release is **v0.0.6** and includes `tasks-sidebar-0.0.6.vsix`.

1. Download the VSIX from the repository's v0.0.6 GitHub Release.
2. In VS Code open the Extensions view.
3. Open the Extensions `...` menu.
4. Choose **Install from VSIX...**.
5. Select the downloaded VSIX.
6. If VS Code asks for a reload, follow the prompt.
7. Open the **Tasks** Activity Bar container.

There is currently no Visual Studio Marketplace listing. Installation is therefore VSIX-based.

### Upgrade or reinstall

Installing a newer VSIX with VS Code's normal extension installer replaces the installed package for that profile/host. The release-candidate manual test procedure includes uninstall/reinstall as a separate smoke case, but that GUI test record is still pending. Do not treat the existence of the procedure as proof that the case has been run.

In remote workspaces, verify that the extension is installed in the active remote/workspace host rather than only locally. See [Remote hosts](11-compatibility-remote.md).

## Open the Task Board

Tasks Sidebar contributes an Activity Bar container titled **Tasks** and a webview named **Task board**. Opening it activates the extension.

At the top of the board you will see:

- **Tasks** — the board title.
- **Version badge** — the loaded extension package version, for example `v0.0.6`.
- **Host label** — either `Local extension host` or `Remote · <name>`.
- **Refresh** — re-runs task discovery.
- **Open VS Code task output** — delegates to VS Code's task output command.
- **Focus the active task terminal** — delegates terminal focus to VS Code.
- **Create task** — creates a simple workspace shell task.
- **Open tasks.json** — opens the selected workspace folder's task file.

Below the header:

- **Search** searches task name, provider/source, group and workspace-folder name.
- **Reset** clears search/filter choices and restores name sorting.
- **Filter** offers All, Running, Failed, Completed, Unknown / stale and External providers.
- **Sort** offers name, status, elapsed time and folder.

The external-provider toggle is **not** a toolbar button. Use **Tasks: Toggle external task providers** from the Command Palette or change `tasksSidebar.includeExternalTasks`.

## First workspace task

Create or edit `.vscode/tasks.json` in the workspace:

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

Save the file. Saving a workspace `.vscode/tasks.json` triggers a refresh automatically. You can also choose **Tasks: Refresh** or the board's Refresh button.

By default Tasks Sidebar shows only workspace tasks represented by VS Code as tasks scoped to a workspace folder. npm, extension, user and other external providers are opt-in. See [Task discovery, providers and identities](02-discovery-providers-identities.md).

## Understand a task card

A card can show:

- task name;
- provider/source such as `Workspace` or `npm`;
- group;
- workspace-folder name in multi-root workspaces;
- dependency/child information;
- concrete execution id while a run is represented;
- `Orphaned` if an older live execution no longer matches the current definition;
- runtime status;
- progress/plan information;
- Run, Stop, Restart and Edit actions when allowed.

The board does not use color alone to convey the important state: status text, glyphs and accessible labels carry the same core meaning.

### Run

For an idle workspace task, choose **Run** (the play button). Tasks Sidebar finds the current task definition through VS Code and calls the VS Code task API.

A successful process must have confirmed process-end evidence and exit code `0`. A non-zero exit code is failed. Missing exit/process-end evidence is never promoted to success.

### Stop

Choose **Stop** on a live execution. This is a request to terminate that concrete `TaskExecution`. The board enters **Stopping** until VS Code provides evidence about what happened.

A confirmed stop is shown as **Cancelled**. If the end cannot be confirmed within the bounded timeout, the run can become **Stale** instead. Stale means the extension can no longer prove the execution's state; it does **not** mean the extension proved the process terminated.

For the complete state model, see [Execution lifecycle, stop and safe restart](03-execution-lifecycle.md).

### Restart

Restart is safe stop-then-start behavior. It does not blindly launch another run on top of a live one. See [Execution lifecycle](03-execution-lifecycle.md).

## Empty and first-run states

### No workspace

With no workspace open and external providers disabled, the board reports that no workspace is open and asks you to open one.

### Workspace with no tasks

A valid workspace with no visible tasks shows an empty card with:

- **Create task**
- **Open tasks.json**
- **Refresh**

The hint explains that workspace tasks are shown by default and external providers are opt-in.

### Filter produces no matches

This is different from having no tasks. The board shows **No matching tasks** and tells you to change search or filters.

### Invalid or unreadable tasks.json

A warning appears above the board when the task file cannot be read or VS Code reports JSON errors. The warning contains **Retry**. If a previous valid task list exists, the extension keeps useful last-good information visible where possible instead of clearing the board solely because refresh failed.

See [Troubleshooting and recovery](09-troubleshooting.md).

## Version, host and provider labels

The header's version is the package actually loaded by the extension host.

The host label is generated from VS Code's environment:

- no remote name: `Local extension host`;
- remote name present: `Remote · <name>`.

Each task card also shows its provider/source. Provider identity is important: two tasks may share a display name but still be distinct when source, scope or definition differs.

## What Tasks Sidebar owns

Tasks Sidebar owns:

- task-board presentation;
- workspace-only default filtering;
- optional external-provider visibility;
- board search/filter/sort;
- its lifecycle/history interpretation;
- progress planning from previous successful runs;
- selecting a concrete execution for Stop;
- safe Restart policy;
- its warnings, retry surface and persistence metadata;
- editing/creating the workspace task file through VS Code APIs.

## What VS Code owns

VS Code owns:

- actual task execution;
- task provider implementation;
- compound-task orchestration;
- process/task events exposed to the extension;
- the output target selected by **Open VS Code task output**;
- the terminal that is active when **Focus the active task terminal** runs;
- workspace/remote file systems beneath `vscode.workspace.fs`;
- remote extension-host connectivity.

For example, Tasks Sidebar does not guess which child terminal belongs to a compound task and cannot promise that focusing the terminal will select a particular card's terminal.

## Disable or uninstall

Disabling or uninstalling the extension removes the Task Board functionality until the extension is enabled/installed again. Task definitions remain normal VS Code task configuration in the workspace; the extension does not own or delete those task definitions as part of uninstall.

Workspace-state data such as Tasks Sidebar history is extension-managed metadata and should not be treated as the source of task definitions. The authoritative task configuration remains VS Code's task system and workspace files/providers.

## Next steps

- [Discovery, external providers, duplicate handling and identities](02-discovery-providers-identities.md)
- [Execution lifecycle, Stop and Restart](03-execution-lifecycle.md)
- [Commands, settings and tasks.json workflows](07-commands-settings-tasks-json.md)
- [Troubleshooting](09-troubleshooting.md)
- [Compatibility and remote hosts](11-compatibility-remote.md)
