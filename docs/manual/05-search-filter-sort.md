# Search, filters, sorting and board interaction semantics

The Task Board applies search, filter and sort locally to the latest task snapshots. These controls do not change the underlying VS Code task definitions or stop/start tasks.

## Search

The search field performs a case-insensitive substring search across:

- task name;
- provider/source;
- group;
- workspace-folder name;
- tags assigned in tasks.json.

For example, searching `frontend` can match a task whose name does not contain that text if its workspace folder is named `frontend`.

An empty or whitespace-only query matches all tasks.

> Note: search also checks workspace-folder names and task tags, even when those values are not part of the task's display name.

## Filters

### All tasks

No additional filter beyond the search query.

### Running

Matches snapshots with `isRunning = true`.

This includes lifecycle states represented as live by the board, including:

- Running;
- Stopping;
- Waiting for task end.

### Failed

Matches tasks whose latest outcome is `failed`.

### Completed

Matches tasks whose latest outcome is `success`.

Cancelled, unknown and stale are not counted as Completed.

### Unknown / stale

Matches when either:

- latest outcome is `unknown`;
- latest outcome is `stale`; or
- progress state is `unknown`.

The third condition is broader than the label may suggest. A task that has never produced a successful duration plan can have unknown progress state and therefore appear in this filter even if it has no terminal Unknown/Stale outcome.

### External providers

Matches tasks whose source is not `Workspace`.

This filter does not itself enable external-provider discovery. If `tasksSidebar.includeExternalTasks` is false, external tasks generally are not in the board snapshot to filter.

### Tags

Open **Tags (all required)** and check one or more tags. Each checkbox can be toggled by mouse or with Space when focused. A task must contain **every** selected tag (AND), matched case-insensitively. Selecting `tag1` and `tag2` shows tasks with both, including tasks with additional tags; tasks with just one or no tags are excluded. With no tags selected, all tasks are eligible. Use **Clear tags** to remove the tag restriction.

The tag filter is independent of the status filter and combines with search and sorting. It lists distinct tags from all discovered task snapshots, regardless of the current search/status/tag filters. Tags also appear as badges on their task cards.

The list is refreshed with task discovery. Selections survive task refreshes while those tags remain available. A tag removed from every task is deselected; other selections remain. If all selected tags disappear, there is no tag restriction. Filter selections reset when the webview is recreated.

## Sorting

### Sort: name

Primary ordering is task name, then deterministic tie-breakers.

### Sort: status

Status rank is:

1. live/running;
2. failed;
3. unknown or stale;
4. successful;
5. remaining states such as idle/cancelled.

Within the same rank, deterministic tie-breakers apply.

### Sort: elapsed

Higher elapsed milliseconds sort first.

Idle/completed tasks commonly have zero current elapsed time, so ties then fall back to name/source/id ordering.

### Sort: folder

Workspace-folder name sorts ascending. Tasks without a folder use an empty folder value for comparison, followed by normal tie-breakers.

## Deterministic tie handling

After the selected sort key, Tasks Sidebar uses stable comparison fields:

1. task name;
2. source/provider;
3. logical id;
4. concrete execution id.

This is why same-name tasks do not randomly swap positions merely because a periodic refresh occurred.

## Search + filter + sort together

The operations combine as:

```text
latest task snapshots
   ↓
search query
   ↓
selected filter
   ↓
selected sort + deterministic tie-breakers
   ↓
visible cards
```

Example:

- query: `api`
- filter: Failed
- sort: elapsed

Result: only failed tasks whose searchable fields contain `api`, ordered by descending elapsed value and then stable tie-breakers.

## Parallel executions

Parallel concrete executions can share:

- the same logical task id;
- the same display name/source/folder.

They remain separate snapshots because they have different execution ids.

Search and filters therefore can show more than one card for one logical task when multiple runtime executions are represented.

Tie-breaking by execution id keeps their order deterministic after the other fields match.

## Unknown and stale visibility

Unknown/stale runtime outcomes are intentionally preserved rather than hidden because they represent missing evidence.

Use **Unknown / stale** when investigating:

- missing process-end/exit-code evidence;
- a run that disappeared after reload/reconnect;
- a stop request that was not confirmed;
- a stale execution.

Remember that this filter also includes unknown progress state as described above.

## Empty result sets

There are two distinct empty states.

### Board has no task snapshots

The main empty-state card says the board is ready for its first task and offers:

- Create task;
- Open tasks.json;
- Refresh.

### Tasks exist but current view has no matches

The board shows:

**No matching tasks**

and advises changing search or filters.

This filtered-empty state has `role="status"` so it can be surfaced by assistive technology.

## Reset

The Reset button:

- clears the search query;
- selects **All tasks**;
- selects **Sort: name**;
- rerenders the latest snapshots;
- returns keyboard focus to the search field.

## Refresh effects

A backend refresh can change the set/state of task snapshots, but it does not intentionally clear the current in-memory search/filter/sort controls while the same webview context remains alive.

The webview is created with `retainContextWhenHidden: true`, so hiding and showing the view can preserve its in-memory control state.

However, search/filter/sort are not persisted to `workspaceState` or `vscode.setState`. Recreating/reloading the webview restores defaults.

Backend refresh results are revision-ordered: an older slow refresh cannot overwrite a newer completed refresh.

## Keyboard interaction

The controls are ordinary keyboard-focusable webview controls:

- Tab / Shift+Tab move among search, Reset, Filter, Sort, toolbar and card actions;
- native select controls provide standard keyboard selection behavior;
- Enter/Space activate buttons according to browser/VS Code webview behavior.

When a rerender replaces task cards, Tasks Sidebar records the focused action/card identity and attempts to restore focus in this order:

1. same element id;
2. same action + action id;
3. same action on same logical/execution card;
4. same execution card;
5. same logical task card;
6. board container.

If a lifecycle transition removes or disables the prior action, focus falls back rather than becoming lost.

See [Accessibility, keyboard and themes](10-accessibility.md).

## Multi-root example

Imagine:

- folder `project-alpha` contains task `Zeta sort task`;
- folder `project-zeta` contains task `Alpha sort task`.

**Sort: folder** puts the project-alpha task first even though its task name sorts later alphabetically.

**Sort: name** puts Alpha sort task first.

That distinction is part of the manual release smoke fixture.

## Provider example

If external providers are enabled and both are visible:

```text
Workspace · build
npm       · build
```

Searching `npm` matches the provider field even though both task names are `build`.

The External providers filter keeps the npm card and excludes the Workspace card.

## View state is presentation only

Changing query/filter/sort:

- does not modify `tasks.json`;
- does not change which tasks VS Code provides;
- does not terminate hidden running tasks;
- does not remove history;
- does not change external-provider configuration.

A running task hidden by a filter remains running.

## Related chapters

- [Discovery and providers](02-discovery-providers-identities.md)
- [Execution lifecycle](03-execution-lifecycle.md)
- [Accessibility](10-accessibility.md)
- [Troubleshooting](09-troubleshooting.md)
