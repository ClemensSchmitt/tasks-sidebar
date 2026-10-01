# Compound tasks, parent-child relationships and dependencies

Tasks Sidebar shows compound-task relationships but deliberately leaves task orchestration to Visual Studio Code. The board observes and explains parent/child state; it does not replace VS Code's dependency engine.

## Parent and child representation

When VS Code exposes a compound parent and its dependency executions, Tasks Sidebar can show them as separate cards.

A parent card can display:

- its own runtime state;
- `Depends on <labels> (<sequence|parallel>)`;
- a derived dependency state;
- its own history and progress.

A child card can display:

- its own runtime state;
- its own concrete execution id;
- a `Child` marker when the current discovery graph identifies it as a dependency;
- its own history/progress information.

The parent and child are not merged into one synthetic execution.

## Why stopping a parent does not automatically stop children

Stop targets one concrete `TaskExecution`.

For a compound parent, Tasks Sidebar calls terminate on the selected parent execution only. It does not recursively walk child tasks and terminate them.

That is intentional:

- VS Code owns compound-task orchestration;
- the extension cannot safely infer that all children should be killed;
- a child may be shared, independently started or otherwise controlled by VS Code.

If a child continues after its parent is stopped, that is not proof that Stop failed. Inspect the individual child card and VS Code's task/terminal surfaces.

## Dependency parsing

For each workspace folder, Tasks Sidebar reads that folder's `.vscode/tasks.json` and parses:

- `label` (or legacy `taskName`);
- `dependsOn`;
- `dependsOrder`.

`dependsOn` may be a string or a list of strings.

`dependsOrder: "sequence"` selects sequential evaluation. Any other/missing value is treated as parallel for board dependency-state purposes.

The parsing is JSONC-aware, so comments and trailing commas are accepted.

## Sequential dependencies

Example:

```jsonc
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "compile",
      "type": "shell",
      "command": "npm run compile"
    },
    {
      "label": "test",
      "type": "shell",
      "command": "npm test"
    },
    {
      "label": "release",
      "type": "shell",
      "command": "echo release",
      "dependsOn": ["compile", "test"],
      "dependsOrder": "sequence"
    }
  ]
}
```

For the parent `release`, dependencies are evaluated in declared order.

The board does not allow a later dependency's previous success to hide an earlier dependency that is still active or unresolved.

Simplified state evaluation:

1. If `compile` is missing → Unresolved: compile.
2. If `compile` is running → Dependency running.
3. If `compile` failed → Dependency failed: compile.
4. If `compile` was cancelled → Dependency cancelled: compile.
5. If `compile` is unknown/stale → Dependency unknown: compile.
6. Only after compile is successful does evaluation move to `test`.
7. When all declared dependencies are successful → Dependencies satisfied.

## Parallel dependencies

Example:

```jsonc
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "lint",
      "type": "shell",
      "command": "npm run lint"
    },
    {
      "label": "test",
      "type": "shell",
      "command": "npm test"
    },
    {
      "label": "quality",
      "type": "shell",
      "command": "echo quality complete",
      "dependsOn": ["lint", "test"]
    }
  ]
}
```

With parallel dependency evaluation, child observations are aggregated.

The board uses conservative precedence:

1. a completed failed child → Failed;
2. otherwise a completed cancelled child → Cancelled;
3. otherwise an unknown/stale child → Unknown;
4. otherwise missing/unresolved child information → Unresolved;
5. otherwise any running child → Running;
6. all children successful → Success.

A currently running child takes precedence over its own previous historical failure. This prevents an old result from making a live retry look failed while it is still running.

## Dependency states

| Dependency state | Meaning |
| --- | --- |
| Running | At least the currently relevant dependency is still active. |
| Success | All required dependency observations are successful. |
| Failed | A required completed dependency failed. |
| Cancelled | A required completed dependency was cancelled. |
| Unknown | A dependency has insufficient/uncertain terminal evidence. |
| Unresolved | A required dependency cannot yet be mapped or lacks enough state to decide. |

These states are appended to the parent's runtime status. They do not replace the parent's own lifecycle outcome.

## Missing or out-of-order child observations

Tasks Sidebar does not invent success for a child it cannot see.

If a declared dependency has no matching discovered child, the parent can show **Dependency unresolved**.

If a child ends with unknown/stale evidence, the parent can show **Dependency unknown**.

This is important when VS Code events arrive out of order or discovery changes while a compound task is running.

## Same-name dependency limitation

Logical task cards can distinguish same-name tasks using provider, folder and definition.

Dependency references in `tasks.json`, however, are label-based. The board's dependency metadata map is keyed by workspace-folder scope plus task name.

If two distinct definitions inside the same workspace folder deliberately use exactly the same label, the board cannot promise a stronger dependency disambiguation than that label. Avoid duplicate dependency labels when you need predictable parent/child explanation.

Dependencies are not implicitly resolved across workspace roots solely because a label matches.

## History and progress separation

Parent and child tasks keep separate logical/history identities.

A successful child duration contributes to that child's plan, not to an unrelated parent task's plan.

Likewise, the parent execution's duration remains the parent's own history record. Tasks Sidebar does not merge the entire compound duration into a child task's user-run sample.

This matters because a child can be:

- run independently by the user;
- run as part of a sequence;
- run in parallel under a compound task.

Those observations remain tied to their own task identities.

See [Runtime history, progress and persistence](06-history-progress-persistence.md).

## Parallel child executions

Concrete child executions receive their own runtime ids. If multiple child executions exist, they remain independently observable and independently stoppable.

The extension does not collapse multiple `TaskExecution` instances merely because they share one logical definition.

See [Execution lifecycle](03-execution-lifecycle.md).

## Output and terminal implications

The board's output and terminal controls are not child selectors.

- **Open VS Code task output** delegates to VS Code's task output selection.
- **Focus the active task terminal** focuses VS Code's currently active task terminal.

Tasks Sidebar does not map a selected compound parent to one deterministic child terminal. A process task may also have no terminal to focus.

See [Task output and terminal focus](08-output-terminal.md).

## Worked sequence example

Suppose `release` depends sequentially on `compile`, then `test`.

```text
compile running
release: Dependency running

compile success
test not observed yet
release: Dependency unresolved: test

test running
release: Dependency running

test failed
release: Dependency failed: test
```

A previous test success does not override the current running/failed observation.

## Worked parallel example

Suppose `quality` depends on `lint` and `test`.

```text
lint running + test success
quality: Dependency running

lint failed + test success
quality: Dependency failed: lint
```

If one child is unknown, the parent remains dependency-unknown rather than being reported satisfied.

## Troubleshooting compound tasks

When compound behavior is surprising:

1. inspect each child card separately;
2. inspect the parent dependency label/state;
3. remember that Stop on the parent is not recursive;
4. use VS Code's task output/terminal surfaces to inspect child processes;
5. check for duplicate dependency labels in the same workspace folder;
6. verify that the declared `dependsOn` names match task labels in that folder.

See [Troubleshooting](09-troubleshooting.md).
