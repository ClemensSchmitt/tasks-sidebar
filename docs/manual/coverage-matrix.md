# Tasks Sidebar documentation coverage matrix

Issue: #40  
Parent: #39  
Inventory baseline: main @ 719c903b17743b79121d1370596bba382a5f7d6a  
Inventory date: 2026-10-01

## Purpose

This file is the control sheet for the Tasks Sidebar handbook. It inventories observable behavior from the current implementation and tests before the handbook chapters are written. Code and tests are treated as the primary source of truth; README, CHANGELOG, SUPPORT and manual procedures are compared against them rather than assumed correct.

The compact tables below group the requested fields as follows:

- Feature / entry point = area, concrete behavior and UI/command/automatic entry point.
- Preconditions / normal behavior = prerequisites and expected path.
- States / edge cases = visible or logical states plus important special cases.
- Failure / recovery / persistence = error behavior, retry/fallback and reload/reconnect implications.
- Remote / accessibility = host and accessibility relevance.
- Evidence = implementation and tests.
- Existing docs → target = current documentation plus planned handbook issue.
- Status = completeness of current user documentation, not implementation status.

Status values: Complete, Partial, Missing. A Partial row means the behavior is mentioned but material semantics or edge cases remain undocumented.

## Known contradictions and documentation gaps

| ID | Finding | Evidence | Required resolution |
| --- | --- | --- | --- |
| GAP-01 | README says the latest published release is v0.0.5 and that current main contains unreleased changes not in that VSIX. GitHub Releases contains a published v0.0.6 VSIX, package.json is 0.0.6, and CHANGELOG has a 0.0.6 section. | README.md; package.json; CHANGELOG.md; GitHub release v0.0.6 published 2026-10-01 | #41 must update install/version wording and link to the current release. |
| GAP-02 | Search actually includes workspace-folder name, but the search placeholder and ARIA label say only tasks, sources and groups. | src/extension.ts applyView / search input | #45 and #50 should document actual search dimensions; consider a UI-label follow-up if desired. |
| GAP-03 | Unknown / stale filter is broader than its label: it also matches any snapshot whose progressState is unknown, including an idle task with no learned plan/history. | src/runtime.ts filterAndSortTaskSnapshots; src/extension.ts applyView and calculateProgressState usage | #45 must document exact filter semantics; product wording may merit follow-up. |
| GAP-04 | Create task accepts JSONC when reading but rewrites the file with JSON.stringify. Existing comments, trailing commas and custom formatting are therefore removed when the task is created. | src/extension.ts createTask; src/runtime.ts parseJsonc | #47 must warn users before presenting Create task as formatting-preserving. |
| GAP-05 | The board has no webview button for Toggle external task providers. The feature is exposed by Command Palette and the workspace setting. | package.json; src/extension.ts webview toolbar/message routes | #41/#47 should not imply a board toolbar toggle. |
| GAP-06 | Output and terminal commands are board-level and ignore a task id. There is no per-card output or child-terminal selector. | src/extension.ts openTaskOutput/openTaskTerminal and route cases | #48 must explicitly describe VS Code-owned selection. |
| GAP-07 | Dependency lookup is label-based inside the same workspace-folder URI. If multiple distinct task definitions in one folder share a label, logical task identity remains distinct but the dependency name map can represent only one logical id for that label. | src/extension.ts metadataByScopeAndName; src/runtime.ts identity logic | #42/#44 should document same-name ambiguity and avoid promising deterministic dependency targeting beyond VS Code label semantics. |
| GAP-08 | Runtime execution ids are concrete per extension-host session, but they are not persisted across reload. Reconciliation after reload is by logical identity + workspace and multiplicity, not by the old execution-N id. | src/extension.ts begin/persistActiveObservations; src/runtime.ts reconcilePersistedObservations | #42/#51 must distinguish runtime instance identity from reload reconciliation identity. |
| GAP-09 | Manual accessibility, installed-candidate GUI smoke, WSL, Dev Containers and Remote SSH records are still pending/not run. Automated contracts must not be described as manual certification. | test/manual-accessibility/README.md; test/manual-release/README.md; test/remote-smoke/README.md | #50/#51 must preserve the tested-vs-certified boundary. |

## 1. Task discovery and provider policy

| ID | Feature / entry point | Preconditions / normal behavior | States / edge cases | Failure / recovery / persistence | Remote / accessibility | Source evidence | Test evidence | Existing docs → target | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| DISC-01 | Workspace task discovery; automatic refresh and Tasks: Refresh | Workspace open. Fetch through vscode.tasks.fetchTasks(); default view keeps Workspace tasks scoped to a workspace folder. | Empty workspace, empty tasks list, unnamed tasks are excluded, multi-root folders remain distinct. | Discovery failure falls back to last-good snapshots when available. | Uses workspace host APIs and URI scopes. | package.json; src/extension.ts publish/isWorkspaceJsonTask | integration suite activation/refresh; manual M02 | README Task discovery → #42 | Partial |
| DISC-02 | External providers; Tasks: Toggle external task providers; tasksSidebar.includeExternalTasks | Setting defaults false and is updated at Workspace target. When true, non-Workspace/global provider tasks may be shown. | External filter is source != Workspace. User/extension/npm/other providers are opt-in. No board toolbar toggle. | Setting update failure reports an error. Periodic publish picks up configuration changes. | Provider runs in selected workspace extension host. | package.json; src/extension.ts toggleExternalTasks/publish | runtime external filter; manual M03; remote optional provider step | README Commands/Discovery → #42/#47 | Partial |
| DISC-03 | Provider fallback after aggregate discovery failure | Aggregate fetchTasks throws. Extension retries shell/process plus provider types parsed from each workspace tasks.json. | Recovered tasks are deduplicated by logical task id. A partial provider recovery still produces a warning. | If all fallbacks fail/empty, discovery error path uses last-good state. | Warning includes host label. | src/extension.ts workspaceTaskTypes/fetchTasksWithProviderFallback | runtime provider fallback and discovery categories | README mentions fallback → #42/#49 | Partial |
| DISC-04 | Multi-root discovery and scope | Multiple workspace folders. Scope URI is part of logical identity and folder label/search/sort. | Same names in different roots remain distinct. Removed roots are hidden without hiding surviving roots. | Bad tasks.json in one root does not prevent dependency parsing in other roots; first file warning may dominate UI warning. | URI-based, relevant to remote multi-root. | src/extension.ts taskWorkspaceFolder/loadDependencySpecs; src/runtime.ts isWorkspaceFolderVisible | runtime workspace URI identity/removed roots; manual M10 | README partial → #42/#45/#51 | Partial |
| DISC-05 | No workspace open | No workspace folders and external providers disabled. | Board renders no-workspace warning/empty result. | User is told to open a workspace and retry. | Host label is used in discovery classification path. | src/extension.ts publish/getDiscoveryWarning | runtime discovery category empty-workspace | README indirect → #41/#49 | Missing |
| DISC-06 | Automatic refresh triggers | Extension activation, one-second board publish timer, workspace-folder changes, saved .vscode/tasks.json, explicit refresh. | Older async refresh results are discarded by revision id. | Prevents slow previous discovery from overwriting newer state. | Same behavior local/remote. | src/extension.ts activate/timer/workspaceChanged/publish | runtime refresh revisions are ordered | Not explicitly documented → #42/#49 | Missing |
| DISC-07 | Exact duplicate logical definitions | Multiple fetched tasks resolve to the same canonical logical id. | One card is rendered for duplicate logical definitions; same name with different source/scope/definition remains distinct. | Parallel concrete executions are still rendered separately. | None special. | src/extension.ts seenLogicalIds; src/runtime.ts createLogicalTaskId | identity/key-order tests | README mentions exact dedupe → #42 | Partial |

## 2. Task identity and parallel execution identity

| ID | Feature / entry point | Preconditions / normal behavior | States / edge cases | Failure / recovery / persistence | Remote / accessibility | Source evidence | Test evidence | Existing docs → target | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ID-01 | Logical task identity | Any discovered task. Identity includes source/provider, display name, scope/workspace and canonicalized definition. | Definition key order does not change identity; rename or behavioral definition edit does. | Old live execution may become orphaned when current definition no longer matches. | Workspace URI participates, including remote URI. | src/runtime.ts createLogicalTaskId/serializeDefinition | rename distinct; key order stable; workspace URI identity | README runtime safety → #42 | Partial |
| ID-02 | History identity | Any task with history. Identity includes source, scope and definition with label/taskName presentation fields removed. | Pure rename can retain plan; command/behavior change creates new history. | Legacy key migration finds logical/legacy/suffix keys and moves record to current history id. | Scope/URI keeps roots separate. | src/runtime.ts createHistoryTaskId/selectHistoryKey | history rename/change; migration tests | README history identity → #42/#46 | Partial |
| ID-03 | Concrete runtime identity | Every vscode.TaskExecution observed. Gets execution-N inside current extension-host session. | Multiple executions of same logical task can coexist when started externally; each has its own card/stop control. | Runtime id is not persisted across reload; persisted reconciliation matches by logical id + workspace + count. | Remote host restart/reconnect can assign new runtime ids. | src/extension.ts begin/executionIds/running | reload matches parallel observations one-by-one | README mentions runtime id but not session lifetime → #42/#51 | Partial |
| ID-04 | Orphaned execution | Task renamed/definition changed while an old execution remains active. | Old execution is still displayed from running map with Orphaned marker even if no current discovered definition represents it. | It can become stale/end independently; last-good cache excludes orphaned snapshots. | Same on remote if task file edited there. | src/extension.ts publish orphan handling/toSnapshot | logical rename/orphan identity test | README mentions orphaning → #42/#43 | Partial |
| ID-05 | Same display name across tasks/providers | Tasks share name but differ in source, folder or definition. | Cards remain distinct; stable sort tie-breaks by source/id/execution id. | Dependency label lookup within a folder is more limited than logical identity; see GAP-07. | Folder/source available to accessible task label. | src/runtime.ts identity/filter sort; src/extension.ts metadata map | query/sort tie-breaker test | README partial → #42/#44 | Partial |

## 3. Lifecycle, outcomes and event ordering

| ID | Feature / entry point | Preconditions / normal behavior | States / edge cases | Failure / recovery / persistence | Remote / accessibility | Source evidence | Test evidence | Existing docs → target | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| LIFE-01 | Idle / ready | Discovered task with no active execution. | No history shows No run history yet and Plan will be learned; prior success shows last successful duration. | Idle state can retain history across reload. | Card exposes accessible actions. | src/extension.ts toSnapshot/runtimeStatus/plannedText | progress-state tests | README features → #43/#46 | Partial |
| LIFE-02 | Running | Start event or executeTask result creates active execution. | Background adds Watch prefix; recovered execution says since reload. Running filter includes running, stopping and awaiting-task-end because all are isRunning. | Missing execution schedules bounded stale check except normal background/watch task. | State announced after initial snapshot; host-neutral. | src/extension.ts begin/toSnapshot/runtimeStatus | background timeout; reload tests | README runtime safety → #43 | Partial |
| LIFE-03 | Success | Task end and process-end evidence with exit code 0. | Event arrival order does not matter. Visible card uses completed styling/check glyph and last successful duration; transition announcement says Completed successfully. | Fresh measured success updates plan/run count/history. Rehydrated success does not update plan. | ARIA state transition announcement. | src/runtime.ts resolveTaskOutcome; src/extension.ts finish | exit 0; event-order reducer; fresh success plan | README → #43/#46 | Partial |
| LIFE-04 | Failed | Process end with non-zero exit code. | Visible Failed with exit code when known. Previous successful plan is retained. | Failure remains in history but never changes planned duration. | Failure is text/glyph, not color only. | src/runtime.ts resolveTaskOutcome; src/extension.ts runtimeStatus/finish | non-zero failure; plan exclusion | README → #43/#46 | Partial |
| LIFE-05 | Unknown outcome | Missing exit code, task end without process end, or persisted observation disappearing after grace. | Never promoted to success. Unknown/stale filter also includes progressState unknown; see GAP-03. | Stored as unknown; recovered/discovery loss is conservative. | Text says Unknown outcome. | src/runtime.ts resolveTaskOutcome/reconcilePersistedObservations | missing exit; task-end without process-end; reload unknown | README mentions unknown → #43/#51 | Partial |
| LIFE-06 | Stop requested / stopping | User selects Stop on a live running execution. | stopRequested true and lifecycle stopping. Repeat stop is effectively no-op; UI disables Stop. | terminate rejection/failure returns to running/awaiting state and reports error; 10s stop timeout can mark stale. | Disabled stop has explicit aria-label. | src/extension.ts stop/terminationFailed | reducer stop/stale conservatism | README safe stop → #43 | Partial |
| LIFE-07 | Awaiting task end | Process-end arrives before task-end and no confirmed stop owns outcome. | UI says Process ended · waiting for task end; Stop button disabled. | If task-end never arrives, timeout can produce stale. Restart can be queued until finish. | Text/ARIA exposes waiting state. | src/runtime.ts applyTaskExecutionEvent; src/extension.ts processEnded/restart | event order tests | README names waiting state but not all semantics → #43 | Partial |
| LIFE-08 | Cancelled | Stop requested plus task end confirms termination. | Exit code 0 after requested stop is still cancelled, not success. | Cancelled run gets lastRunDurationMs but does not change plan. | Text/glyph and announcement. | src/runtime.ts resolveTaskOutcome; src/extension.ts finish | confirmed stopped cancelled | README → #43/#46 | Partial |
| LIFE-09 | Stale | End evidence is lost or a requested stop is not confirmed before timeout. | Stale active execution remains represented; stop is no longer claimed successful. | Can recover if VS Code reports same execution again before taskEnd; otherwise remains conservative. | Text says no longer observable / no end event. | src/extension.ts markStale/reconcileRunningExecutions; src/runtime.ts reducer | lost end stale; stale re-observed | README → #43/#51 | Partial |
| LIFE-10 | Background/watch task | task.isBackground true. | No stale timer merely for long elapsed time; planned display says Runs continuously while running. | Stop or disappearance can still schedule stale detection. | Indeterminate/measured progress remains accessible. | src/runtime.ts shouldScheduleStaleCheck; src/extension.ts plannedText | background timeout test; manual M07 | README → #43/#46 | Partial |
| LIFE-11 | Process-end/task-end ordering | Either VS Code event can arrive first. | Reducer converges; success/failure waits for available evidence and bounded grace. | Task-end without process evidence becomes unknown after grace, not success. | No special remote assumption. | src/runtime.ts applyTaskExecutionEvent/shouldFinalizeTask | event ordering/finalization tests | Barely documented → #43 | Missing |

## 4. Start, stop and restart workflows

| ID | Feature / entry point | Preconditions / normal behavior | States / edge cases | Failure / recovery / persistence | Remote / accessibility | Source evidence | Test evidence | Existing docs → target | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| RUN-01 | Run task card action | Idle logical task. Finds current task by logical id and calls executeTask. | Concurrent starting flag or any non-stale live execution blocks a duplicate start with information message. | Discovery/read errors, vanished task and executeTask errors each have distinct user messages. | Uses current extension host task API. | src/extension.ts run/findTask | duplicate starts test | README basic run only → #43 | Partial |
| RUN-02 | Stop task card action | Concrete execution id is live/running. | Stop targets one concrete execution; parallel sibling execution is untouched. | terminate sync/async failures restore conservative state; timeout -> stale. | Same for remote TaskExecution. | src/extension.ts stop | manual M05/M06; reducer tests | README partial → #43 | Partial |
| RUN-03 | Restart live task | Running execution. Restart means stop-then-start; restartRequested is retained until old run finishes. | If already stopping, user is told it is already stopping rather than issuing another termination. | Stop failure clears restart request. Stale timeout can trigger new run. | Task name included in button ARIA label. | src/extension.ts restart/finish/markStale | manual M05 | README says stop-then-start → #43 | Partial |
| RUN-04 | Restart awaiting task end | Process ended but task-end event pending. | Restart request is queued; no new execution starts until finish removes old run. | Prevents overlap caused by early process-end. | Same host semantics. | src/extension.ts restart | reducer/event-order tests support state | Not explicit → #43 | Missing |
| RUN-05 | Restart stale task | Stale active execution. | Stale is excluded from live-start blocking; restart starts a new execution while stale record may remain visible. | If the stale execution becomes observable again before new Start is accepted, reconcile restores active state and blocks duplicate start. | Important after remote reconnect. | src/extension.ts restart/reconcileRunningExecutions | stale re-observed test | README mentions stale restart → #43/#51 | Partial |
| RUN-06 | Restart idle/failed/cancelled/unknown completed task | No active matching execution. | Falls through to normal Run. | Uses current definition; renamed old execution is not silently reused. | Same local/remote. | src/extension.ts restart | identity tests | Not explicit → #43 | Missing |
| RUN-07 | Multiple stop/restart requests | User clicks repeatedly or stale messages arrive. | UI disables stop in stopping/awaiting states; backend stop only acts for running + not stopRequested. | Invalid/stale ids are ignored by stop method or rejected earlier in webview routing. | Focus restoration avoids jumping during action changes. | src/extension.ts stop/render | integration action/invalid message cases | Not documented → #43/#50 | Missing |

## 5. Dependencies and compound tasks

| ID | Feature / entry point | Preconditions / normal behavior | States / edge cases | Failure / recovery / persistence | Remote / accessibility | Source evidence | Test evidence | Existing docs → target | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| DEP-01 | dependsOn parsing | Workspace tasks.json is readable JSONC. String or string-array dependsOn accepted; default order parallel, explicit sequence supported. | Invalid task documents or non-string dependencies are ignored by parser. | Bad root does not hide dependency specs from other roots. | URI-specific per workspace folder. | src/runtime.ts parseTaskDependencySpecs; src/extension.ts loadDependencySpecs | dependency normalization/invalid document tests | README high-level → #44 | Partial |
| DEP-02 | Sequential dependency state | Parent has dependsOrder sequence. | Evaluate dependency labels in declared order: running blocks later evaluation; failure/cancel/unknown/unresolved stops sequence; all successful -> success. | Missing child -> unresolved with failure label. | Text dependency label appears in card status. | src/runtime.ts resolveDependencyState | sequence dependencies resolve in order | README → #44 | Partial |
| DEP-03 | Parallel dependency aggregation | Parent has default/all/parallel order. | Failure takes precedence, then cancellation, unknown, unresolved/missing, running, all-success. A running child supersedes its own historical failure. | Missing id/child remains unresolved. | Accessible card status includes dependency note. | src/runtime.ts resolveDependencyState | aggregation; running child supersedes failure | README partial → #44 | Partial |
| DEP-04 | Parent/child card relationship | VS Code exposes parent and child tasks/executions. | dependencyIds identify discovered children; child cards get Child marker; parent shows Depends on names and dependency state. Parent and child histories remain separate. | Missing/out-of-order child observations are unresolved/unknown, never fabricated success. | Same on remote host. | src/extension.ts applyDependencyState/toSnapshot | dependency tests; manual M08 | README runtime safety → #44 | Partial |
| DEP-05 | Stopping a parent | Parent execution selected. | Only selected parent TaskExecution is terminated. Children are not implicitly terminated by extension. | VS Code remains owner of compound orchestration. | Output/terminal child selection also remains VS Code-owned. | src/extension.ts stop/openTaskOutput/openTaskTerminal | manual M08/M09 procedural coverage | README explicitly mentions → #44/#48 | Partial |
| DEP-06 | Same-name dependency ambiguity | More than one distinct logical task in same folder has same display label. | Logical cards remain distinct, but dependency lookup map is keyed scope+name and therefore resolves one metadata entry for the label. | Must be documented as a limitation/VS Code label-semantic boundary rather than claiming stronger targeting. | None special. | src/extension.ts metadataByScopeAndName | identity tests do not cover this ambiguity directly | Missing → #42/#44 | Missing |
| DEP-07 | Cross-root / missing dependency | Dependency label does not resolve to a task in the same folder metadata map. | Parent dependency state unresolved; no implicit cross-root match. | Warning is state text, not a separate discovery error. | Multi-root/remote URI relevant. | src/extension.ts taskScopeNameKey; src/runtime.ts resolveDependencyState | out-of-order/missing child test | Missing → #44 | Missing |

## 6. Search, filters, sorting and view state

| ID | Feature / entry point | Preconditions / normal behavior | States / edge cases | Failure / recovery / persistence | Remote / accessibility | Source evidence | Test evidence | Existing docs → target | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| VIEW-01 | Search input | Task board loaded. Case-insensitive substring across name, source/provider, group and workspace folder. | Empty/whitespace query matches all. UI placeholder/ARIA omits folder despite implementation. | Search state exists only in webview memory; reload/recreate resets it. | Search has aria-label and keyboard focus. | src/runtime.ts filterAndSortTaskSnapshots; src/extension.ts applyView | search provider/group/folder test | README lists all dimensions → #45/#50 | Partial |
| VIEW-02 | Filters: All, Running, Failed, Completed, Unknown/stale, External providers | Select dropdown. | Running uses isRunning, so includes stopping/awaiting. Completed means success only. Unknown also matches progressState unknown, including no-plan idle tasks. External means source != Workspace. | Filter state not persisted across reload. | Native select with aria-label. | src/runtime.ts TaskBoardFilter; src/extension.ts filter markup/applyView | query/filter test; manual M10 | README names filters but not exact semantics → #45 | Partial |
| VIEW-03 | Sort: name/status/elapsed/folder | Select dropdown. | Status rank: live first, then failed, unknown/stale, success, then cancelled/idle/other. Elapsed is descending. Folder ascending. | Deterministic tie-breaks by name, source, id, execution id. | Native select with aria-label. | src/runtime.ts filterAndSortTaskSnapshots; src/extension.ts applyView | stable tie-breaker test; manual M10 | README names sorts → #45 | Partial |
| VIEW-04 | Reset view | Reset button. | Clears search, sets All + name sort, rerenders, returns focus to search. | No persisted view state remains. | Explicit aria-label. | src/extension.ts resetView listener | integration control presence | Not described → #45/#50 | Missing |
| VIEW-05 | Filtered empty state | Tasks exist but query/filter produces no matches. | Shows No matching tasks status; distinct from no-task empty state. | Changing query/filter restores cards. | role=status; focus restored. | src/extension.ts render | manual M10; integration HTML contract indirect | Not described → #45/#50 | Missing |
| VIEW-06 | Webview state lifetime | View hidden/revealed with retainContextWhenHidden. | Search/filter/sort/progress clocks survive while same webview context is retained, but no vscode.setState/workspaceState persistence exists for these controls. | Window/webview recreation resets defaults. | Focus bookmark is in-memory only. | src/extension.ts registerWebviewViewProvider/createTaskBoardHtml | integration focus contracts | Missing → #45/#51 | Missing |

## 7. Runtime, elapsed time, progress and history

| ID | Feature / entry point | Preconditions / normal behavior | States / edge cases | Failure / recovery / persistence | Remote / accessibility | Source evidence | Test evidence | Existing docs → target | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| HIST-01 | Elapsed runtime | Active execution. Uses performance.now when available; clamps negative values. | Suspend/resume counts elapsed monotonic host time by policy. Recovered task clock starts at reload and is labelled since reload. | Wall-clock shifts cannot create negative active elapsed values. | Works in whichever host extension runs. | src/extension.ts monotonicNow/toSnapshot; src/runtime.ts calculateElapsedMs | monotonic clamp; sleep/resume tests | README → #46 | Partial |
| HIST-02 | Progress plan | History has a successful measured duration. | Plan is the latest successful duration, not an average. If absent: Learning duration / Plan will be learned. | Recovered success is excluded from plan updates. | Planned text is in accessible card label. | src/runtime.ts calculatePlanDuration/shouldCountSuccessfulRun | plan latest success; fresh success only | README → #46 | Partial |
| HIST-03 | Outcomes that do not change plan | Failed, cancelled, unknown, stale and recovered-success runs. | They may update last outcome/run duration but leave lastDurationMs from last good success. | Prevents bad/incomplete observations from poisoning future plan. | Status text communicates outcome. | src/extension.ts finish; src/runtime.ts shouldCountSuccessfulRun | plan exclusion test | README → #46 | Partial |
| HIST-04 | Runtime sample retention | Successful fresh runs. | durationsMs newest-first, max 20 samples; current plan still uses latest success. | Stored in workspaceState history. | None special. | src/extension.ts MAX_HISTORY_ENTRIES/finish | plan/retention tests | README states 20 → #46 | Partial |
| HIST-05 | History-record retention | History across many task identities. | Max 200 records selected by lastUpdatedAt/lastCompletedAt with stable key tie-break. | Pruned on construction and updates; prune-save failures reported. | Scope-aware identities. | src/extension.ts MAX_HISTORY_RECORDS/pruneHistory | selectRecentHistoryKeys test | README states 200 → #46 | Partial |
| HIST-06 | Measured progress | Running with a plan. | Percent clamps 0..100; >plan becomes overtime while bar remains 100% and status reports time over plan. | Frontend local clock converges without moving backwards. | aria-valuenow + aria-valuetext update. | src/runtime.ts calculateProgressPercent/State/mergeProgressElapsed; src/extension.ts update/animate | monotonic/progress convergence tests | README high-level → #46/#50 | Partial |
| HIST-07 | Indeterminate progress | Running with no valid plan. | progressState unknown; bar visually indeterminate and omits aria-valuenow while keeping aria-valuetext. | Reduced motion stops decorative flow without removing status text. | Explicit ARIA indeterminate semantics. | src/extension.ts render/updateTaskCards | integration ARIA/reduced-motion contracts | README mentions accessibility generally → #46/#50 | Partial |
| HIST-08 | Success run count | Fresh confirmed success only increments runCount. | Failure/cancel/unknown/stale/recovered success do not increment. runCount is in snapshot/render signature but not currently shown as an explicit numeric card field. | Persisted with history. | Not directly announced. | src/extension.ts finish/toSnapshot | fresh success-only test | History wording may imply more UI than exists → #46 | Missing |
| HIST-09 | Legacy history migration | Existing pre-separation history ids. | Current history id preferred, then logical, legacy, then matching legacy suffix. | Selected record is moved toward current history key during finish/stale reconciliation. | Workspace scope retained. | src/runtime.ts selectHistoryKey; src/extension.ts findHistoryRecord | legacy migration tests | Not documented → #46 | Missing |

## 8. Persistence, reload and reconnect

| ID | Feature / entry point | Preconditions / normal behavior | States / edge cases | Failure / recovery / persistence | Remote / accessibility | Source evidence | Test evidence | Existing docs → target | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| PERS-01 | workspaceState persistence keys | Extension active. Stores tasksSidebar.history, tasksSidebar.lastGoodSnapshots, tasksSidebar.activeObservations. | Invalid broad shapes are normalized only at top level (object/array checks); individual snapshot validation is webview-side for messages. | workspaceState update failures show errors. | Per workspace/host state. | src/extension.ts constants/constructor | indirect runtime persistence tests | README architecture mentions keys only in handoff, not user docs → #46/#51 | Missing |
| PERS-02 | Rehydrate currently reported executions | Extension host reload/start. Iterates vscode.tasks.taskExecutions and begins each as recovered. | Recovered elapsed basis is since-reload; recovered success does not train plan. | Active observations are reconciled afterward. | Core reconnect behavior for remote host. | src/extension.ts rehydrateRunningTasks/begin | reload still-live observation test | README → #51 | Partial |
| PERS-03 | Persisted observation missing after reload | Persisted active observation not matched by current live execution. | Remains pending until 10s observation timeout, then recorded unknown. Parallel observations are consumed one-for-one by live matches. | Unknown is persisted; never inferred success/cancel. | Remote disconnect/reconnect relevant. | src/extension.ts reconcilePersistedObservations; src/runtime.ts same | reload grace/pending/parallel tests | README → #51 | Partial |
| PERS-04 | Stale execution reported live again | Existing stale ActiveTask is found again in vscode.tasks.taskExecutions. | If no process-end evidence, old stop request is cleared and lifecycle returns running. If process end was seen, lifecycle becomes awaiting-task-end and stop intent is retained. | New Start remains blocked once active state is restored. | Explicit remote reconnect case. | src/extension.ts reconcileRunningExecutions; src/runtime.ts execution-observed reducer | two stale re-observation tests | README detailed → #51 | Partial |
| PERS-05 | Start blocking after reload/reconnect | VS Code still reports live execution. | hasActiveLogicalTask excludes stale only; re-observed stale becomes active before run check. | Avoids duplicate start on temporarily lost/recovered task. | Important remote. | src/extension.ts run/reconcileRunningExecutions | stale re-observed + duplicate start tests | README → #51/#43 | Partial |
| PERS-06 | Last-good snapshots | Successful discovery/publish. Non-orphaned snapshots cached as idle state. | Cache can include latest outcome/plan but strips active execution fields. On discovery failure, cache is filtered for current roots/provider policy. | Warning appears while useful previous tasks remain visible. | Host-labelled warnings; remote folder filtering. | src/extension.ts publish catch/cache | integration warning preservation; discovery tests | README mentions last valid task list → #49/#51 | Partial |
| PERS-07 | Workspace-folder removal | Multi-root folder removed. | Tasks/observations from removed folder are hidden; another root remains visible. | History is not globally destroyed by folder removal. | URI identity relevant remote/local. | src/runtime.ts isWorkspaceFolderVisible; src/extension.ts workspaceChanged | removed root test | Missing detail → #42/#51 | Missing |
| PERS-08 | View-state persistence boundary | Query/filter/sort/focus/progress clocks. | Not stored in workspaceState; only retained in active webview context. | Reload resets board controls even when task/history state persists. | Focus semantics restart from defaults. | src/extension.ts webview locals | integration focus contract | Missing → #45/#51 | Missing |

## 9. Task Board UI and visible actions

| ID | Feature / entry point | Preconditions / normal behavior | States / edge cases | Failure / recovery / persistence | Remote / accessibility | Source evidence | Test evidence | Existing docs → target | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| UI-01 | Activity Bar container Tasks / Task board webview | Extension activation event onView:tasksSidebar.view. | Webview scripts enabled, context retained when hidden. | Unsupported VS Code stops activation before board registration behavior. | extensionKind workspace controls host placement. | package.json; src/extension.ts activate/resolveWebviewView | installed VSIX suite opens workbench.view.extension.tasksSidebar | README → #41 | Partial |
| UI-02 | Header metadata | Board header shows Tasks, extension version and Local extension host or Remote · remoteName. | Values are HTML-escaped. | Host label also appears in many diagnostics. | Host identity is visible/accessibly rendered text. | src/extension.ts hostLabel/createTaskBoardHtml | integration escaped version/host contract | README → #41/#51 | Partial |
| UI-03 | Board toolbar | Refresh, Open VS Code task output, Focus active task terminal, Create task, Open tasks.json. | No external-provider toggle in toolbar. Output/terminal are board-level. | Action failures report sidebar error. | Each button has title + aria-label. | src/extension.ts HTML + handleWebviewMessage | integration control/action routing | README lists functions but not exact toolbar → #41/#48 | Partial |
| UI-04 | Board controls | Search, Reset, Filter, Sort. | View controls operate locally; reset restores default. | Filtered no-match differs from global empty state. | Native input/select/button labels and focus. | src/extension.ts HTML/listeners | integration controls + runtime filter tests | README high-level → #41/#45 | Partial |
| UI-05 | Task card metadata | Name, source/provider, group, optional folder, dependency/child marker, execution id, orphaned marker, runtime status and plan. | Long text visually ellipsizes but title + accessible name retain complete strings. | Re-render signature avoids destructive redraw when only time changes. | Card has comprehensive aria-label. | src/extension.ts render/accessibility helpers | integration HTML contracts; manual A05 | README partial → #41/#50 | Partial |
| UI-06 | Task-card Run/Stop/Restart/Edit actions | Run when not isRunning; Stop when running except stopping/awaiting; Restart when running or any lastOutcome; Edit only Workspace source. | Stale is not isRunning but lastOutcome stale, so Run and Restart can both conceptually be available through rendered logic; restart path has stale semantics. | Focus restoration searches action/id, logical task, execution, card, then board. | Buttons name the task. | src/extension.ts availableActionsText/render | integration action contracts; manual A01/A02 | README basic actions → #41/#43/#50 | Partial |
| UI-07 | Loading state | View created before first valid render. | Shows Loading tasks… and .vscode/tasks.json guidance. | Replaced by first render. | main is aria-busy until render. | src/extension.ts HTML | integration HTML generation | Not documented → #41 | Missing |
| UI-08 | No-task empty state | Render receives zero snapshots. | CTA buttons Create task, Open tasks.json, Refresh; hint says external providers opt-in. | Same template for no tasks after valid render; warning may appear above. | Semantic h2/buttons; focus restoration. | src/extension.ts render empty | manual M02/A04 | README getting started only → #41/#50 | Partial |
| UI-09 | Warning/Retry region | Discovery/file/provider warning exists. | role=alert, one Retry button; identical warning is not recreated. | Retry triggers refresh. If retry button had focus when warning changes/clears, focus is preserved or moved to board. | Explicit alert + accessible Retry. | src/extension.ts renderWarning/clearWarning | integration warning preservation; manual A02/A04 | README mentions Retry → #49/#50 | Partial |
| UI-10 | State-change announcements | After initial snapshot, lifecycle/outcome changes. | Running/stopping/finishing/success/failure/cancel/stale/unknown/ready announced once per state change, not on every timer tick. | Removed tasks disappear from announcement map. | polite aria-live announcer; list itself aria-live off. | src/extension.ts announceStateChanges | integration aria-live contracts; manual A03 | Missing detail → #50 | Missing |

## 10. Output and terminal behavior

| ID | Feature / entry point | Preconditions / normal behavior | States / edge cases | Failure / recovery / persistence | Remote / accessibility | Source evidence | Test evidence | Existing docs → target | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| OUT-01 | Open VS Code task output | Board toolbar. Calls workbench.action.tasks.openOutput and ignores optional id. | VS Code chooses the selected/available task output; no card-specific target. | Failure tells user to inspect Output or Terminal panel. | VS Code host owns output surface. | src/extension.ts openTaskOutput | integration route case; manual M09 | README explicitly notes delegation → #48 | Partial |
| OUT-02 | Focus active task terminal | Board toolbar. Calls workbench.action.terminal.focus and ignores optional id. | Focuses VS Code active terminal, not guaranteed selected card/child. Process task may have no focusable terminal. | Failure reported. | Remote terminal belongs to VS Code host. | src/extension.ts openTaskTerminal | integration route case; manual M09 | README explicitly notes limitation → #48 | Partial |
| OUT-03 | Compound/child terminal selection | Compound task or multiple child terminals. | Extension provides no child-terminal picker or mapping. | User relies on VS Code terminal/output selection. | Same remote/local. | src/extension.ts no per-card route; README | manual M09 only procedural | README strong statement → #48 | Partial |

## 11. tasks.json open/edit/create behavior

| ID | Feature / entry point | Preconditions / normal behavior | States / edge cases | Failure / recovery / persistence | Remote / accessibility | Source evidence | Test evidence | Existing docs → target | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TASKS-01 | Tasks: Open tasks.json / toolbar Edit | One workspace folder or user chooses folder in multi-root. | If file missing, create .vscode directory and minimal version 2.0.0/tasks [] file, then open editor. | File/stat/create/open/show errors identify operation. | Uses vscode.workspace.fs and URI APIs, so remote filesystem is used. | src/extension.ts openTasksJson | integration command opens expected file; remote step 7 | README basic → #47/#51 | Partial |
| TASKS-02 | Card Edit task definition | Workspace-source task card. | Resolves task again, then opens the owning workspace folder tasks.json. External task produces warning and no edit. | Vanished task warns to refresh. | Multi-root/remote folder aware. | src/extension.ts openTasksJson(id) | integration edit route | Not fully described → #47 | Partial |
| TASKS-03 | Create task | Toolbar/empty-state Create; choose root if multi-root; prompt for nonblank label and shell command. | Appends {label,type:shell,command}; defaults version if absent; opens resulting file and refreshes. | Canceling quick pick/input aborts. File/JSON errors reported. | VS Code input UI; remote workspace.fs writes remote file. | src/extension.ts createTask | integration create route; manual M02 | README says simple shell task → #47 | Partial |
| TASKS-04 | JSONC input support | Existing tasks.json has // or block comments/trailing commas. | Parser accepts JSONC and preserves string contents while parsing. | Invalid JSON throws in Create task path and provider/dependency fallback returns empty/ignored as designed. | Same URI behavior remote/local. | src/runtime.ts parseJsonc | JSONC comments/trailing commas/string tests | README does not explain parser behavior → #47 | Missing |
| TASKS-05 | Create task serialization side effect | Existing JSONC is valid and Create task writes it. | Parsed object is serialized with JSON.stringify: comments/trailing commas/original formatting are lost. Other parsed properties survive structurally. | User must use source control/editor undo to recover formatting/comments; no extension-preserved comment model exists. | Same remote/local. | src/extension.ts createTask | Derived directly from implementation; no explicit regression test | Missing → #47 | Missing |
| TASKS-06 | Existing file without tasks array | tasks.json parses but top-level tasks is absent/not array. | Create task rejects with explicit internal error rather than inventing array. | reportError says check permissions and JSON syntax, even though structural schema can also be cause. | Same remote/local. | src/extension.ts createTask | invalid dependency/parser tests adjacent, no direct create integration case | Missing → #47/#49 | Missing |
| TASKS-07 | Invalid/malformed tasks.json | VS Code diagnostics report errors or read fails. | Board warning identifies folder + error count when diagnostics available; malformed task is not claimed successful. | Retry and last-good behavior; reopen valid workspace recovers. | Host label/folder shown; remote file errors possible. | src/extension.ts getTasksJsonWarning/publish | manual M12; runtime invalid JSON paths | README general errors → #47/#49 | Partial |
| TASKS-08 | Save-driven refresh | Any saved document whose normalized URI path ends .vscode/tasks.json. | Refresh happens automatically; task rename/definition edits can orphan an active execution. | Async revision ordering prevents old refresh winning. | URI path supports remote document save. | src/extension.ts onDidSaveTextDocument | identity + refresh revision tests | Missing → #42/#47 | Missing |

## 12. Error handling and recovery

| ID | Feature / entry point | Preconditions / normal behavior | States / edge cases | Failure / recovery / persistence | Remote / accessibility | Source evidence | Test evidence | Existing docs → target | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ERR-01 | Discovery error taxonomy | No workspace, invalid JSON/diagnostics, permissions, provider failure or unknown. | Runtime helper distinguishes categories; extension currently directly detects no-workspace/provider and file diagnostics/permissions. | Warnings offer Retry and preserve last-good list where possible. | Host/folder included in warning. | src/runtime.ts classifyDiscoveryFailure; src/extension.ts getDiscoveryWarning/getTasksJsonWarning | discovery categories test | README summary → #49 | Partial |
| ERR-02 | Aggregate provider failure with partial recovery | fetchTasks fails but per-type fallback returns tasks. | Recovered tasks remain visible with warning. | User can Retry after checking connection/providers. | Warning mentions current host. | src/extension.ts fetchTasksWithProviderFallback/publish | provider fallback test | README → #49 | Partial |
| ERR-03 | File permission/read/diagnostic error | tasks.json stat/read/diagnostics. | First affected folder warning is shown. | Retry; last-good task list remains when discovery path fails. | Remote URI/file permissions relevant. | src/extension.ts getTasksJsonWarning | manual M12/remote step 7 | README general → #49/#51 | Partial |
| ERR-04 | Start/read failures | Run action. | Already running info; fetch failure error; missing task warning; executeTask error includes message. | starting set is cleaned before return. | VS Code host determines underlying error. | src/extension.ts run | webview route failure test exercises reported errors, runtime duplicate-start test | Missing detailed matrix → #49 | Missing |
| ERR-05 | Stop failure | terminate throws or thenable rejects. | Sync throw reverts state; async failure passes through terminationFailed reducer. | restart intent cleared; error displayed; board republished. | Host-specific termination behavior possible. | src/extension.ts stop/terminationFailed | reducer termination event logic indirect | Missing → #43/#49 | Missing |
| ERR-06 | Persistence failures | workspaceState history/lastGood/active observation writes reject. | Operation remains in-memory; error is surfaced instead of silent data loss. | Future persistence may recover on later update. | Host label in reportError. | src/extension.ts constructor/persist/finish/markStale/publish | No direct failure injection test | Missing → #49/#51 | Missing |
| ERR-07 | Malformed incoming webview action | Missing/invalid command/id or unsupported action. | Invalid command -> invalid action; missing required id -> selected task unavailable; unsupported command -> unsupported action. | reportError wraps as sidebar action could not be completed. | Prevents malformed UI data from silently mutating state. | src/extension.ts handleWebviewMessage | integration malformed action cases | Missing → #49 | Missing |
| ERR-08 | Malformed backend render message inside webview | Non-render, missing/non-array snapshots or invalid snapshot object. | Message is ignored; existing rendered tasks and warning are preserved. | Next valid render can update/clear both. | Avoids destructive accessibility/UI reset. | src/extension.ts isTaskSnapshot/message listener | integration malformed render cases | Missing → #49/#50 | Missing |
| ERR-09 | Webview postMessage failure | Backend tries to render and postMessage rejects. | Pending snapshots remain on provider object. | Error reports Tasks Sidebar could not be updated. | Host label in reportError. | src/extension.ts TaskBoardView.render | No explicit rejection test | Missing → #49 | Missing |
| ERR-10 | Refresh race | Two async publishes overlap. | Only current refreshRevision may render/update cache. | Stale result discarded. | Relevant on slow remote provider/filesystem. | src/runtime.ts isCurrentRefresh; src/extension.ts publish | refresh revisions test | Missing → #49/#51 | Missing |

## 13. Accessibility, keyboard, themes and motion

| ID | Feature / entry point | Preconditions / normal behavior | States / edge cases | Failure / recovery / persistence | Remote / accessibility | Source evidence | Test evidence | Existing docs → target | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A11Y-01 | Keyboard reachability/focus styles | Webview controls/cards. | Buttons/input/selects have focus-visible styling; cards/list can receive fallback focus. | Focus bookmark restores same action, execution/card, or board after rerender. | Automated HTML contracts; manual A01/A02 pending. | src/extension.ts CSS/captureListFocus/restoreListFocus | integration focus contracts; manual A01/A02 pending | README high-level → #50 | Partial |
| A11Y-02 | Accessible names | Toolbar/task actions/card. | Task accessible label includes name, source, group, folder, status, plan, available actions. Long visually clipped text remains in title/accessible text. | No color-only dependency for primary state meaning. | Manual A05 pending. | src/extension.ts accessibleTaskLabel/render | integration label contracts; manual A05 pending | README high-level → #50 | Partial |
| A11Y-03 | Live announcements | State changes after initial snapshot. | aria-live polite announcer; list aria-live off; no repeated one-second announcement when lifecycle/outcome unchanged. | Initial load intentionally not announced as state transition spam. | Manual A03 pending. | src/extension.ts announcer/announceStateChanges | integration aria-live; manual A03 pending | Missing detail → #50 | Missing |
| A11Y-04 | Progress ARIA | Every progress bar. | min/max always; determinate has aria-valuenow; indeterminate removes value-now and uses status aria-valuetext. | Overtime/status updates aria text. | Automated contract only; manual assistive-tech validation pending. | src/extension.ts render/updateTaskCards/animateProgress | integration aria-valuetext; manual A03 pending | README partial → #50 | Partial |
| A11Y-05 | Reduced motion | OS/browser prefers-reduced-motion. | CSS animations/transitions disabled; JS animation frame is cancelled/resumed when preference changes. | State/time text still updates. | Manual A07 pending. | src/extension.ts CSS/reducedMotion listener | integration reduced-motion contract; manual A07 pending | README → #50 | Partial |
| A11Y-06 | Forced colors/theme tokens | VS Code themes / forced colors. | Uses VS Code semantic tokens/fallbacks; forced colors replaces backgrounds/borders/focus/progress with system colors. | Contrast ratios are not automatically measured. | Manual Dark+/Light+/HC/HC Light + OS contrast A06 pending. | src/extension.ts CSS | integration tokens/forced-colors; manual A06 pending | README correctly marks manual gap → #50 | Partial |
| A11Y-07 | English-only language | Any display language. | Document lang=en; UI strings remain English. | No localization fallback/mixed translation. | Manual German display-language A08 pending. | src/extension.ts html lang; static strings | integration lang contract; manual A08 pending | README → #50 | Partial |
| A11Y-08 | Manual verification boundary | Accessibility claims. | No completed run record yet for real screen reader/theme/reduced-motion GUI behavior. | Do not mark as certified based only on generated HTML/CSS tests. | Explicitly pending. | test/manual-accessibility/README.md | A01-A08 all Pending | README notes manual checks needed → #50 | Partial |

## 14. Hosts, compatibility, packaging and installation boundary

| ID | Feature / entry point | Preconditions / normal behavior | States / edge cases | Failure / recovery / persistence | Remote / accessibility | Source evidence | Test evidence | Existing docs → target | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| COMP-01 | VS Code minimum 1.85.0 | package engine and activation. | Semantic compare accepts newer versions; invalid/older version fails. | Activation shows actionable error and returns. | Same local/remote client/host context. | package.json; src/extension.ts MIN_VSCODE_VERSION/activate; src/runtime.ts isSupportedVSCodeVersion | compatibility gate test; CI 1.85.0 + Stable | README → #41/#51 | Partial |
| COMP-02 | extensionKind workspace | Extension installed for workspace host. | Local workspace -> Local extension host; WSL/container/SSH -> remote workspace extension host when installed there. | Wrong-host installation is an installation/VS Code concern, not silently emulated. | Core remote architecture. | package.json; src/extension.ts hostLabel | installed suite; remote procedure | README → #51 | Partial |
| COMP-03 | Local Windows/Linux/macOS automated matrix | CI pull/push compatibility job. | Each OS runs VS Code 1.85.0 and Stable: typecheck, runtime/release tests, extension-host tests, package, installed-VSIX probe. Draft PR compatibility matrix is skipped. | This certifies local extension-host automation, not remote host classes or manual GUI. | Accessibility contracts run in extension tests but not real AT. | .github/workflows/ci.yml | automated CI design; installed VSIX suite | README accurate → #51 | Partial |
| COMP-04 | Installed VSIX probe | Packaged candidate exists. | Fresh isolated profile; CLI install; extension discovered from extensions dir; Activity Bar command resolves; activates; refresh works. | Package content audit rejects development/local credential files. | Per OS/VS Code matrix. | scripts/test-installed-vsix.js; test/installed/suite.js; test/release.test.js | installed suite + release tests | README development section → #41/#51 | Partial |
| COMP-05 | Manual release-candidate GUI smoke | Exact candidate VSIX in clean profile. | M01-M13 cover install, empty states, providers, success/failure, restart, parallel tasks, background, dependencies, output/terminal, filters/sorts, reload, malformed tasks.json, reinstall. | All cases currently Pending; automated missing-exit test must not be misrepresented as manual evidence. | Runs at 1.85.0 and Stable per planned record. | test/manual-release/README.md | M01-M13 Pending | Not part of main user docs → #41/#52 | Missing |
| COMP-06 | WSL / Dev Containers / Remote SSH | Candidate installed in actual remote workspace host. | Best effort, not certified. Procedure verifies host label, run/fail/stop/history/edit/reload/reconnect and optional remote provider. | Real connection loss required for reconnect claim; Developer: Reload Window is not equivalent. | Each host class has separate Not run record. | test/remote-smoke/README.md; src/extension.ts URI APIs | remote procedure only, no completed run | README correctly says best effort → #51 | Partial |
| COMP-07 | Remote file/task APIs | Remote workspace active. | Discovery via vscode.tasks and file operations via vscode.workspace.fs/URI. | Remote provider/file errors surface host-labelled warnings; no local-path assumption in core file access. | Host name visible. | src/extension.ts taskWorkspaceFolder/openTasksJson/createTask/getTasksJsonWarning | remote smoke steps 2-8 pending | README → #51 | Partial |
| COMP-08 | Published release/version truth | User installs from GitHub Releases. | v0.0.6 is published with tasks-sidebar-0.0.6.vsix; main is package version 0.0.6 plus later release-verification fix. | README still points to v0.0.5 and is stale. | Installation documentation issue, not runtime. | package.json; CHANGELOG.md; GitHub Releases | release workflow/package tests | README contradictory → #41 | Missing |

## 15. Test-to-behavior coverage index

This index is the final audit that every relevant automated runtime test maps to at least one inventory row.

| test/runtime.test.js test | Matrix row(s) |
| --- | --- |
| exit code 0 is success | LIFE-03 |
| non-zero exit code is failure | LIFE-04 |
| missing exit code is unknown, never success | LIFE-05 |
| task end without process end is unknown | LIFE-05, LIFE-11 |
| a stop request without confirmation cannot become success | LIFE-06, LIFE-09 |
| a confirmed stopped task is cancelled | LIFE-08 |
| a stale execution reported live again resumes without remaining blocked by an old stop request | LIFE-09, PERS-04, PERS-05 |
| re-observing after process end preserves an unconfirmed stop until task end | LIFE-07, PERS-04 |
| duplicate starts are rejected deterministically | RUN-01, PERS-05 |
| task board query, filters and sort use stable tie breakers | VIEW-02, VIEW-03 |
| task board search covers provider, group and workspace folder | VIEW-01 |
| background tasks do not get a false stale timeout | LIFE-10 |
| lost end observation is stale | LIFE-09 |
| event order does not change finalization eligibility | LIFE-11 |
| execution event reducer converges regardless of process/task end order | LIFE-03, LIFE-11 |
| execution event reducer keeps stop and stale outcomes conservative | LIFE-06, LIFE-08, LIFE-09 |
| refresh revisions are ordered | DISC-06, ERR-10 |
| renaming creates a distinct logical identity for an orphanable run | ID-01, ID-04 |
| definition key order does not split history | ID-01 |
| legacy history IDs remain derivable for migration | ID-02, HIST-09 |
| history identity survives a rename but changes with task behavior | ID-02 |
| old history keys can be found by scope and legacy definition suffix | HIST-09 |
| plan uses the latest successful duration and retains only recent history keys | HIST-02, HIST-05 |
| monotonic elapsed and progress states clamp safely | HIST-01, HIST-06 |
| sleep and resume count as elapsed monotonic time by policy | HIST-01 |
| frontend progress convergence never moves backwards | HIST-06 |
| only fresh confirmed success contributes to the plan | HIST-02, HIST-03, HIST-08 |
| discovery failures have distinct user-facing categories | ERR-01, DISC-05 |
| tasks.json JSONC comments and trailing commas are accepted | TASKS-04 |
| provider fallback uses task types explicitly declared in tasks.json | DISC-03 |
| JSONC trailing comma removal preserves string contents | TASKS-04 |
| dependency specs normalize labels, lists and execution order | DEP-01 |
| invalid dependency documents do not produce task definitions | DEP-01 |
| workspace folder URI is part of logical task identity | ID-01, DISC-04 |
| removed workspace folders are hidden without affecting another root | DISC-04, PERS-07 |
| VS Code compatibility gate compares semantic versions | COMP-01 |
| reload keeps a still-live observation and matches parallel executions one by one | ID-03, PERS-02, PERS-03 |
| reload before end event becomes explicitly unknown after the grace window | LIFE-05, PERS-03 |
| reload before a start event remains pending until the observation window expires | PERS-03 |
| dependency aggregation exposes success, failure, cancellation and partial completion | DEP-03 |
| sequence dependencies resolve in declared order | DEP-02 |
| a running child supersedes its previous historical failure | DEP-03 |
| out-of-order or missing child events remain unresolved or unknown | DEP-04, DEP-07 |

### Integration suite coverage

| Integration contract | Matrix row(s) |
| --- | --- |
| Extension activates and all four contributed commands are registered | UI-01, DISC-01, TASKS-01, TASKS-03 |
| Open tasks.json opens the fixture workspace file | TASKS-01 |
| Real TaskExecution starts and process end is observed | LIFE-02, LIFE-11 |
| Theme tokens, focus-visible, reduced motion, forced colors, lang=en and ARIA contracts exist | A11Y-01..A11Y-07 |
| Focus bookmark/restoration survives rerenders | A11Y-01, UI-06 |
| Retry control and warning deduplication | UI-09, ERR-01 |
| Run/Stop/Restart/Edit availability semantics | UI-06, RUN-01..RUN-07 |
| Output/terminal/refresh/edit/create routes reach correct board methods | UI-03, OUT-01, OUT-02, TASKS-01, TASKS-03 |
| Valid render publishes snapshots + warning | UI-09 |
| Malformed render messages preserve board and warning | ERR-08 |
| Valid empty render clears tasks and warning | UI-08, UI-09 |
| Board method failures are surfaced | ERR-04, ERR-05, ERR-07 |
| Invalid/missing/unsupported webview actions are rejected conservatively | ERR-07 |

### Packaging, release and installed-VSIX coverage

| Test/probe | Matrix row(s) |
| --- | --- |
| release.test.js version bump defaults/manifest synchronization | COMP-08 |
| release verification matches tag, package, lockfile and VSIX metadata | COMP-04, COMP-08 |
| VSIX content audit requires runtime/assets and rejects dev/credential files | COMP-04 |
| VSIX ZIP verifier handles deflated entries/malformed archive | COMP-04 |
| installed/suite.js discovers installed package, opens Activity Bar view, activates extension and runs refresh | UI-01, COMP-04 |
| scripts/test-installed-vsix.js installs into isolated profile and records actual VS Code/platform/package files | COMP-03, COMP-04 |

## 16. Manual evidence inventory

### Release-candidate manual smoke

All M01-M13 cases in test/manual-release/README.md are currently Pending. They map as follows:

| Case | Matrix row(s) |
| --- | --- |
| M01 installed candidate/view/version | UI-01, UI-02, COMP-05 |
| M02 no tasks/empty tasks and empty-state actions | UI-08, TASKS-01, TASKS-03 |
| M03 external provider toggle/filter/npm task | DISC-02, VIEW-02 |
| M04 success/failure | LIFE-03, LIFE-04 |
| M05 stop/restart | LIFE-06, LIFE-08, RUN-02, RUN-03 |
| M06 independent long-running tasks | ID-03, RUN-02 |
| M07 background watcher | LIFE-10 |
| M08 sequential/parallel dependencies | DEP-02, DEP-03, DEP-04 |
| M09 output/terminal | OUT-01, OUT-02, OUT-03 |
| M10 search/filter/sort/multi-root | DISC-04, VIEW-01, VIEW-02, VIEW-03 |
| M11 reload while running | PERS-02, PERS-03 |
| M12 invalid tasks.json and recovery | TASKS-07, ERR-01, ERR-03 |
| M13 uninstall/reinstall candidate | COMP-04, COMP-05 |

The procedure explicitly states that the automated missing-exit-code assertion is not manual evidence for M04/M11.

### Manual accessibility

All A01-A08 cases in test/manual-accessibility/README.md are currently Pending.

| Case | Matrix row(s) |
| --- | --- |
| A01 keyboard-only navigation | A11Y-01 |
| A02 focus stability during refresh/lifecycle changes | A11Y-01, UI-06 |
| A03 screen-reader state announcements | A11Y-02, A11Y-03, A11Y-04 |
| A04 empty and filtered-empty states | UI-08, VIEW-05, A11Y-02 |
| A05 long labels/truncation | UI-05, A11Y-02 |
| A06 themes/forced colors/contrast | A11Y-06 |
| A07 reduced motion | A11Y-05 |
| A08 German VS Code display language with English-only webview | A11Y-07 |

### Remote smoke

WSL, Dev Containers and Remote SSH rows in test/remote-smoke/README.md are all Not run. The procedure covers COMP-02, COMP-06 and COMP-07 plus DISC-02, LIFE-03/LIFE-04/LIFE-06, PERS-02/PERS-04/PERS-05 and TASKS-01/TASKS-08.

## 17. Command, setting, action and state reference audit

### Contributed commands

| Contribution | Inventory row |
| --- | --- |
| Tasks: Refresh / tasksSidebar.refresh | DISC-01, UI-03 |
| Tasks: Open tasks.json / tasksSidebar.openTasksJson | TASKS-01 |
| Tasks: Create task / tasksSidebar.createTask | TASKS-03 |
| Tasks: Toggle external task providers / tasksSidebar.toggleExternalTasks | DISC-02 |

### Setting

| Setting | Inventory row |
| --- | --- |
| tasksSidebar.includeExternalTasks (boolean, default false, Workspace update by toggle command) | DISC-02 |

### Webview-to-extension actions

| Action | Inventory row |
| --- | --- |
| run | RUN-01 |
| stop | RUN-02 |
| restart | RUN-03..RUN-06 |
| output | OUT-01 |
| terminal | OUT-02 |
| refresh | DISC-01 |
| edit | TASKS-01/TASKS-02 |
| create | TASKS-03 |
| unsupported/malformed | ERR-07 |

### Visible/runtime states

| State/outcome | Inventory row |
| --- | --- |
| idle | LIFE-01 |
| running | LIFE-02 |
| stopping | LIFE-06 |
| awaiting-task-end / waiting for task end | LIFE-07 |
| success/completed | LIFE-03 |
| failed | LIFE-04 |
| cancelled | LIFE-08 |
| unknown | LIFE-05 |
| stale | LIFE-09 |
| measured/overtime/unknown progress | HIST-06/HIST-07 |
| dependency running/success/failed/cancelled/unknown/unresolved | DEP-02..DEP-04 |
| orphaned execution | ID-04 |
| filtered-empty / no tasks / loading | VIEW-05, UI-07, UI-08 |
| warning + Retry | UI-09 |

## 17a. User-facing message and recovery audit

This table cross-checks the user-facing message/error prefixes in `src/extension.ts` against the inventory so that failure paths are not hidden only in source strings.

| User-facing message / condition | Matrix row(s) |
| --- | --- |
| VS Code version below 1.85.0 | COMP-01 |
| External task provider setting could not be changed | DISC-02, ERR-01 |
| This task is already running | RUN-01 |
| Tasks could not be read. Refresh the view and try again | RUN-01, ERR-04 |
| This task is no longer available. Refresh the view | RUN-01, TASKS-02, ERR-04 |
| The task could not be started: <detail> | RUN-01, ERR-04 |
| This task is already stopping | RUN-03, RUN-07 |
| The task could not be stopped | LIFE-06, ERR-05 |
| Task output could not be opened; inspect Output/Terminal | OUT-01 |
| Task terminal could not be focused | OUT-02 |
| Selected task could not be read | TASKS-02, ERR-03 |
| External task has no workspace tasks.json to edit | TASKS-02 |
| Open a workspace before editing tasks.json | DISC-05, TASKS-01 |
| Error while checking/creating/opening/showing tasks.json | TASKS-01, ERR-03 |
| Open a workspace before creating a task | DISC-05, TASKS-03 |
| Task could not be created; check permissions/JSON syntax | TASKS-03, TASKS-06, TASKS-07, ERR-03 |
| Old task history could not be pruned | HIST-05, ERR-06 |
| Observed task status could not be saved | PERS-01, ERR-06 |
| Unknown reload task status could not be saved | PERS-03, ERR-06 |
| Stale task status could not be saved | LIFE-09, ERR-06 |
| Task history could not be saved | HIST-04, HIST-05, ERR-06 |
| Task view could not be refreshed after timeout/completion | LIFE-09, ERR-10 |
| Last valid task snapshot could not be saved | PERS-06, ERR-06 |
| Sidebar action could not be completed | ERR-07 |
| Tasks Sidebar could not be updated | ERR-09 |
| No workspace / provider / tasks.json warning with Retry | DISC-05, ERR-01, ERR-02, ERR-03, UI-09 |

## 18. Handbook routing

| Handbook issue | Inventory responsibility |
| --- | --- |
| #41 | COMP-08, UI-01..UI-08, first-run parts of TASKS-01/TASKS-03 |
| #42 | DISC-01..DISC-07, ID-01..ID-05 |
| #43 | LIFE-01..LIFE-11, RUN-01..RUN-07 |
| #44 | DEP-01..DEP-07 |
| #45 | VIEW-01..VIEW-06 and board interaction details |
| #46 | HIST-01..HIST-09 and persistence overlap with PERS-01/PERS-06 |
| #47 | DISC-02 command/setting reference, TASKS-01..TASKS-08 |
| #48 | OUT-01..OUT-03 |
| #49 | ERR-01..ERR-10 plus UI-09 |
| #50 | A11Y-01..A11Y-08 |
| #51 | PERS-01..PERS-08, COMP-01..COMP-07 |
| #52 | Final command/setting/action/state tables, manual evidence boundary, contradiction audit |

## 19. Completion checklist for issue #40

- [x] package.json commands, setting, view contribution, activation event, VS Code minimum and extensionKind inventoried.
- [x] src/extension.ts command handlers, task lifecycle, persistence, discovery, actions, UI states, warnings and error paths inventoried.
- [x] src/runtime.ts outcome, timing, filter/sort, JSONC, identities, reconciliation, dependencies and compatibility helpers inventoried.
- [x] Every test/runtime.test.js case mapped to at least one matrix row.
- [x] Integration suite contracts mapped, including webview validation, actions, accessibility and failure routing.
- [x] Release/package/installed-VSIX tests mapped.
- [x] Manual release, accessibility and remote-smoke procedures mapped with their current Pending/Not run boundary.
- [x] README, CHANGELOG and SUPPORT compared with current code/tests.
- [x] Current commands, setting, webview actions, visible/runtime states and key error messages audited.
- [x] Known contradictions and underdocumented edge cases explicitly recorded.
- [x] Every matrix row routes to one or more handbook sub-issues.

## Issue #40 conclusion

The inventory is complete enough to act as the control instrument for #39. No additional handbook sub-issue is required at this point: the newly found gaps are covered by existing #41-#52. In particular, #41 owns the stale release/install wording, #45/#50 own the search-label/filter semantics, #47 owns Create-task JSONC rewrite behavior, and #42/#44 own same-name dependency ambiguity.

Issue #40 can be closed when this matrix is accepted. The downstream handbook issues should treat this file as a living checklist: if implementation changes add a command, action, state, warning, persistence key, test-only edge case or host behavior, add/update a row here before considering #39 complete.
