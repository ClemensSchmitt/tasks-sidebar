const test = require('node:test');
const assert = require('node:assert/strict');
const { applyTaskExecutionEvent, calculateElapsedMs, calculatePlanDuration, calculateProgressPercent, calculateProgressState, classifyDiscoveryFailure, createHistoryMigrationSuffix, createHistoryTaskId, createLegacyTaskId, createLogicalTaskId, filterAndSortTaskSnapshots, isCurrentRefresh, isSupportedVSCodeVersion, isWorkspaceFolderVisible, mergeProgressElapsed, observationKey, parseJsonc, parseTaskDependencySpecs, parseTaskProviderTypes, parseTaskTags, reconcilePersistedObservations, resolveDependencyState, resolveTaskOutcome, selectHistoryKey, selectRecentHistoryKeys, shouldAllowStart, shouldCountSuccessfulRun, shouldFinalizeTask, shouldScheduleStaleCheck } = require('../out/runtime.js');

const observation = (overrides = {}) => ({
  stopRequested: false,
  taskEndSeen: false,
  processEndSeen: false,
  graceExpired: false,
  stale: false,
  ...overrides
});

test('exit code 0 is success', () => {
  assert.equal(resolveTaskOutcome(observation({ taskEndSeen: true, processEndSeen: true, exitCode: 0 })), 'success');
});

test('non-zero exit code is failure', () => {
  assert.equal(resolveTaskOutcome(observation({ taskEndSeen: true, processEndSeen: true, exitCode: 2 })), 'failed');
});

test('missing exit code is unknown, never success', () => {
  assert.equal(resolveTaskOutcome(observation({ taskEndSeen: true, processEndSeen: true })), 'unknown');
});

test('task end without process end is unknown', () => {
  assert.equal(resolveTaskOutcome(observation({ taskEndSeen: true })), 'unknown');
});

test('a stop request without confirmation cannot become success', () => {
  assert.equal(resolveTaskOutcome(observation({ stopRequested: true, processEndSeen: true, exitCode: 0, stale: true })), 'stale');
});

test('a confirmed stopped task is cancelled', () => {
  assert.equal(resolveTaskOutcome(observation({ stopRequested: true, taskEndSeen: true, processEndSeen: true, exitCode: 0 })), 'cancelled');
});

test('a stale execution reported live again resumes without remaining blocked by an old stop request', () => {
  const stoppedButUnconfirmed = {
    stopRequested: true,
    taskEndSeen: false,
    processEndSeen: false,
    stale: false,
    lifecycle: 'stopping'
  };
  const stale = applyTaskExecutionEvent(stoppedButUnconfirmed, { type: 'stale' });
  const resumed = applyTaskExecutionEvent(stale, { type: 'execution-observed' });

  assert.equal(resumed.lifecycle, 'running');
  assert.equal(resumed.stale, false);
  assert.equal(resumed.stopRequested, false);
  assert.equal(shouldAllowStart(false, true), false);

  const terminalStale = applyTaskExecutionEvent(
    applyTaskExecutionEvent(stale, { type: 'task-end' }),
    { type: 'execution-observed' }
  );
  assert.equal(terminalStale.lifecycle, 'stale');
  assert.equal(terminalStale.stale, true);
  assert.equal(terminalStale.taskEndSeen, true);
});

test('re-observing after process end preserves an unconfirmed stop until task end', () => {
  const processEnded = applyTaskExecutionEvent({
    stopRequested: true,
    taskEndSeen: false,
    processEndSeen: false,
    stale: false,
    lifecycle: 'stopping'
  }, { type: 'process-end', exitCode: 0 });
  const stale = applyTaskExecutionEvent(processEnded, { type: 'stale' });
  const resumed = applyTaskExecutionEvent(stale, { type: 'execution-observed' });

  assert.equal(resumed.lifecycle, 'awaiting-task-end');
  assert.equal(resumed.stopRequested, true);
  assert.equal(resumed.processEndSeen, true);

  const ended = applyTaskExecutionEvent(resumed, { type: 'task-end' });
  assert.equal(resolveTaskOutcome({
    stopRequested: ended.stopRequested,
    taskEndSeen: ended.taskEndSeen,
    processEndSeen: ended.processEndSeen,
    exitCode: ended.exitCode,
    graceExpired: true,
    stale: ended.stale
  }), 'cancelled');
});

test('duplicate starts are rejected deterministically', () => {
  assert.equal(shouldAllowStart(true, false), false);
  assert.equal(shouldAllowStart(false, true), false);
  assert.equal(shouldAllowStart(false, false), true);
});

test('task board query, filters and sort use stable tie breakers', () => {
  const tasks = [
    { id: 'b', name: 'Build', source: 'Workspace', group: 'build', workspaceFolderName: 'api', tags: ['integration', 'compile'], isRunning: true, elapsedMs: 2000 },
    { id: 'a', name: 'Build', source: 'npm', group: 'build', workspaceFolderName: 'web', tags: ['smoke'], isRunning: false, elapsedMs: 0, lastOutcome: 'success' },
    { id: 'c', name: 'Lint', source: 'Workspace', group: 'test', workspaceFolderName: 'api', isRunning: false, elapsedMs: 0, lastOutcome: 'failed' }
  ];
  assert.deepEqual(filterAndSortTaskSnapshots(tasks, 'npm', 'all', 'name').map(task => task.id), ['a']);
  assert.deepEqual(filterAndSortTaskSnapshots(tasks, '', 'running', 'name').map(task => task.id), ['b']);
  assert.deepEqual(filterAndSortTaskSnapshots(tasks, '', 'failed', 'name').map(task => task.id), ['c']);
  assert.deepEqual(filterAndSortTaskSnapshots(tasks, '', 'external', 'name').map(task => task.id), ['a']);
  assert.deepEqual(filterAndSortTaskSnapshots(tasks, '', 'all', 'status').map(task => task.id), ['b', 'c', 'a']);
  assert.deepEqual(filterAndSortTaskSnapshots(tasks, '', 'all', 'name', 'SMOKE').map(task => task.id), ['a']);
  assert.deepEqual(filterAndSortTaskSnapshots(tasks, 'integration', 'all', 'name').map(task => task.id), ['b']);
});

test('multiple selected tags require every tag and compose with search and status', () => {
  const base = { source: 'Workspace', group: 'test', isRunning: false, elapsedMs: 0 };
  const tasks = [
    { ...base, id: 'a', name: 'A', tags: ['tag1', 'tag2'], isRunning: true },
    { ...base, id: 'b', name: 'B', tags: ['tag1'] },
    { ...base, id: 'c', name: 'C', tags: ['tag2'] },
    { ...base, id: 'd', name: 'D', tags: ['tag1', 'tag2', 'tag3'] },
    { ...base, id: 'e', name: 'E' }
  ];
  const ids = (tags, query = '', status = 'all') =>
    filterAndSortTaskSnapshots(tasks, query, status, 'name', tags).map(task => task.id);
  assert.deepEqual(ids(['tag1', 'tag2']), ['a', 'd']);
  assert.deepEqual(ids([' TAG1 ', 'TaG2', 'tag1', '']), ['a', 'd']);
  assert.deepEqual(ids(['tag1']), ['a', 'b', 'd']);
  assert.deepEqual(ids([]), ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(ids(['missing']), []);
  assert.deepEqual(ids(['tag1', 'tag2'], 'D'), ['d']);
  assert.deepEqual(ids(['tag1', 'tag2'], '', 'running'), ['a']);
});

test('task board search covers provider, group and workspace folder', () => {
  const task = { id: 'x', name: 'Compile', source: 'npm', group: 'build', workspaceFolderName: 'frontend', isRunning: false, elapsedMs: 0 };
  assert.equal(filterAndSortTaskSnapshots([task], 'npm', 'all').length, 1);
  assert.equal(filterAndSortTaskSnapshots([task], 'build', 'all').length, 1);
  assert.equal(filterAndSortTaskSnapshots([task], 'frontend', 'all').length, 1);
  assert.equal(filterAndSortTaskSnapshots([{ ...task, tags: ['release'] }], 'release', 'all').length, 1);
});

test('background tasks do not get a false stale timeout', () => {
  assert.equal(shouldScheduleStaleCheck(true, false, false), false);
  assert.equal(shouldScheduleStaleCheck(true, true, false), true);
  assert.equal(shouldScheduleStaleCheck(false, false, false), true);
  assert.equal(shouldScheduleStaleCheck(true, false, true), false);
  assert.equal(shouldScheduleStaleCheck(true, false, false, true), true);
});

test('lost end observation is stale', () => {
  assert.equal(resolveTaskOutcome(observation({ stale: true })), 'stale');
  assert.equal(resolveTaskOutcome(observation({ stale: true, taskEndSeen: true, processEndSeen: true, exitCode: 0 })), 'stale');
});

test('event order does not change finalization eligibility', () => {
  assert.equal(shouldFinalizeTask(observation({ taskEndSeen: true, processEndSeen: true })), true);
  assert.equal(shouldFinalizeTask(observation({ taskEndSeen: true, graceExpired: true })), true);
  assert.equal(shouldFinalizeTask(observation({ processEndSeen: true })), false);
});

test('execution event reducer converges regardless of process/task end order', () => {
  const initial = { stopRequested: false, taskEndSeen: false, processEndSeen: false, graceExpired: false, stale: false, lifecycle: 'running' };
  const processFirst = applyTaskExecutionEvent(
    applyTaskExecutionEvent(initial, { type: 'process-end', exitCode: 0 }),
    { type: 'task-end' }
  );
  const taskFirst = applyTaskExecutionEvent(
    applyTaskExecutionEvent(initial, { type: 'task-end' }),
    { type: 'process-end', exitCode: 0 }
  );
  assert.deepEqual(
    { taskEndSeen: processFirst.taskEndSeen, processEndSeen: processFirst.processEndSeen, exitCode: processFirst.exitCode, lifecycle: processFirst.lifecycle },
    { taskEndSeen: true, processEndSeen: true, exitCode: 0, lifecycle: 'awaiting-task-end' }
  );
  assert.deepEqual(
    { taskEndSeen: taskFirst.taskEndSeen, processEndSeen: taskFirst.processEndSeen, exitCode: taskFirst.exitCode, lifecycle: taskFirst.lifecycle },
    { taskEndSeen: true, processEndSeen: true, exitCode: 0, lifecycle: 'awaiting-task-end' }
  );
  assert.equal(resolveTaskOutcome(processFirst), 'success');
  assert.equal(resolveTaskOutcome(taskFirst), 'success');
});

test('execution event reducer keeps stop and stale outcomes conservative', () => {
  const initial = { stopRequested: false, taskEndSeen: false, processEndSeen: false, graceExpired: false, stale: false, lifecycle: 'running' };
  const stopped = applyTaskExecutionEvent(
    applyTaskExecutionEvent(
      applyTaskExecutionEvent(initial, { type: 'stop-requested' }),
      { type: 'process-end', exitCode: 0 }
    ),
    { type: 'task-end' }
  );
  assert.equal(stopped.lifecycle, 'stopping');
  assert.equal(resolveTaskOutcome(stopped), 'cancelled');
  const stale = applyTaskExecutionEvent(initial, { type: 'stale' });
  assert.equal(stale.lifecycle, 'stale');
  assert.equal(resolveTaskOutcome(stale), 'stale');
});

test('refresh revisions are ordered', () => {
  assert.equal(isCurrentRefresh(4, 4), true);
  assert.equal(isCurrentRefresh(3, 4), false);
});

test('renaming creates a distinct logical identity for an orphanable run', () => {
  const definition = { type: 'shell', command: 'echo hello' };
  assert.notEqual(
    createLogicalTaskId('Workspace', 'old name', 'file:///repo', definition),
    createLogicalTaskId('Workspace', 'new name', 'file:///repo', definition)
  );
  assert.notEqual(
    createLogicalTaskId('Workspace', 'same', 'file:///repo', definition),
    createLogicalTaskId('Workspace', 'same', 'file:///repo', { ...definition, command: 'echo goodbye' })
  );
});

test('definition key order does not split history', () => {
  assert.equal(
    createLogicalTaskId('Workspace', 'task', 'file:///repo', { type: 'shell', command: 'echo', args: ['a'] }),
    createLogicalTaskId('Workspace', 'task', 'file:///repo', { args: ['a'], command: 'echo', type: 'shell' })
  );
});

test('legacy history IDs remain derivable for migration', () => {
  const legacy = createLegacyTaskId('Workspace', 'old name', 'file:///repo', { type: 'shell', command: 'echo' });
  const logical = createLogicalTaskId('Workspace', 'old name', 'file:///repo', { type: 'shell', command: 'echo' });
  assert.notEqual(legacy, logical);
  assert.equal(selectHistoryKey([legacy], logical, legacy), legacy);
  assert.equal(selectHistoryKey([logical, legacy], logical, legacy), logical);
});

test('history identity survives a rename but changes with task behavior', () => {
  const definition = { type: 'shell', command: 'echo hello' };
  assert.equal(
    createHistoryTaskId('Workspace', 'file:///repo', definition),
    createHistoryTaskId('Workspace', 'file:///repo', { ...definition, label: 'renamed' })
  );
  assert.notEqual(
    createHistoryTaskId('Workspace', 'file:///repo', definition),
    createHistoryTaskId('Workspace', 'file:///repo', { ...definition, command: 'echo goodbye' })
  );
});

test('old history keys can be found by scope and legacy definition suffix', () => {
  const suffix = createHistoryMigrationSuffix('file:///repo', { type: 'shell', command: 'echo hello' });
  assert.equal(selectHistoryKey(['Workspace:old name' + suffix], 'current', 'legacy', 'history', suffix), 'Workspace:old name' + suffix);
});

test('plan uses the latest successful duration and retains only recent history keys', () => {
  assert.equal(calculatePlanDuration({ lastDurationMs: 4200, durationsMs: [4200, 3900] }), 4200);
  assert.equal(calculatePlanDuration({ durationsMs: [3900, 4200] }), 3900);
  assert.equal(calculatePlanDuration({ durationsMs: [] }), undefined);
  assert.deepEqual(selectRecentHistoryKeys({
    old: { lastUpdatedAt: 1 },
    newest: { lastUpdatedAt: 3 },
    middle: { lastUpdatedAt: 2 }
  }, 2), ['newest', 'middle']);
});

test('monotonic elapsed and progress states clamp safely', () => {
  assert.equal(calculateElapsedMs(100, 90), 0);
  assert.equal(calculateElapsedMs(100, 150), 50);
  assert.equal(calculateProgressPercent(500, 1000, true), 50);
  assert.equal(calculateProgressPercent(5000, 1000, true), 100);
  assert.equal(calculateProgressState({ isRunning: true, elapsedMs: 500, plannedMs: 1000 }), 'measured');
  assert.equal(calculateProgressState({ isRunning: true, elapsedMs: 1500, plannedMs: 1000 }), 'overtime');
  assert.equal(calculateProgressState({ isRunning: true, elapsedMs: 0 }), 'unknown');
  assert.equal(calculateProgressState({ isRunning: false, elapsedMs: 0, lastOutcome: 'success' }), 'completed');
  assert.equal(calculateProgressState({ isRunning: false, elapsedMs: 0, lastOutcome: 'failed' }), 'failed');
  assert.equal(calculateProgressState({ isRunning: false, elapsedMs: 0, lastOutcome: 'cancelled' }), 'cancelled');
  assert.equal(calculateProgressState({ isRunning: false, elapsedMs: 0, lastOutcome: 'stale' }), 'stale');
});

test('sleep and resume count as elapsed monotonic time by policy', () => {
  assert.equal(calculateElapsedMs(100, 2100), 2000);
  assert.equal(calculateElapsedMs(2100, 100), 0);
});

test('frontend progress convergence never moves backwards', () => {
  assert.equal(mergeProgressElapsed(900, 800, 850), 900);
  assert.equal(mergeProgressElapsed(900, 1200, 1100), 1200);
  assert.equal(mergeProgressElapsed(1200, 1000, 1300), 1300);
});

test('only fresh confirmed success contributes to the plan', () => {
  assert.equal(shouldCountSuccessfulRun('success', false), true);
  assert.equal(shouldCountSuccessfulRun('success', true), false);
  assert.equal(shouldCountSuccessfulRun('failed', false), false);
  assert.equal(shouldCountSuccessfulRun('cancelled', false), false);
  assert.equal(shouldCountSuccessfulRun('unknown', false), false);
  assert.equal(shouldCountSuccessfulRun('stale', false), false);
});

test('discovery failures have distinct user-facing categories', () => {
  assert.equal(classifyDiscoveryFailure({ hasWorkspace: false }), 'empty-workspace');
  assert.equal(classifyDiscoveryFailure({ hasWorkspace: true, jsonValid: false }), 'invalid-json');
  assert.equal(classifyDiscoveryFailure({ hasWorkspace: true, permissionDenied: true }), 'permission');
  assert.equal(classifyDiscoveryFailure({ hasWorkspace: true, providerFailed: true }), 'provider');
});

test('tasks.json JSONC comments and trailing commas are accepted', () => {
  assert.deepEqual(parseJsonc('{\n  // comment\n  \"tasks\": [{\"label\":\"build\",}],\n}'), {
    tasks: [{ label: 'build' }]
  });
});

test('provider fallback uses task types explicitly declared in tasks.json', () => {
  assert.deepEqual(parseTaskProviderTypes(`{
    "tasks": [
      { "label": "shell", "type": "shell", "command": "echo" },
      { "label": "npm", "type": "npm", "script": "build" },
      { "label": "again", "type": "shell", "command": "echo" }
    ]
  }`), ['shell', 'npm']);
  assert.deepEqual(parseTaskProviderTypes('{ invalid json'), []);
  assert.deepEqual(parseTaskProviderTypes('{"tasks":[]}'), []);
});

test('JSONC trailing comma removal preserves string contents', () => {
  assert.deepEqual(parseJsonc('{"command":"echo \\",} ]",}'), {
    command: 'echo ",} ]'
  });
});

test('dependency specs normalize labels, lists and execution order', () => {
  assert.deepEqual(parseTaskDependencySpecs({
    tasks: [
      { label: 'build', dependsOn: 'compile', dependsOrder: 'sequence' },
      { label: 'release', dependsOn: ['build', 'test'] }
    ]
  }), {
    build: { label: 'build', dependsOn: ['compile'], dependsOrder: 'sequence' },
    release: { label: 'release', dependsOn: ['build', 'test'], dependsOrder: 'parallel' }
  });
});

test('task tags normalize from tasks.json labels and ignore invalid entries', () => {
  const tags = parseTaskTags({
    tasks: [
      { label: 'Build', tags: [' compile ', 'smoke', 'COMPILE', '', 42] },
      { taskName: 'Legacy task', tags: ['legacy'] },
      { label: 'Invalid tags', tags: 'not-an-array' },
      { label: 'Empty tags', tags: [' ', null] }
    ]
  });
  assert.deepEqual({ ...tags }, {
    Build: ['compile', 'smoke'],
    'Legacy task': ['legacy']
  });
  assert.deepEqual(parseTaskTags({ version: '2.0.0' }), {});
});

test('invalid dependency documents do not produce task definitions', () => {
  assert.deepEqual(parseTaskDependencySpecs({ version: '2.0.0' }), {});
  assert.deepEqual(parseTaskDependencySpecs({ tasks: [null, {}, { label: 42 }] }), {});
});

test('workspace folder URI is part of logical task identity', () => {
  const definition = { type: 'shell', command: 'echo hello' };
  assert.notEqual(
    createLogicalTaskId('Workspace', 'build', 'file:///repo-a', definition),
    createLogicalTaskId('Workspace', 'build', 'file:///repo-b', definition)
  );
});

test('removed workspace folders are hidden without affecting another root', () => {
  assert.equal(isWorkspaceFolderVisible('file:///repo-a', ['file:///repo-b'], false), false);
  assert.equal(isWorkspaceFolderVisible('file:///repo-b', ['file:///repo-b'], false), true);
  assert.equal(isWorkspaceFolderVisible(undefined, ['file:///repo-b'], false), false);
});

test('VS Code compatibility gate compares semantic versions', () => {
  assert.equal(isSupportedVSCodeVersion('1.85.0'), true);
  assert.equal(isSupportedVSCodeVersion('1.90.1'), true);
  assert.equal(isSupportedVSCodeVersion('1.84.9'), false);
  assert.equal(isSupportedVSCodeVersion('not-a-version'), false);
});

test('reload keeps a still-live observation and matches parallel executions one by one', () => {
  const observations = [
    { logicalId: 'build', workspaceFolderUri: 'file:///repo', observedAt: 100 },
    { logicalId: 'build', workspaceFolderUri: 'file:///repo', observedAt: 101 }
  ];
  const result = reconcilePersistedObservations(
    observations,
    [observationKey('build', 'file:///repo')],
    105,
    10
  );
  assert.deepEqual(result.pending, [observations[1]]);
  assert.deepEqual(result.unknown, []);
});

test('reload before end event becomes explicitly unknown after the grace window', () => {
  const observationRecord = { logicalId: 'build', observedAt: 100 };
  const result = reconcilePersistedObservations([observationRecord], [], 110, 10);
  assert.deepEqual(result.pending, []);
  assert.deepEqual(result.unknown, [observationRecord]);
});

test('reload before a start event remains pending until the observation window expires', () => {
  const observationRecord = { logicalId: 'build', observedAt: 100 };
  const result = reconcilePersistedObservations([observationRecord], [], 109, 10);
  assert.deepEqual(result.pending, [observationRecord]);
  assert.deepEqual(result.unknown, []);
});

test('dependency aggregation exposes success, failure, cancellation and partial completion', () => {
  assert.deepEqual(resolveDependencyState(['compile'], ['compile-id'], [
    { name: 'compile', isRunning: false, lastOutcome: 'success' }
  ]), { state: 'success' });
  assert.deepEqual(resolveDependencyState(['compile'], ['compile-id'], [
    { name: 'compile', isRunning: false, lastOutcome: 'failed' }
  ]), { state: 'failed', failure: 'compile' });
  assert.deepEqual(resolveDependencyState(['compile'], ['compile-id'], [
    { name: 'compile', isRunning: false, lastOutcome: 'cancelled' }
  ]), { state: 'cancelled', failure: 'compile' });
  assert.deepEqual(resolveDependencyState(['compile', 'test'], ['compile-id', 'test-id'], [
    { name: 'compile', isRunning: true },
    { name: 'test', isRunning: false, lastOutcome: 'success' }
  ]), { state: 'running' });
});

test('sequence dependencies resolve in declared order', () => {
  assert.deepEqual(resolveDependencyState(['compile', 'test'], ['compile-id', 'test-id'], [
    { name: 'compile', isRunning: true },
    { name: 'test', isRunning: false, lastOutcome: 'success' }
  ], 'sequence'), { state: 'running' });
  assert.deepEqual(resolveDependencyState(['compile', 'test'], ['compile-id', 'test-id'], [
    { name: 'compile', isRunning: false, lastOutcome: 'success' }
  ], 'sequence'), { state: 'unresolved', failure: 'test' });
  assert.deepEqual(resolveDependencyState(['compile', 'test'], ['compile-id', 'test-id'], [
    { name: 'compile', isRunning: false, lastOutcome: 'success' },
    { name: 'test', isRunning: false, lastOutcome: 'failed' }
  ], 'sequence'), { state: 'failed', failure: 'test' });
  assert.deepEqual(resolveDependencyState(['compile', 'test'], ['compile-id', 'test-id'], [
    { name: 'compile', isRunning: false, lastOutcome: 'success' },
    { name: 'test', isRunning: false, lastOutcome: 'success' }
  ], 'sequence'), { state: 'success' });
});

test('a running child supersedes its previous historical failure', () => {
  assert.deepEqual(resolveDependencyState(['compile'], ['compile-id'], [
    { name: 'compile', isRunning: true, lastOutcome: 'failed' }
  ]), { state: 'running' });
});

test('out-of-order or missing child events remain unresolved or unknown', () => {
  assert.deepEqual(resolveDependencyState(['compile'], [], []), { state: 'unresolved', failure: 'compile' });
  assert.deepEqual(resolveDependencyState(['compile'], ['compile-id'], [
    { name: 'compile', isRunning: false, lastOutcome: 'unknown' }
  ]), { state: 'unknown', failure: 'compile' });
});

test('task definition navigation preserves JSONC offsets and selects exact labels', () => {
  const { findTaskDefinitionRange } = require('../out/runtime.js');
  const text = '{\n // {"label":"target"}\n "version":"2.0.0", "tasks":[\n' +
    '{"label":"target-extra","command":"echo } ["},\n' +
    '/* comment */ {"label":"target","options":{"env":{"label":"nested"}},},\n],}';
  const range = findTaskDefinitionRange(text, 'target');
  assert.ok(range);
  assert.equal(JSON.parse(text.slice(range.start, range.end).replace(/,}/g, '}')).label, 'target');
  assert.equal(text[range.start], '{');
  assert.equal(text[range.end - 1], '}');
  assert.equal(findTaskDefinitionRange(text, 'missing'), undefined);
});

test('task definition navigation rejects duplicate, renamed and nested labels', () => {
  const { findTaskDefinitionRange } = require('../out/runtime.js');
  assert.equal(findTaskDefinitionRange('{"tasks":[{"label":"same"},{"label":"same"}]}', 'same'), undefined);
  assert.equal(findTaskDefinitionRange('{"tasks":[{"label":"renamed"}]}', 'old'), undefined);
  assert.equal(findTaskDefinitionRange('{"tasks":[{"label":"parent","options":{"label":"child"}}]}', 'child'), undefined);
  assert.equal(findTaskDefinitionRange('{"other":{"tasks":[{"label":"target"}]}}', 'target'), undefined);
  assert.throws(() => findTaskDefinitionRange('{invalid', 'target'));
  for (const folder of ['first', 'second']) {
    const text = JSON.stringify({ tasks: [{ label: 'same', command: folder }] });
    const range = findTaskDefinitionRange(text, 'same');
    assert.equal(JSON.parse(text.slice(range.start, range.end)).command, folder);
  }
});

test('optional regex search supports anchors, alternatives, fields and existing filters', () => {
  const { compileTaskSearchRegex } = require('../out/runtime.js');
  const tasks = [
    { id: 'a', name: 'Build app', source: 'Workspace', group: 'build', workspaceFolderName: 'Client', tags: ['ci', 'frontend'], isRunning: true, elapsedMs: 5 },
    { id: 'b', name: 'Test app', source: 'Workspace', group: 'test', workspaceFolderName: 'Server', tags: ['backend'], isRunning: false, elapsedMs: 0 },
    { id: 'c', name: 'Lint app', source: 'npm', group: 'lint', workspaceFolderName: 'Client', tags: ['format'], isRunning: false, elapsedMs: 0 },
  ];
  const ids = (query, enabled, filter = 'all', sort = 'name', tag = '') =>
    filterAndSortTaskSnapshots(tasks, query, filter, sort, tag, enabled).map(task => task.id);
  assert.deepEqual(ids('^(build|test)', true), ['a', 'b']);
  assert.deepEqual(ids('lint|format', true), ['c']);
  assert.deepEqual(ids('^client$', true), ['a', 'c']);
  assert.deepEqual(ids('^frontend$', true), ['a']);
  assert.deepEqual(ids('^npm$', true, 'external'), ['c']);
  assert.deepEqual(ids('app$', true, 'running'), ['a']);
  assert.deepEqual(ids('app$', true, 'all', 'name', 'ci'), ['a']);
  assert.deepEqual(ids('.*', true), ['a', 'c', 'b']);
  assert.deepEqual(ids('', true), ids('', false));
  assert.deepEqual(ids('^(build|test)', false), []);
  assert.deepEqual(ids('build', false), ['a']);
  assert.deepEqual(ids('BUILD', true), ['a']);
  assert.deepEqual(ids('.', false), []);
  assert.throws(() => compileTaskSearchRegex('['), SyntaxError);
  assert.throws(() => ids('(', true), SyntaxError);
  assert.throws(() => ids('x'.repeat(257), true), /too long/);
});

test('custom order repositions visible tasks without changing hidden slots', () => {
  const { reorderVisibleTaskIds } = require('../out/runtime.js');
  assert.deepEqual(reorderVisibleTaskIds(['a', 'hidden', 'b', 'c'], ['a', 'b', 'c'], 'c', 'a'), ['c', 'hidden', 'a', 'b']);
  assert.deepEqual(reorderVisibleTaskIds(['a', 'hidden', 'b', 'c'], ['a', 'b', 'c'], 'a', 'c', true), ['b', 'hidden', 'c', 'a']);
  assert.deepEqual(reorderVisibleTaskIds(['a', 'b', 'c'], ['a', 'c'], 'a', 'c', true), ['c', 'b', 'a']);
  assert.deepEqual(reorderVisibleTaskIds(['a', 'b'], ['a', 'b'], 'a', 'a'), ['a', 'b']);
  assert.deepEqual(reorderVisibleTaskIds(['a', 'b'], ['a'], 'a', 'b'), ['a', 'b']);
  assert.deepEqual(reorderVisibleTaskIds(['a', 'a', 'b'], ['a', 'b'], 'b', 'a'), ['b', 'a']);
});

test('missing workspace task folders detects an initially partial multi-root discovery', () => {
  const { missingWorkspaceTaskFolders } = require('../out/runtime.js');
  const roots = new Map([
    ['file:///workspace', ['Start']],
    ['file:///repo-a', ['Build', 'Test']],
    ['file:///repo-b', ['Build']],
    ['file:///repo-c', ['Deploy']],
    ['file:///empty', []]
  ]);
  const discovered = [
    { workspaceFolderUri: 'file:///workspace', source: 'Workspace', name: 'Start' },
    { workspaceFolderUri: 'file:///repo-a', source: 'Workspace', name: 'Build' },
    { workspaceFolderUri: 'file:///repo-a', source: 'npm', name: 'Test' },
    { workspaceFolderUri: 'file:///other', source: 'Workspace', name: 'Deploy' }
  ];
  assert.deepEqual(missingWorkspaceTaskFolders(roots, discovered),
    ['file:///repo-a', 'file:///repo-b', 'file:///repo-c']);
  const complete = [
    ...discovered,
    { workspaceFolderUri: 'file:///repo-a', source: 'Workspace', name: 'Test' },
    { workspaceFolderUri: 'file:///repo-b', source: 'Workspace', name: 'Build' },
    { workspaceFolderUri: 'file:///repo-c', source: 'Workspace', name: 'Deploy' }
  ];
  assert.deepEqual(missingWorkspaceTaskFolders(roots, complete), []);
  assert.deepEqual(missingWorkspaceTaskFolders(new Map([['file:///empty', []]]), []), []);
  assert.deepEqual(missingWorkspaceTaskFolders(new Map([['file:///repo-a', ['Build']]]),
    complete.filter(task => task.workspaceFolderUri !== 'file:///repo-a')), ['file:///repo-a']);
});

test('missing roots are compared by full URI and task label, never deduplicated by name', () => {
  const { missingWorkspaceTaskFolders } = require('../out/runtime.js');
  const configured = new Map([
    ['file:///repo-a', ['Build']], ['file:///repo-b', ['Build']], ['vscode-remote://ssh/repo-c', ['Build']]
  ]);
  assert.deepEqual(missingWorkspaceTaskFolders(configured, [
    { source: 'Workspace', workspaceFolderUri: 'file:///repo-a', name: 'Build' },
    { source: 'Workspace', workspaceFolderUri: 'file:///repo-b', name: 'Build' }
  ]), ['vscode-remote://ssh/repo-c']);
});

test('removed workspace roots do not leave false missing-folder diagnostics', () => {
  const { missingWorkspaceTaskFolders } = require('../out/runtime.js');
  const snapshots = [
    { source: 'Workspace', name: 'Build', workspaceFolderUri: 'file:///repo-a' },
    { source: 'Workspace', name: 'Test', workspaceFolderUri: 'file:///repo-b' }
  ];
  const initial = new Map([['file:///repo-a', ['Build']], ['file:///repo-b', ['Test']]]);
  assert.deepEqual(missingWorkspaceTaskFolders(initial, snapshots), []);
  const afterRemoval = new Map([['file:///repo-a', ['Build']]]);
  assert.deepEqual(missingWorkspaceTaskFolders(afterRemoval, [snapshots[0]]), []);
  assert.deepEqual(missingWorkspaceTaskFolders(new Map(), []), []);
});
