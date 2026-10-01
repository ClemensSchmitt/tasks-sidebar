# Runtime history, elapsed time, progress plans and persistence

Tasks Sidebar uses runtime history to explain elapsed time and to provide a simple progress plan. The plan is deliberately conservative: only a fresh, confirmed successful run teaches the next estimate.

## Elapsed time

Active elapsed time is measured using a monotonic host clock when available (`performance.now()`), with a fallback to `Date.now()`.

The calculation is:

```text
elapsed = max(0, monotonicNow - startedAt)
```

This prevents a backwards wall-clock adjustment from producing a negative duration.

### Suspend and resume

Elapsed time is policy-defined as host elapsed/wall duration between observations, not CPU execution time.

If the machine sleeps for two minutes while a task is running, those two minutes can be part of the displayed elapsed duration after resume. Tasks Sidebar does not claim to measure CPU-active time.

### Persisted wall-clock timestamps

Persisted active observations use wall-clock timestamps such as `Date.now()` so the extension can determine how old an observation is after reload.

Those timestamps are metadata for reconciliation. They are not used as a claim of precise active runtime.

## The progress plan

A task's plan duration comes from the **latest successful measured duration**.

If history contains:

```text
durations = [42s, 39s, 41s]
```

the next plan is 42 seconds, not an average.

The implementation first uses `lastDurationMs`; older sample arrays are a compatibility fallback.

## Which runs teach the plan?

| Outcome | Plan changes? | Reason |
| --- | ---: | --- |
| Fresh confirmed success | Yes | Valid measured success |
| Recovered/rehydrated success | No | Start time before reload is not measured by current monotonic clock |
| Failed | No | Failure duration is not a successful plan sample |
| Cancelled | No | User-requested stop is not a successful plan sample |
| Unknown | No | Evidence is insufficient |
| Stale | No | Execution state/end is not confirmed |

This rule explains why the board can show a recent failure or cancellation while continuing to use an older successful plan.

## Run count

The successful run count increments only for a fresh confirmed success.

Recovered success, failed, cancelled, unknown and stale runs do not increment it.

The count is retained in history and task snapshots. The current card UI does not expose it as a standalone numeric field, so do not expect a visible “N runs” counter.

## Progress states

### No learned plan

A running task without a usable successful duration has `progressState = unknown`.

The board shows **Learning duration** and uses indeterminate progress.

### Measured

A running task with elapsed time at or below the plan is measured against that plan.

### Overtime

If elapsed time exceeds the plan, the percent is visually clamped to 100%, while the status explains how far the task is **over plan**.

The task remains running; reaching 100% is never treated as completion.

### Completed/failed/cancelled/stale/unknown

After a run ends or becomes uncertain, the progress state reflects the latest terminal outcome rather than pretending the progress bar proves execution completion.

## Progress never moves backwards

The frontend maintains a small local progress clock for smooth updates between backend snapshots.

When reconciling elapsed values, the effective elapsed value is the maximum of:

- previous frontend elapsed;
- backend-reported elapsed;
- locally projected elapsed.

This prevents ordinary refresh timing from making progress appear to go backwards.

A newer backend elapsed value can re-anchor the local clock when needed.

## Duration sample retention

For each history record, Tasks Sidebar keeps at most **20** successful duration samples.

Samples are stored newest first.

The current plan still uses the latest successful duration; the additional samples are retained history, not an averaging algorithm.

## History record retention

Tasks Sidebar retains at most **200** history records.

Retention orders records by their most recent update/completion timestamp, then uses the history key as a deterministic tie-breaker.

Older records beyond the limit are pruned.

## Logical identity vs history identity

Runtime/logical identity and history identity intentionally differ.

### Logical identity

Includes:

- source/provider;
- display name;
- scope/workspace;
- canonical definition.

A rename therefore creates a new logical definition/card identity.

### History identity

Includes:

- source/provider;
- scope/workspace;
- behavior definition;

but strips presentation fields `label` and `taskName`.

Consequences:

- rename only → can retain plan/history;
- command/behavior edit → new history;
- moving to another workspace scope → separate history.

This allows a cosmetic rename to keep useful timing without applying old timing to changed behavior.

## Legacy history migration

Older builds used a different serialized history id.

When reading history, the extension attempts keys in this order:

1. current history id;
2. current logical id;
3. legacy logical id;
4. a legacy key ending with the same scope + legacy definition suffix.

When a newer run updates that record, it is moved toward the current history key and obsolete matching keys are removed.

This migration is internal, but it explains why a plan can survive an extension update.

## Parent and child history

Compound parent and child tasks do not share one merged plan.

Each task definition has its own history identity. A child success updates the child's plan. A parent execution updates the parent's history.

Tasks Sidebar therefore does not claim that a compound parent's total duration is equivalent to the duration of a child run.

See [Compound tasks and dependencies](04-compound-tasks-dependencies.md).

## Persistence keys

The extension stores three categories in VS Code `workspaceState`:

- `tasksSidebar.history`
- `tasksSidebar.lastGoodSnapshots`
- `tasksSidebar.activeObservations`

These are extension metadata. The source of task definitions remains VS Code task configuration/providers.

### History

Stores outcomes, successful durations, last run duration, exit code and retention metadata.

### Last-good snapshots

After a successful discovery/render, non-orphaned task snapshots are cached in an idle form.

The cache removes live-only fields such as:

- execution id;
- current elapsed time;
- stopping state.

If a later discovery fails, the board can show compatible last-good snapshots plus a warning instead of replacing everything with an empty board.

### Active observations

Live non-stale executions that have not received task end are persisted with logical/history identity, workspace URI, name/source and observation time.

They are used during reload reconciliation.

## Reload and rehydration

On activation, the extension inspects `vscode.tasks.taskExecutions`.

Each execution that VS Code still reports is tracked as **recovered**.

A recovered execution:

- is visible as active;
- uses an elapsed basis of **since reload**;
- does not teach the successful-duration plan if it later succeeds.

The original start moment happened before the current monotonic clock baseline, so the extension avoids treating the shorter post-reload duration as a full measured sample.

## Persisted observation reconciliation

After rehydrating currently live VS Code executions, persisted observations are matched by:

- logical task identity;
- workspace-folder URI;
- multiplicity/count.

This one-for-one counting matters for parallel runs.

Example:

```text
Persisted observations before reload: 2 x build
VS Code reports after reload:        1 x build

Result:
- one observation matched to the live execution
- one observation remains pending
```

A pending unmatched observation is allowed a bounded observation window.

If it still does not reappear after the timeout, its history becomes **Unknown** rather than Success/Cancelled.

## Stale execution becomes visible again

An in-memory execution can become Stale when VS Code temporarily stops reporting it.

If the same `TaskExecution` is later reported again and task end was not already seen:

- stale is cleared;
- if no process end was seen, old unconfirmed stop intent is cleared and lifecycle becomes Running;
- if process end was seen, stop intent remains and lifecycle becomes Waiting for task end.

The next Start check reconciles running executions first. Therefore a reappearing execution can become active again before the board accepts a duplicate Start.

## Reload/reconnect examples

### Example A: run survives reload

```text
task running
Developer: Reload Window
VS Code still reports execution
→ task rehydrated as Running
→ elapsed text may say “since reload”
→ recovered success later does not retrain plan
```

### Example B: observation disappears

```text
task running
reload/reconnect
VS Code does not report matching execution
→ persisted observation pending
→ observation window expires
→ history outcome Unknown
```

The connection loss itself is not proof of success or cancellation.

### Example C: stale run reappears

```text
execution temporarily disappears
→ Stale
same execution appears again
→ Running (or Waiting for task end if process-end evidence existed)
→ duplicate Start blocked while active
```

See [Compatibility, remote hosts and reconnects](11-compatibility-remote.md).

## Clock changes

Active monotonic elapsed is clamped against negative values. Frontend progress uses non-regressing reconciliation.

Tasks Sidebar does not promise sub-millisecond accuracy, CPU time, or identical monotonic clock continuity across extension-host reload. After reload it explicitly distinguishes recovered timing.

## Why did my estimate change?

Typical reasons:

- a newer fresh successful run completed → plan becomes that run's duration;
- task behavior changed → history identity changed and a new plan must be learned;
- task was only renamed → history can remain;
- latest run failed/cancelled/unknown/stale → old successful plan remains;
- a recovered run succeeded → old plan remains because recovered timing is not a full measurement;
- old history was pruned after exceeding retention limits.

## Related chapters

- [Execution lifecycle](03-execution-lifecycle.md)
- [Discovery and identity](02-discovery-providers-identities.md)
- [Compound tasks](04-compound-tasks-dependencies.md)
- [Compatibility and reconnect](11-compatibility-remote.md)
- [Troubleshooting](09-troubleshooting.md)
