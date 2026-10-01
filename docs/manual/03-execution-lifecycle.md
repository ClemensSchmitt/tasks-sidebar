# Execution lifecycle, states, stop and safe restart

Tasks Sidebar uses conservative lifecycle rules. It reports success only when the VS Code task events provide enough evidence, and it does not describe an unconfirmed stop or lost execution as terminated.

## Core model

A running task can generate two important VS Code event families:

- **process end** — may contain an exit code;
- **task end** — confirms the task execution ended at the task layer.

These events can arrive in either order. Tasks Sidebar reduces them into one state instead of assuming a fixed order.

## State transition overview

```text
Idle
  │ Run
  ▼
Running ── Stop ──► Stopping
  │                   │
  │ process end       │ confirmed task end
  ▼                   ▼
Waiting for task end  Cancelled
  │
  │ task end + exit 0
  ├──────────────► Success
  │ task end + exit != 0
  ├──────────────► Failed
  │ insufficient evidence
  ├──────────────► Unknown
  │ observation timeout/loss
  └──────────────► Stale

Stale + same execution observed again
  └──────────────► Running or Waiting for task end
```

The diagram is conceptual: VS Code event order can vary and Stop introduces cancellation semantics that take precedence when confirmed.

## State reference

| State | Meaning | Typical entry | Exit | User actions |
| --- | --- | --- | --- | --- |
| Idle | No tracked live execution for this definition | Discovery, completed run | Run | Run; Edit for Workspace task |
| Running | Concrete execution is reported active | Run/start event/rehydration | process/task end, Stop, stale detection | Stop; Restart; Edit if Workspace |
| Stopping | A termination request was issued | Stop | confirmed end, termination failure, timeout | Stop disabled; Restart request is not duplicated |
| Waiting for task end | Process end seen but task-end confirmation still pending | process-end event | task-end or timeout | Stop disabled; Restart may queue |
| Success | Confirmed process evidence with exit code 0 | finalized run | next run | Run/Restart |
| Failed | Confirmed non-zero exit code | finalized run | next run | Run/Restart |
| Cancelled | Stop was requested and task-end confirmation arrived | finalized stopped run | next run | Run/Restart |
| Unknown | End/exit evidence is insufficient | task-end without process evidence, missing exit code, lost persisted observation | next run/new observation | Run/Restart when no live execution remains |
| Stale | Execution is no longer observable after bounded waiting | lost end event or unconfirmed stop timeout | same execution reappears or user starts a new run | Run and Restart can become possible because stale is not treated as confirmed live |

## Start behavior

When the user chooses Run:

1. the extension reconciles currently reported `vscode.tasks.taskExecutions`;
2. it checks whether that logical task is already starting or has a non-stale live execution;
3. duplicate start is rejected with **This task is already running**;
4. the current task definition is found again through VS Code;
5. `vscode.tasks.executeTask()` is called;
6. the resulting execution is tracked if the start event has not already registered it.

If task discovery fails, the task vanished, or VS Code rejects execution, the extension reports a message and clears the transient starting lock.

The board itself serializes one logical task start. External sources can still create multiple concrete executions; the board represents them separately.

## Concrete runtime IDs and parallel executions

Every observed `TaskExecution` receives a session-local id such as `execution-3`.

Two concrete executions can therefore have:

- the same logical task definition;
- separate runtime ids;
- separate elapsed time;
- separate Stop targets.

Stopping one concrete execution does not automatically stop another.

The extension's own Run button prevents starting a second live execution of the same logical task, but externally created/VS Code-created parallel executions remain observable.

## Success and failure

### Success

Success requires process-end evidence with exit code `0`.

A fresh, measured success can update:

- last successful duration;
- run count;
- duration samples;
- future progress plan.

A rehydrated/recovered execution that later looks successful does **not** train the plan, because timing began at reload rather than at the original true start.

### Failure

Any confirmed non-zero process exit code is failure.

Failure is stored as the most recent outcome but does not replace the last successful plan duration.

## Missing evidence means unknown, not success

The following are conservative cases:

- process-end seen but exit code missing → **Unknown**;
- task-end seen but process-end evidence never arrives within grace → **Unknown**;
- persisted observation disappears after reload/reconnect grace → **Unknown**;
- lost end observation after active tracking timeout → **Stale**.

The extension never interprets these as success merely because no explicit error was seen.

## Stop behavior

Stop targets the concrete execution id shown/tracked for that live run.

When Stop is selected:

1. lifecycle becomes **Stopping**;
2. `TaskExecution.terminate()` is requested;
3. the board waits for VS Code evidence;
4. a confirmed task end while stop intent is retained resolves to **Cancelled**;
5. if termination throws/rejects, the state returns conservatively to Running or Waiting for task end and an error is shown;
6. if no confirming end arrives within the stop timeout, the execution can become **Stale**.

A stop request with an exit code of 0 is still **Cancelled** once the stop is confirmed; it is not reclassified as a normal success.

## Why stale is not “stopped”

Stale means **the extension cannot currently observe enough evidence to know the execution's terminal result**.

It does not mean:

- process killed;
- success;
- failure;
- cancellation.

This distinction prevents the UI from claiming an outcome VS Code did not confirm.

## Safe Restart

Restart is explicitly stop-then-start.

### Running

For a normal Running execution:

1. set a restart request;
2. request Stop on that execution;
3. wait for the old run to finish or become stale;
4. start the current logical task definition.

### Already stopping

If Restart is requested while lifecycle is already **Stopping**, the extension reports that the task is already stopping. It does not stack a second termination/restart request.

### Waiting for task end

If process end has already occurred and lifecycle is **Waiting for task end**, Restart is queued. A new execution is not started until the old task is finalized.

### Stale

For a Stale execution, Restart starts the current logical definition directly because stale is no longer treated as a confirmed live blocker.

A stale card can therefore coexist with a new live execution.

However, before a new Start is accepted, reconciliation checks VS Code's currently reported executions. If the previously stale execution reappears, it is restored to an active state first and duplicate start is blocked.

### Idle/failed/cancelled/unknown completed run

With no active execution, Restart falls back to normal Run behavior.

## Re-observing a stale execution

If VS Code reports the same tracked execution again:

- stale is cleared if task-end was not already terminally observed;
- if no process-end evidence existed, an old unconfirmed stop request is cleared and lifecycle returns to Running;
- if process-end evidence already existed, stop intent is preserved and lifecycle returns to Waiting for task end.

This distinction avoids losing cancellation intent after process end while also preventing an old unconfirmed Stop click from permanently blocking a genuinely live execution after reconnect.

## Background and watch tasks

Background/watch tasks are intentionally open-ended.

A background task does **not** become stale simply because it runs for a long time and no normal end event occurs.

A stale check is appropriate when:

- Stop was requested;
- the execution disappears from VS Code's reported executions;
- task-end evidence is otherwise missing in a situation that requires bounded resolution.

While running, background tasks can display **Watch** and **Runs continuously**.

## Action availability

The card policy is approximately:

- live Running: Stop + Restart;
- Stopping: Stop disabled, Restart not duplicated through normal action policy;
- Waiting for task end: Stop disabled, Restart available/queueable;
- idle with no prior outcome: Run;
- completed outcome: Run + Restart;
- Workspace-source task: Edit is additionally available.

Because Stale is represented as not actively running but has a stale outcome, a stale card can expose a normal start path and Restart semantics as described above.

## Event ordering examples

### Process end first

```text
Running
process-end(exit 0)
Waiting for task end
task-end
Success
```

### Task end first

```text
Running
task-end
brief grace period
process-end(exit 0)
Success
```

If process evidence never appears before grace resolution, outcome is Unknown.

### Stop then end

```text
Running
Stop
Stopping
process-end
task-end
Cancelled
```

## History impact

| Outcome | Updates last outcome | Updates last run duration | Updates successful plan | Increments successful run count |
| --- | --- | --- | --- | --- |
| Success, fresh | yes | yes | yes | yes |
| Success, recovered | yes | yes | no | no |
| Failed | yes | yes | no | no |
| Cancelled | yes | yes | no | no |
| Unknown | yes | yes when finalized from observation | no | no |
| Stale | yes | not a successful sample | no | no |

See [Runtime history, progress and persistence](06-history-progress-persistence.md).

## Compound tasks

Stopping a parent terminates only the selected parent execution from the extension's perspective. Tasks Sidebar does not recursively terminate child executions because VS Code owns compound orchestration.

See [Compound tasks and dependencies](04-compound-tasks-dependencies.md).

## Troubleshooting

For a task that appears stuck in Stopping, Waiting, Unknown or Stale, do not assume its process state solely from the card. Check VS Code's Task/Terminal/Output surfaces and use [Troubleshooting and recovery](09-troubleshooting.md).
