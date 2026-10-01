# Task output, terminal focus and VS Code-owned limitations

Tasks Sidebar offers convenient entry points into VS Code's task output and terminal surfaces. These controls are intentionally thin delegations: Tasks Sidebar does not maintain its own terminal/output mapping.

## Open VS Code task output

The board header action **Open VS Code task output** calls VS Code command:

```text
workbench.action.tasks.openOutput
```

Tasks Sidebar does not select a specific task execution before calling that command and does not inspect the resulting output channel.

The target that appears is therefore controlled by VS Code.

## Focus the active task terminal

The board header action **Focus the active task terminal** calls:

```text
workbench.action.terminal.focus
```

That command focuses VS Code's active terminal.

Tasks Sidebar does not pass a task id, terminal id or execution id to that command.

## Board-level, not per-card semantics

Although task cards have concrete logical/execution identity for Run/Stop/Restart, output and terminal controls are board-level.

They do **not** mean:

- “open output for this card”;
- “focus this execution's exact terminal”;
- “focus the child terminal belonging to this compound parent”.

The webview can technically send an optional id for these routes, but the current board methods intentionally ignore it.

## Shell tasks

A shell task commonly runs in a VS Code terminal. Focusing the active terminal can be useful while such a task is active, but selection is still whatever VS Code currently considers active.

If several terminals exist, Tasks Sidebar does not reorder or select among them.

## Process tasks

A process task can exist without a terminal that VS Code exposes as a focusable task terminal.

In that case **Focus the active task terminal** may focus another currently active terminal or may not provide the task-specific view the user expected.

This is a limitation of the board-level delegation, not evidence that the process task failed.

Use VS Code's task/output UI to inspect the execution.

## Compound tasks and child terminals

A compound task can start multiple child tasks. Those children may have multiple terminals.

Tasks Sidebar does not create or maintain a parent→child-terminal map.

Therefore it cannot promise that choosing the terminal action while looking at a compound parent will focus:

- the first child;
- the failing child;
- the currently running child;
- any deterministic child.

Use individual child cards to understand execution state, then use VS Code's Terminal/Task UI to select the desired terminal.

See [Compound tasks and dependencies](04-compound-tasks-dependencies.md).

## Output for completed tasks

The output command is still delegated to VS Code after a task completes. Whether the expected previous task output is available depends on VS Code's retained task/output state.

Tasks Sidebar does not persist task stdout/stderr itself.

Task history inside Tasks Sidebar stores outcome/timing metadata, not output text.

## When no suitable target exists

### No useful task output

If VS Code cannot open task output or the command throws, Tasks Sidebar reports:

**The task output could not be opened. Use the Output or Terminal panel to inspect the last task.**

If the command succeeds but VS Code shows a different/empty target, Tasks Sidebar has no independent output selector to correct it.

### No focusable task terminal

If terminal focus command throws, Tasks Sidebar reports:

**The task terminal could not be focused.**

If the command succeeds but the active terminal is not the one you expected, use VS Code's Terminal panel/task controls to select the terminal manually.

## Remote workspaces

In a remote workspace, task execution and terminals belong to the active VS Code workspace/remote extension-host environment.

Tasks Sidebar still delegates to the same VS Code commands.

It does not:

- copy remote output locally;
- map remote process ids;
- create a separate remote terminal channel;
- infer a remote child terminal.

The host label in the board (`Remote · <name>`) tells you which workspace context the extension is using.

WSL, Dev Containers and Remote SSH remain best-effort until their individual smoke-test records are completed. See [Compatibility and remote hosts](11-compatibility-remote.md).

## Troubleshooting checklist

If output/terminal selection is surprising:

1. confirm the task card's source, folder and execution state;
2. open VS Code's Terminal panel and inspect available terminals;
3. use VS Code's Tasks/Output UI to select the desired task output;
4. for compound tasks, inspect child cards independently;
5. remember that a process task may have no dedicated terminal;
6. in remote workspaces, verify the task actually runs in the intended remote host;
7. do not interpret missing terminal/output focus as a task outcome.

For lifecycle uncertainty, use [Execution lifecycle](03-execution-lifecycle.md) and [Troubleshooting](09-troubleshooting.md).

## Responsibility boundary

| Behavior | Tasks Sidebar | VS Code |
| --- | ---: | ---: |
| Show task card identity/status | Yes | Supplies task/event data |
| Stop one selected concrete execution | Requests it | Executes termination |
| Open task output command | Invokes command | Selects/displays output |
| Focus active terminal command | Invokes command | Chooses current terminal |
| Map compound parent to exact child terminal | No | VS Code task/terminal UI owns selection |
| Persist stdout/stderr | No | VS Code/task tooling |
| Persist timing/outcome history | Yes | Supplies runtime events |

This boundary is intentional and should be used when interpreting what the toolbar actions can guarantee.
