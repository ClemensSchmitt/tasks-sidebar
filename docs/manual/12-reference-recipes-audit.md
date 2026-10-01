# Reference, recipes and final edge-case audit

This chapter is the compact lookup layer for the Tasks Sidebar handbook. It also records the final documentation completeness audit against the implementation, automated tests and the coverage matrix created for issue #40.

## Command reference

| Command Palette title | Command id | Effect | Detailed chapter |
| --- | --- | --- | --- |
| Tasks: Refresh | `tasksSidebar.refresh` | Re-runs discovery/reconciliation and republishes the board. | [Commands and tasks.json](07-commands-settings-tasks-json.md) |
| Tasks: Open tasks.json | `tasksSidebar.openTasksJson` | Opens/creates the chosen workspace folder's task file. | [Commands and tasks.json](07-commands-settings-tasks-json.md) |
| Tasks: Create task | `tasksSidebar.createTask` | Appends a simple shell task after folder/label/command prompts. | [Commands and tasks.json](07-commands-settings-tasks-json.md) |
| Tasks: Toggle external task providers | `tasksSidebar.toggleExternalTasks` | Toggles external-provider visibility at workspace scope. | [Discovery](02-discovery-providers-identities.md) |

## Setting reference

| Setting | Type/default | Effect |
| --- | --- | --- |
| `tasksSidebar.includeExternalTasks` | Boolean / `false` | When false, only workspace-folder tasks are shown by default. When true, external providers may also appear. |

## Board actions

| Visible action | Scope | What Tasks Sidebar does | Important limit |
| --- | --- | --- | --- |
| Refresh | Board | Publishes current discovery/runtime state | Does not change task definitions |
| Open VS Code task output | Board | Invokes VS Code task-output command | VS Code selects target |
| Focus active task terminal | Board | Focuses VS Code terminal surface | Not tied to selected card |
| Create task | Board/empty state | Creates simple shell task | Rewrites JSONC as normalized JSON |
| Open tasks.json | Board/empty state/card | Opens selected workspace task file | Card edit is file-level, not exact JSON object |
| Reset | Board view | Clears query/filter and restores name sort | Presentation-only |
| Run | Task card | Executes current logical task | Duplicate live start is blocked |
| Stop | Concrete live execution | Calls terminate on one TaskExecution | Confirmation still depends on VS Code events |
| Restart | Task/live outcome | Safe stop-then-start or direct Run | Does not blindly overlap a live execution |
| Edit task definition | Workspace task card | Opens owning tasks.json | External tasks have no guaranteed workspace file |

## Runtime state reference

| State/outcome | Meaning | Evidence required / behavior |
| --- | --- | --- |
| Idle | No tracked live execution | Run is available |
| Running | Concrete execution is currently represented live | Stop/Restart available |
| Stopping | Termination requested | Waiting for confirmation; Stop disabled |
| Waiting for task end | Process-end observed, task-end pending | Stop disabled; Restart can queue |
| Success | Confirmed process-end with exit code 0 | Fresh measured success trains plan |
| Failed | Confirmed non-zero exit code | Does not train plan |
| Cancelled | Stop requested and task-end confirmed | Does not train plan |
| Unknown | Terminal evidence insufficient | Never treated as success |
| Stale | Execution no longer observable enough to decide | Not proof of termination |
| Orphaned | Live execution no longer matches current discovered definition | Kept visible instead of hidden |

## Progress state reference

| Progress state | Meaning |
| --- | --- |
| Unknown | No valid plan or uncertain terminal state |
| Measured | Running within learned plan |
| Overtime | Running past learned plan |
| Completed | Latest terminal outcome success |
| Failed | Latest terminal outcome failure |
| Cancelled | Latest terminal outcome cancellation |
| Stale | Latest/active observation became stale |

## Search targets

Search is a case-insensitive substring across:

- task name;
- provider/source;
- group;
- workspace-folder name.

The current UI label omits “folder” even though folder names are actually searchable.

## Filter reference

| Filter | Exact behavior |
| --- | --- |
| All tasks | No extra filter |
| Running | `isRunning`, including stopping/waiting live states |
| Failed | latest outcome = failed |
| Completed | latest outcome = success |
| Unknown / stale | unknown/stale outcome **or** unknown progress state |
| External providers | source/provider is not Workspace |

The Unknown/stale filter can therefore include a task that merely lacks a learned progress plan.

## Sort reference

| Sort | Primary ordering | Tie behavior |
| --- | --- | --- |
| Name | name ascending | source → logical id → execution id |
| Status | running → failed → unknown/stale → success → other | name/source/id/execution id |
| Elapsed | current elapsed descending | name/source/id/execution id |
| Folder | folder name ascending | name/source/id/execution id |

## Provider modes

| Mode | Setting | Visible source policy |
| --- | --- | --- |
| Workspace-only | `includeExternalTasks=false` | Workspace tasks scoped to workspace folders |
| External-enabled | `includeExternalTasks=true` | Workspace + provider/global tasks returned by VS Code |
| Partial fallback | aggregate discovery failed | Per-type fallback results remain visible with warning |

Provider source is part of logical identity.

## Identity reference

| Identity | Components | Main purpose |
| --- | --- | --- |
| Logical task | source + name + scope + canonical definition | Current task/card identity |
| Runtime execution | session-local `execution-N` for TaskExecution | Independent live Stop/control |
| History | source + scope + behavior definition without label/taskName | Keep plan across rename but not behavior change |
| Persisted active observation | logical id + workspace URI + metadata/time | Reload/reconnect reconciliation |

## Persistence and retention reference

| Item | Limit/behavior |
| --- | --- |
| Successful duration samples | max 20 per history record |
| History records | max 200 |
| Successful plan source | latest fresh measured successful duration |
| Last-good snapshots | cached as idle/non-orphaned snapshots |
| Active observations | persisted for reload/reconnect |
| Search/filter/sort UI state | in-memory webview only; not workspaceState-persisted |
| Runtime execution ids | session-local; not durable across reload |

## Compatibility reference

| Environment | Support | Validation |
| --- | --- | --- |
| Local Windows | Supported | Automated VS Code 1.85.0 + Stable source/VSIX matrix |
| Local macOS | Supported | Automated VS Code 1.85.0 + Stable source/VSIX matrix |
| Local Linux | Supported | Automated VS Code 1.85.0 + Stable source/VSIX matrix |
| WSL | Best effort | Manual remote smoke not run |
| Dev Containers | Best effort | Manual remote smoke not run |
| Remote SSH | Best effort | Manual remote smoke not run |

Minimum VS Code version: **1.85.0**.

## Important lifecycle rules

1. Exit code 0 with confirmed process evidence is success.
2. Non-zero exit code is failure.
3. Missing exit/process evidence is never promoted to success.
4. Confirmed user stop is cancellation.
5. Unconfirmed stop can become stale.
6. Background/watch tasks do not become stale merely because they run a long time.
7. Restart is stop-then-start for a live execution.
8. Start is blocked while the logical task is already starting/live.
9. A stale execution can coexist with a new execution, but a reappearing stale execution is reconciled before another Start is accepted.
10. Parent Stop does not recursively terminate child executions.
11. Sequential dependencies are evaluated in declared order.
12. Parallel dependencies are aggregated conservatively.
13. Fresh success alone trains the progress plan.
14. Recovered success after reload does not train the plan.
15. Rename can retain history; behavior change starts new history.

# Recipes

## Recipe 1: simple shell task

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "Hello",
      "type": "shell",
      "command": "echo Hello",
      "problemMatcher": []
    }
  ]
}
```

Save the file, open Tasks, select Run.

Expected flow:

```text
Idle → Running → Success
```

assuming VS Code reports exit code 0.

## Recipe 2: same-name tasks from different providers

Suppose the workspace defines:

```json
{
  "label": "build",
  "type": "shell",
  "command": "npm run build"
}
```

and an npm provider also exposes a task named `build`.

Enable external providers.

The board can show two `build` cards because provider/source differs.

Use provider text/search to distinguish them.

## Recipe 3: parallel concrete executions

The extension's own Run button prevents a duplicate live start for one logical task, but VS Code/external orchestration can still expose multiple TaskExecution objects.

When that happens:

- each gets a separate execution id;
- each is a separate live card;
- Stop targets one concrete execution.

Do not assume one Stop controls every same-name live run.

## Recipe 4: sequential dependencies

```json
{
  "version": "2.0.0",
  "tasks": [
    { "label": "compile", "type": "shell", "command": "npm run compile" },
    { "label": "test", "type": "shell", "command": "npm test" },
    {
      "label": "verify",
      "type": "shell",
      "command": "echo done",
      "dependsOn": ["compile", "test"],
      "dependsOrder": "sequence"
    }
  ]
}
```

Interpretation:

- compile must resolve before test is considered satisfied;
- compile running → parent dependency state Running;
- compile success but test missing → Unresolved: test;
- test failure → Failed: test;
- both success → Dependencies satisfied.

## Recipe 5: parallel dependencies

```json
{
  "version": "2.0.0",
  "tasks": [
    { "label": "lint", "type": "shell", "command": "npm run lint" },
    { "label": "test", "type": "shell", "command": "npm test" },
    {
      "label": "quality",
      "type": "shell",
      "command": "echo done",
      "dependsOn": ["lint", "test"]
    }
  ]
}
```

Parallel aggregation checks completed failure/cancellation/unknown before deciding running/success.

If one child fails, the parent dependency status reports that failure rather than claiming all dependencies were satisfied.

## Recipe 6: background/watch task

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "watch",
      "type": "shell",
      "command": "npm run watch",
      "isBackground": true
    }
  ]
}
```

While running:

- card can show Watch;
- plan text can say Runs continuously;
- ordinary long runtime alone does not make it stale.

If you request Stop and VS Code never confirms end, stale handling can still apply.

## Recipe 7: Restart while stopping

Scenario:

1. task is Running;
2. choose Restart;
3. extension marks restart requested and issues Stop;
4. state becomes Stopping;
5. pressing Restart again while already Stopping does not stack another request;
6. once the old execution finalizes, the new run starts.

If termination fails, restart intent is cleared and the error is shown.

## Recipe 8: reload while a task is running

Scenario A — execution survives:

```text
Running
→ reload
→ VS Code still reports execution
→ recovered Running / since reload
→ duplicate Start blocked
```

Scenario B — execution is not reported:

```text
Running
→ reload
→ persisted observation pending
→ timeout
→ Unknown
```

Neither reload nor reconnect alone proves success/cancellation.

## Recipe 9: diagnose Unknown vs Stale

Use **Unknown / stale** filter, then inspect status.

### Unknown

Think “the extension saw an end/lost observation but cannot determine the terminal result.”

Common examples:

- missing exit code;
- task-end without process-end;
- persisted run disappeared after reload timeout.

### Stale

Think “the tracked execution stopped being observable before a trustworthy end.”

Common examples:

- lost end event;
- Stop unconfirmed after timeout;
- execution disappeared from VS Code's live list.

Do not infer process termination from either state.

## Recipe 10: multi-root workspace

Workspace:

```text
root
├─ api
│  └─ .vscode/tasks.json -> build
└─ web
   └─ .vscode/tasks.json -> build
```

The two `build` tasks remain distinct because workspace URI is part of identity.

Useful controls:

- search `api` or `web`;
- Sort: folder;
- card Edit opens the owning root's task file;
- board Open tasks.json/Create task without a card asks which root to use.

## Recipe 11: task rename without losing plan

Start with:

```json
{ "label": "build-old", "type": "shell", "command": "npm run build" }
```

After a successful run, rename only the label:

```json
{ "label": "build-new", "type": "shell", "command": "npm run build" }
```

The logical task id changes because name changed, but history identity strips presentation label fields. The plan can therefore remain.

If you change the command instead, a new history identity is expected.

## Recipe 12: recover from a provider-discovery warning

If the board says some task providers could not be queried:

1. keep using recovered visible tasks if appropriate;
2. inspect workspace/remote connection;
3. inspect provider availability;
4. choose Retry;
5. check whether a provider type is declared in tasks.json;
6. include exact warning + provider/host in a bug report if persistent.

Do not assume visible last-good/recovered tasks prove every provider is healthy.

# Final edge-case audit

## Audit basis

The final review cross-checked:

- `package.json` contributions, engine and extensionKind;
- `src/extension.ts`;
- `src/runtime.ts`;
- all 43 runtime tests in `test/runtime.test.js`;
- Extension Host integration contracts in `test/integration/suite.js`;
- release/VSIX tests and installed-package probe;
- manual release smoke procedure;
- manual accessibility procedure;
- remote smoke procedure;
- README, CHANGELOG and SUPPORT;
- the 116 behavior rows in `docs/manual/coverage-matrix.md` from issue #40.

## Completeness mapping

Every coverage-matrix area has a handbook destination:

| Matrix area | Handbook destination |
| --- | --- |
| DISC / ID | [Discovery/providers/identities](02-discovery-providers-identities.md) |
| LIFE / RUN | [Execution lifecycle](03-execution-lifecycle.md) |
| DEP | [Compound tasks/dependencies](04-compound-tasks-dependencies.md) |
| VIEW | [Search/filter/sort](05-search-filter-sort.md) |
| HIST | [History/progress/persistence](06-history-progress-persistence.md) |
| PERS | [History/persistence](06-history-progress-persistence.md) and [Compatibility/reconnect](11-compatibility-remote.md) |
| UI | [Installation/Task Board walkthrough](01-installation-first-run.md), [Search](05-search-filter-sort.md), [Accessibility](10-accessibility.md) |
| OUT | [Output/terminal](08-output-terminal.md) |
| TASKS | [Commands/settings/tasks.json](07-commands-settings-tasks-json.md) |
| ERR | [Troubleshooting](09-troubleshooting.md) |
| A11Y | [Accessibility](10-accessibility.md) |
| COMP | [Compatibility/remote](11-compatibility-remote.md) |
| Commands/settings/actions/states | This reference chapter plus linked detailed chapters |

## Adversarial checks performed

The audit explicitly looked for behavior likely to be omitted from normal user documentation:

- stale execution reappearing after being marked stale;
- preserving stop intent after process end but clearing it when no process end existed;
- execution ids being session-local instead of durable;
- exact duplicate definitions vs same-name distinct definitions;
- dependency-name ambiguity for duplicate labels within one folder;
- unknown progress causing membership in Unknown/stale filter;
- Create task accepting JSONC but destroying comments/formatting on rewrite;
- board-level output/terminal semantics;
- last-good snapshots after discovery failure;
- active observation multiplicity during reload;
- refresh revision race protection;
- malformed webview action/render handling;
- persistence-write failure messages;
- orphaned live execution visibility;
- no recursive child stop for compound tasks;
- no false stale timeout for normal background/watch runtime;
- recovered success being excluded from plan training;
- search/filter/sort view state not being durably persisted;
- accessibility automation not being confused with manual certification;
- local Linux CI not being confused with WSL/Dev Container certification.

All of these now have handbook destinations.

## Remaining validation gaps are tracked, not undocumented behavior

The audit did not identify a user-visible behavior that lacks a handbook destination after issues #41–#52.

There are, however, validation activities that remain pending in the repository:

- manual installed-candidate GUI smoke cases;
- manual accessibility/theme/assistive-technology cases;
- WSL remote smoke;
- Dev Container remote smoke;
- Remote SSH smoke.

These are already represented by existing repository issues/procedures and are documented as **Pending/Not run**, so no additional documentation sub-issue is required solely for those gaps.

## Known documentation corrections incorporated

The handbook set explicitly corrects or clarifies issues found during #40:

1. the current published GitHub release is v0.0.6 rather than the stale v0.0.5 README wording;
2. search includes workspace-folder name;
3. Unknown/stale filtering also includes unknown progress state;
4. Create task normalizes JSONC to JSON;
5. external-provider toggle is not a board toolbar control;
6. output/terminal actions are board-level;
7. same-name dependency resolution is label-limited;
8. runtime execution ids are session-local;
9. manual/remote/accessibility validation is not overstated.

## Definition-of-done check for the handbook epic

Once the individual documentation PRs are reviewed and merged, the handbook structure provides:

- beginner installation path;
- full Task Board anatomy;
- discovery/provider/identity reference;
- lifecycle/state model;
- compound/dependency behavior;
- search/filter/sort behavior;
- history/progress/persistence;
- command/settings/tasks.json workflows;
- output/terminal ownership boundary;
- troubleshooting/recovery;
- accessibility contracts and limitations;
- compatibility/remote/reconnect behavior;
- compact reference and recipes;
- a coverage matrix mapping implementation/test edge cases to chapters.

Before closing #39 after merges, re-run the coverage-matrix audit against the merged commit so any implementation changes made during review are captured.
