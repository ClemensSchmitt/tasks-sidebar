import { applyEdits, findNodeAtLocation, getNodeValue, modify, parseTree, printParseErrorCode, type Node, type ParseError } from 'jsonc-parser';

export type TaskOutcome = 'success' | 'failed' | 'cancelled' | 'unknown' | 'stale';
export type ProgressState = 'unknown' | 'measured' | 'overtime' | 'completed' | 'failed' | 'cancelled' | 'stale';
export type DependencyOrder = 'sequence' | 'parallel';

export type TaskDependencySpec = {
  label: string;
  dependsOn: string[];
  dependsOrder: DependencyOrder;
};

export type DependencyState = 'running' | 'success' | 'failed' | 'cancelled' | 'unknown' | 'unresolved';

export type TaskBoardFilter = 'all' | 'running' | 'failed' | 'completed' | 'unknown' | 'external';
export type TaskBoardSort = 'name' | 'status' | 'elapsed' | 'folder';

export type TaskBoardViewItem = {
  id: string;
  name: string;
  source: string;
  group: string;
  tags?: string[];
  workspaceFolderName?: string;
  isRunning: boolean;
  elapsedMs: number;
  lastOutcome?: TaskOutcome;
  progressState?: ProgressState;
  executionId?: string;
};

export type DependencyChildObservation = {
  name: string;
  isRunning: boolean;
  lastOutcome?: TaskOutcome;
  dependencyState?: DependencyState;
};

export type RuntimeObservation = {
  stopRequested: boolean;
  taskEndSeen: boolean;
  processEndSeen: boolean;
  exitCode?: number;
  graceExpired: boolean;
  stale: boolean;
};

export type TaskExecutionLifecycle = 'running' | 'stopping' | 'awaiting-task-end' | 'stale';
export type TaskExecutionEvent =
  | { type: 'stop-requested' }
  | { type: 'termination-failed' }
  | { type: 'process-end'; exitCode?: number }
  | { type: 'task-end' }
  | { type: 'stale' }
  | { type: 'execution-observed' };

export type TaskExecutionObservation = {
  stopRequested: boolean;
  taskEndSeen: boolean;
  processEndSeen: boolean;
  exitCode?: number;
  stale?: boolean;
  lifecycle: TaskExecutionLifecycle;
};

/** Applies one VS Code task event without depending on event arrival order. */
export function applyTaskExecutionEvent(
  state: TaskExecutionObservation,
  event: TaskExecutionEvent
): TaskExecutionObservation {
  const next = { ...state };
  if (event.type === 'stop-requested') {
    next.stopRequested = true;
    if (!next.stale) next.lifecycle = 'stopping';
  } else if (event.type === 'termination-failed') {
    next.stopRequested = false;
    if (!next.stale) next.lifecycle = next.processEndSeen ? 'awaiting-task-end' : 'running';
  } else if (event.type === 'process-end') {
    next.processEndSeen = true;
    next.exitCode = event.exitCode;
    if (!next.stopRequested && !next.stale) next.lifecycle = 'awaiting-task-end';
  } else if (event.type === 'task-end') {
    next.taskEndSeen = true;
    if (next.processEndSeen && !next.stopRequested && !next.stale) next.lifecycle = 'awaiting-task-end';
  } else if (event.type === 'stale') {
    next.stale = true;
    next.lifecycle = 'stale';
  } else if (event.type === 'execution-observed' && next.stale && !next.taskEndSeen) {
    next.stale = false;
    if (!next.processEndSeen) next.stopRequested = false;
    next.lifecycle = next.processEndSeen ? 'awaiting-task-end' : 'running';
  }
  return next;
}

export type DiscoveryFailureKind = 'empty-workspace' | 'invalid-json' | 'permission' | 'provider' | 'unknown';

export function classifyDiscoveryFailure(input: {
  hasWorkspace: boolean;
  jsonValid?: boolean;
  permissionDenied?: boolean;
  providerFailed?: boolean;
}): DiscoveryFailureKind {
  if (!input.hasWorkspace) return 'empty-workspace';
  if (input.permissionDenied) return 'permission';
  if (input.jsonValid === false) return 'invalid-json';
  if (input.providerFailed) return 'provider';
  return 'unknown';
}

/** Parses the JSONC dialect used by VS Code tasks.json files. */
export function parseJsonc(input: string): unknown {
  let output = '';
  let inString = false;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    const next = input[index + 1];
    if (lineComment) {
      if (character === '\n' || character === '\r') {
        lineComment = false;
        output += character;
      } else {
        output += ' ';
      }
      continue;
    }
    if (blockComment) {
      if (character === '*' && next === '/') {
        blockComment = false;
        output += '  ';
        index += 1;
      } else {
        output += character === '\n' || character === '\r' ? character : ' ';
      }
      continue;
    }
    if (inString) {
      output += character;
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '/' && next === '/') {
      lineComment = true;
      output += '  ';
      index += 1;
      continue;
    }
    if (character === '/' && next === '*') {
      blockComment = true;
      output += '  ';
      index += 1;
      continue;
    }
    if (character === '"') inString = true;
    output += character;
  }
  let withoutTrailingCommas = '';
  inString = false;
  escaped = false;
  for (let index = 0; index < output.length; index += 1) {
    const character = output[index];
    if (inString) {
      withoutTrailingCommas += character;
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      withoutTrailingCommas += character;
      continue;
    }
    if (character === ',') {
      let lookahead = index + 1;
      while (lookahead < output.length && /\s/.test(output[lookahead])) lookahead += 1;
      if (output[lookahead] === '}' || output[lookahead] === ']') continue;
    }
    withoutTrailingCommas += character;
  }
  return JSON.parse(withoutTrailingCommas);
}

/** Returns task provider types declared in a workspace tasks.json. */
export function parseTaskProviderTypes(input: string): string[] {
  try {
    const document = parseJsonc(input);
    if (!document || typeof document !== 'object' || !Array.isArray((document as { tasks?: unknown }).tasks)) return [];
    const types = new Set<string>();
    for (const task of (document as { tasks: unknown[] }).tasks) {
      if (task && typeof task === 'object' && 'type' in task && typeof (task as { type?: unknown }).type === 'string') {
        types.add((task as { type: string }).type);
      }
    }
    return [...types];
  } catch {
    return [];
  }
}

export function shouldCountSuccessfulRun(outcome: TaskOutcome | undefined, recovered: boolean): boolean {
  return outcome === 'success' && !recovered;
}

export function mergeProgressElapsed(previousElapsedMs: number, backendElapsedMs: number, projectedElapsedMs: number): number {
  return Math.max(0, previousElapsedMs, backendElapsedMs, projectedElapsedMs);
}

/** Shared regex validation contract, also mirrored in the isolated webview. */
export function compileTaskSearchRegex(query: string): RegExp {
  const expression = query;
  if (expression.length > 256) throw new Error('Regular expression is too long (maximum 256 characters).');
  return new RegExp(expression, 'i');
}

/**
 * Move one visible logical task among the visible positions in the persisted
 * workspace order. Non-visible tasks keep their relative positions.
 */
export function reorderVisibleTaskIds(
  order: readonly string[],
  visibleIds: readonly string[],
  movedId: string,
  targetId: string,
  after = false
): string[] {
  const uniqueOrder = [...new Set(order.filter(id => typeof id === 'string' && id.length > 0))];
  const known = new Set(uniqueOrder);
  const visible = [...new Set(visibleIds)].filter(id => known.has(id));
  if (!visible.includes(movedId) || !visible.includes(targetId) || movedId === targetId) {
    return uniqueOrder;
  }
  const nextVisible = visible.filter(id => id !== movedId);
  nextVisible.splice(nextVisible.indexOf(targetId) + (after ? 1 : 0), 0, movedId);
  const visibleSet = new Set(visible);
  let cursor = 0;
  return uniqueOrder.map(id => visibleSet.has(id) ? nextVisible[cursor++] : id);
}

/**
 * Keeps the webview's query/filter/sort semantics deterministic and testable.
 * The webview mirrors this small function because it runs in an isolated DOM.
 */
export function filterAndSortTaskSnapshots<T extends TaskBoardViewItem>(
  tasks: readonly T[],
  query = '',
  filter: TaskBoardFilter = 'all',
  sort: TaskBoardSort = 'name',
  tagFilter: string | readonly string[] = [],
  regexEnabled = false
): T[] {
  const needle = query.trim().toLocaleLowerCase();
  const pattern = regexEnabled && query.trim()
    ? compileTaskSearchRegex(query)
    : undefined;
  const selectedTags = (typeof tagFilter === 'string' ? [tagFilter] : tagFilter)
    .map(tag => tag.trim().toLocaleLowerCase()).filter(Boolean);
  const matchesFilter = (task: T): boolean => {
    if (filter === 'running') return task.isRunning;
    if (filter === 'failed') return task.lastOutcome === 'failed';
    if (filter === 'completed') return task.lastOutcome === 'success';
    if (filter === 'unknown') return task.lastOutcome === 'unknown' || task.lastOutcome === 'stale' || task.progressState === 'unknown';
    if (filter === 'external') return task.source !== 'Workspace';
    return true;
  };
  const matchesTag = (task: T): boolean => {
    return selectedTags.every(selectedTag =>
      (task.tags ?? []).some(tag => tag.trim().toLocaleLowerCase() === selectedTag));
  };
  const matchesQuery = (task: T): boolean => {
    if (!needle) return true;
    const fields = [task.name, task.source, task.group, task.workspaceFolderName ?? '', ...(task.tags ?? [])];
    if (pattern) return fields.some(field => pattern.test(String(field).slice(0, 2048)));
    return fields.join(' ').toLocaleLowerCase().includes(needle);
  };
  const compareText = (left: string, right: string): number => left.localeCompare(right) || 0;
  const statusRank = (task: T): number => task.isRunning ? 0 : task.lastOutcome === 'failed' ? 1 : task.lastOutcome === 'unknown' || task.lastOutcome === 'stale' ? 2 : task.lastOutcome === 'success' ? 3 : 4;
  const filtered = tasks.filter(task => matchesFilter(task) && matchesTag(task) && matchesQuery(task));
  return filtered.slice().sort((left, right) => {
    let result = 0;
    if (sort === 'status') result = statusRank(left) - statusRank(right);
    else if (sort === 'elapsed') result = right.elapsedMs - left.elapsedMs;
    else if (sort === 'folder') result = compareText(left.workspaceFolderName ?? '', right.workspaceFolderName ?? '');
    if (!result) result = compareText(left.name, right.name);
    if (!result) result = compareText(left.source, right.source);
    if (!result) result = compareText(left.id, right.id);
    if (!result) result = compareText(left.executionId ?? '', right.executionId ?? '');
    return result;
  });
}

export type HistoryPlanRecord = {
  lastDurationMs?: number;
  durationsMs?: number[];
};

export type HistoryRetentionRecord = {
  lastUpdatedAt?: number;
  lastCompletedAt?: number;
};

export function calculateElapsedMs(startedAt: number, now: number): number {
  return Math.max(0, now - startedAt);
}

export function calculatePlanDuration(record: HistoryPlanRecord): number | undefined {
  if (typeof record.lastDurationMs === 'number' && Number.isFinite(record.lastDurationMs) && record.lastDurationMs > 0) {
    return record.lastDurationMs;
  }
  const latestSample = record.durationsMs?.find(sample => Number.isFinite(sample) && sample > 0);
  return latestSample;
}

export function calculateProgressPercent(elapsedMs: number, plannedMs: number | undefined, isRunning: boolean): number {
  if (!plannedMs || plannedMs <= 0) return 0;
  const value = isRunning ? elapsedMs : plannedMs;
  return Math.min(100, Math.max(0, value / plannedMs * 100));
}

export function calculateProgressState(input: {
  isRunning: boolean;
  elapsedMs: number;
  plannedMs?: number;
  lastOutcome?: TaskOutcome;
}): ProgressState {
  if (input.isRunning) {
    if (!input.plannedMs || input.plannedMs <= 0) return 'unknown';
    return input.elapsedMs > input.plannedMs ? 'overtime' : 'measured';
  }
  if (input.lastOutcome === 'failed') return 'failed';
  if (input.lastOutcome === 'cancelled') return 'cancelled';
  if (input.lastOutcome === 'stale') return 'stale';
  if (input.lastOutcome === 'unknown') return 'unknown';
  if (input.lastOutcome === 'success') return 'completed';
  return 'unknown';
}

export function selectRecentHistoryKeys<T extends HistoryRetentionRecord>(
  history: Record<string, T>,
  maxEntries: number
): string[] {
  return Object.entries(history)
    .sort((left, right) => {
      const leftUpdated = left[1].lastUpdatedAt ?? left[1].lastCompletedAt ?? 0;
      const rightUpdated = right[1].lastUpdatedAt ?? right[1].lastCompletedAt ?? 0;
      return rightUpdated - leftUpdated || left[0].localeCompare(right[0]);
    })
    .slice(0, Math.max(0, maxEntries))
    .map(([key]) => key);
}

export type PersistedTaskObservation = {
  logicalId: string;
  workspaceFolderUri?: string;
  observedAt: number;
};

export function observationKey(logicalId: string, workspaceFolderUri?: string): string {
  return (workspaceFolderUri ?? 'global') + ':' + logicalId;
}

/**
 * Checks how many configured built-in workspace tasks are still missing from
 * VS Code's fetched task registry. Startup discovery can return a partial list
 * while additional multi-root task folders initialize.
 *
 * Only explicitly configured, built-in labels are used as completeness hints:
 * custom task-provider types need not be resolvable at every instant.
 */
export function missingWorkspaceTaskFolders(
  expectedLabelsByFolder: ReadonlyMap<string, readonly string[]>,
  discovered: readonly { workspaceFolderUri?: string; name: string; source: string }[]
): string[] {
  const known = new Map<string, Set<string>>();
  for (const task of discovered) {
    if (task.source !== 'Workspace' || !task.workspaceFolderUri) continue;
    let labels = known.get(task.workspaceFolderUri);
    if (!labels) {
      labels = new Set<string>();
      known.set(task.workspaceFolderUri, labels);
    }
    labels.add(task.name);
  }
  const missing: string[] = [];
  for (const [folderUri, configuredLabels] of expectedLabelsByFolder) {
    if (configuredLabels.length && configuredLabels.some(label => !known.get(folderUri)?.has(label))) {
      missing.push(folderUri);
    }
  }
  return missing;
}

export function isWorkspaceFolderVisible(
  workspaceFolderUri: string | undefined,
  currentWorkspaceFolderUris: Iterable<string>,
  includeGlobal: boolean
): boolean {
  if (!workspaceFolderUri) return includeGlobal;
  for (const currentUri of currentWorkspaceFolderUris) {
    if (currentUri === workspaceFolderUri) return true;
  }
  return false;
}

/**
 * Keeps an observation pending while a reload may still be catching up.
 * Multiple live keys are counted so parallel executions are reconciled one by one.
 */
export function reconcilePersistedObservations<T extends PersistedTaskObservation>(
  observations: T[],
  liveExecutionKeys: Iterable<string>,
  now: number,
  timeoutMs: number
): { pending: T[]; unknown: T[] } {
  const liveCounts = new Map<string, number>();
  for (const key of liveExecutionKeys) liveCounts.set(key, (liveCounts.get(key) ?? 0) + 1);
  const pending: T[] = [];
  const unknown: T[] = [];
  for (const observation of observations) {
    const key = observationKey(observation.logicalId, observation.workspaceFolderUri);
    const liveCount = liveCounts.get(key) ?? 0;
    if (liveCount > 0) {
      liveCounts.set(key, liveCount - 1);
      continue;
    }
    if (Math.max(0, now - observation.observedAt) < timeoutMs) pending.push(observation);
    else unknown.push(observation);
  }
  return { pending, unknown };
}

export function parseTaskTags(input: unknown): Record<string, string[]> {
  if (!input || typeof input !== 'object' || !Array.isArray((input as { tasks?: unknown }).tasks)) return {};
  const tagsByLabel: Record<string, string[]> = Object.create(null) as Record<string, string[]>;
  for (const rawTask of (input as { tasks: unknown[] }).tasks) {
    if (!rawTask || typeof rawTask !== 'object') continue;
    const task = rawTask as { label?: unknown; taskName?: unknown; tags?: unknown };
    const label = typeof task.label === 'string' ? task.label : typeof task.taskName === 'string' ? task.taskName : undefined;
    if (!label || !Array.isArray(task.tags)) continue;
    const seen = new Set<string>();
    const tags = task.tags
      .filter((tag): tag is string => typeof tag === 'string')
      .map(tag => tag.trim())
      .filter(tag => {
        const key = tag.toLocaleLowerCase();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    if (tags.length) {
      Object.defineProperty(tagsByLabel, label, { value: tags, enumerable: true, configurable: true, writable: true });
    }
  }
  return tagsByLabel;
}

export function parseTaskDependencySpecs(input: unknown): Record<string, TaskDependencySpec> {
  if (!input || typeof input !== 'object' || !Array.isArray((input as { tasks?: unknown }).tasks)) return {};
  const specs: Record<string, TaskDependencySpec> = {};
  for (const rawTask of (input as { tasks: unknown[] }).tasks) {
    if (!rawTask || typeof rawTask !== 'object') continue;
    const task = rawTask as { label?: unknown; taskName?: unknown; dependsOn?: unknown; dependsOrder?: unknown };
    const label = typeof task.label === 'string' ? task.label : typeof task.taskName === 'string' ? task.taskName : undefined;
    if (!label) continue;
    const dependsOn = Array.isArray(task.dependsOn)
      ? task.dependsOn.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      : typeof task.dependsOn === 'string' && task.dependsOn.trim().length > 0
        ? [task.dependsOn]
        : [];
    specs[label] = {
      label,
      dependsOn,
      dependsOrder: task.dependsOrder === 'sequence' ? 'sequence' : 'parallel'
    };
  }
  return specs;
}

export function resolveDependencyState(
  dependsOn: string[],
  dependencyIds: string[],
  children: DependencyChildObservation[],
  dependsOrder: DependencyOrder = 'parallel'
): { state: DependencyState; failure?: string } | undefined {
  if (!dependsOn.length) return undefined;
  if (dependsOrder === 'sequence') {
    for (const dependencyName of dependsOn) {
      const matchingChildren = children.filter(child => child.name === dependencyName);
      if (!matchingChildren.length) return { state: 'unresolved', failure: dependencyName };
      if (matchingChildren.some(child => child.isRunning || child.dependencyState === 'running')) return { state: 'running' };
      const failed = matchingChildren.find(child => child.lastOutcome === 'failed' || child.dependencyState === 'failed');
      if (failed) return { state: 'failed', failure: failed.name };
      const cancelled = matchingChildren.find(child => child.lastOutcome === 'cancelled' || child.dependencyState === 'cancelled');
      if (cancelled) return { state: 'cancelled', failure: cancelled.name };
      const unknown = matchingChildren.find(child => child.lastOutcome === 'unknown' || child.lastOutcome === 'stale' || child.dependencyState === 'unknown');
      if (unknown) return { state: 'unknown', failure: unknown.name };
      if (!matchingChildren.every(child => child.lastOutcome === 'success' || child.dependencyState === 'success')) {
        return { state: 'unresolved', failure: dependencyName };
      }
    }
    return { state: 'success' };
  }
  const completedChildren = children.filter(child => !child.isRunning);
  const failed = completedChildren.find(child => child.lastOutcome === 'failed' || child.dependencyState === 'failed');
  const cancelled = completedChildren.find(child => child.lastOutcome === 'cancelled' || child.dependencyState === 'cancelled');
  const unknown = completedChildren.find(child => child.lastOutcome === 'unknown' || child.lastOutcome === 'stale' || child.dependencyState === 'unknown');
  const running = children.some(child => child.isRunning || child.dependencyState === 'running');
  const missing = dependencyIds.length !== dependsOn.length;
  if (failed) return { state: 'failed', failure: failed.name };
  if (cancelled) return { state: 'cancelled', failure: cancelled.name };
  if (unknown) return { state: 'unknown', failure: unknown.name };
  if (missing || children.length < dependencyIds.length || children.some(child => !child.lastOutcome && !child.isRunning)) {
    return {
      state: 'unresolved',
      failure: dependsOn.find(name => !children.some(child => child.name === name))
    };
  }
  if (running) return { state: 'running' };
  if (children.every(child => child.lastOutcome === 'success' || child.dependencyState === 'success')) return { state: 'success' };
  return { state: 'unresolved' };
}

export function isSupportedVSCodeVersion(version: string, minimum = '1.85.0'): boolean {
  const parse = (value: string): number[] | undefined => {
    const match = value.match(/^(\d+)\.(\d+)(?:\.(\d+))?/);
    return match ? [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)] : undefined;
  };
  const current = parse(version);
  const required = parse(minimum);
  if (!current || !required) return false;
  for (let index = 0; index < 3; index += 1) {
    if (current[index] !== required[index]) return current[index] > required[index];
  }
  return true;
}

function serializeDefinition(definition: unknown, seen = new WeakSet<object>(), stripPresentationFields = false): string {
  if (definition === null || typeof definition !== 'object') {
    return JSON.stringify(definition) ?? String(definition);
  }
  if (seen.has(definition)) return '[Circular]';
  seen.add(definition);
  let serialized: string;
  try {
    if (Array.isArray(definition)) {
      serialized = '[' + definition.map(item => serializeDefinition(item, seen, stripPresentationFields)).join(',') + ']';
    } else {
      serialized = '{' + Object.keys(definition)
        .filter(key => !stripPresentationFields || (key !== 'label' && key !== 'taskName'))
        .sort()
        .map(key => JSON.stringify(key) + ':' + serializeDefinition((definition as Record<string, unknown>)[key], seen, stripPresentationFields))
        .join(',') + '}';
    }
  } catch {
    serialized = String((definition as { type?: unknown }).type ?? 'unknown');
  }
  seen.delete(definition);
  return serialized;
}

/**
 * A logical task identifies one task definition as presented by VS Code.
 * Name or definition edits intentionally create a new logical task and orphan the old run.
 */
export function createLogicalTaskId(source: string, name: string, scope: string, definition: unknown): string {
  return source + ':' + name + ':' + scope + ':' + serializeDefinition(definition);
}

/**
 * History identity describes task behavior, not its display label.
 * Definition changes create a new plan; renames with unchanged behavior keep it.
 */
export function createHistoryTaskId(source: string, scope: string, definition: unknown): string {
  return source + ':' + scope + ':' + serializeDefinition(definition, new WeakSet<object>(), true);
}

export function createHistoryMigrationSuffix(scope: string, definition: unknown): string {
  return ':' + scope + ':' + serializeLegacyDefinition(definition);
}

/** ID format used before runtime identity was separated, for history migration. */
export function createLegacyTaskId(source: string, name: string, scope: string, definition: unknown): string {
  return source + ':' + name + ':' + scope + ':' + serializeLegacyDefinition(definition);
}

function serializeLegacyDefinition(definition: unknown): string {
  try {
    return JSON.stringify(definition) ?? String(definition);
  } catch {
    return String((definition as { type?: unknown } | undefined)?.type ?? 'unknown');
  }
}

/** Selects the current history key first and falls back to legacy/migratable keys. */
export function selectHistoryKey(
  historyKeys: Iterable<string>,
  logicalId: string,
  legacyLogicalId: string,
  historyId?: string,
  legacySuffix?: string
): string | undefined {
  const keys = new Set(historyKeys);
  if (historyId && keys.has(historyId)) return historyId;
  if (keys.has(logicalId)) return logicalId;
  if (keys.has(legacyLogicalId)) return legacyLogicalId;
  if (legacySuffix) return Array.from(keys).find(key => key.endsWith(legacySuffix));
  return undefined;
}

/**
 * Resolves the most conservative outcome from the observations available so far.
 * A missing exit code is deliberately never treated as success.
 */
export function resolveTaskOutcome(observation: RuntimeObservation): TaskOutcome {
  if (observation.stale) return 'stale';
  if (observation.stopRequested && observation.taskEndSeen) return 'cancelled';
  if (observation.processEndSeen) {
    if (observation.exitCode === undefined) return 'unknown';
    return observation.exitCode === 0 ? 'success' : 'failed';
  }
  if (observation.taskEndSeen || observation.graceExpired) return 'unknown';
  return 'stale';
}

/** Whether the task-end observation has enough evidence to finalize a run. */
export function shouldFinalizeTask(observation: RuntimeObservation): boolean {
  return observation.taskEndSeen && (observation.processEndSeen || observation.graceExpired || observation.stale);
}

/** UI policy: one logical task start is serialized, while external executions remain observable. */
export function shouldAllowStart(isStarting: boolean, hasLiveExecution: boolean): boolean {
  return !isStarting && !hasLiveExecution;
}

/** Background tasks are intentionally open-ended; a missing execution is still bounded. */
export function shouldScheduleStaleCheck(isBackground: boolean, stopRequested: boolean, taskEndSeen: boolean, executionMissing = false): boolean {
  return !taskEndSeen && (executionMissing || !isBackground || stopRequested);
}

/** Prevents an older asynchronous refresh result from publishing over a newer one. */
export function isCurrentRefresh(requestRevision: number, currentRevision: number): boolean {
  return requestRevision === currentRevision;
}

export type TaskFileKind = 'folder' | 'workspace';

/** Parse without recovery: edits and navigation must never use a guessed JSONC tree. */
function taskDocumentTree(input: string): Node {
  const errors: ParseError[] = [];
  // A BOM is trivia; replacing it keeps all source offsets unchanged.
  const root = parseTree(input.replace(/^\uFEFF/, ' '), errors, { allowTrailingComma: true });
  if (errors.length) {
    throw new Error(`Invalid JSONC: ${printParseErrorCode(errors[0].error)} at offset ${errors[0].offset}. Fix the syntax and retry.`);
  }
  if (!root || root.type !== 'object') throw new Error('The task configuration must be a JSON object.');
  const checkKeys = (node: Node): void => {
    if (node.type === 'object') {
      const keys = new Set<string>();
      for (const property of node.children ?? []) {
        const key = property.children![0].value as string;
        if (keys.has(key)) throw new Error(`Duplicate JSON property "${key}". Remove the ambiguity and retry.`);
        keys.add(key);
      }
    }
    for (const child of node.children ?? []) checkKeys(child);
  };
  checkKeys(root);
  return root;
}

export function parseTaskDocument(input: string): unknown {
  return getNodeValue(taskDocumentTree(input));
}

/** Select only the unique task at the explicit configuration path, preserving offsets. */
export function findTaskDefinitionRange(input: string, name: string, kind: TaskFileKind = 'folder'): { start: number; end: number } | undefined {
  const root = taskDocumentTree(input);
  const tasks = findNodeAtLocation(root, kind === 'workspace' ? ['tasks', 'tasks'] : ['tasks']);
  if (tasks?.type !== 'array') return undefined;
  const matches = (tasks.children ?? []).filter(node => {
    if (node.type !== 'object') return false;
    const task = getNodeValue(node) as { label?: unknown; taskName?: unknown };
    return (task.label ?? task.taskName) === name;
  });
  return matches.length === 1 ? { start: matches[0].offset, end: matches[0].offset + matches[0].length } : undefined;
}

/** Append with local JSONC edits; preserve existing comments, tasks and unrelated settings. */
export function appendShellTask(input: string, label: string, command: string, kind: TaskFileKind = 'folder'): string {
  if (!label.trim() || !command.trim()) throw new Error('Enter a task label and shell command.');
  const root = taskDocumentTree(input);
  const configPath = kind === 'workspace' ? ['tasks'] : [];
  const config = findNodeAtLocation(root, configPath);
  if (config && config.type !== 'object') throw new Error('The tasks configuration must be an object.');
  const tasksPath = [...configPath, 'tasks'];
  const tasks = findNodeAtLocation(root, tasksPath);
  if (tasks && tasks.type !== 'array') throw new Error('The tasks configuration must contain a tasks array.');
  const version = config && findNodeAtLocation(config, ['version']);
  if (version && (version.type !== 'string' || version.value !== '2.0.0')) {
    throw new Error('Task creation requires version "2.0.0". Update the task configuration and retry.');
  }
  const task = { label: label.trim(), type: 'shell', command: command.trim() };
  const indentation = input.match(/(?:^|\n)([ \t]+)"/)?.[1];
  const options = { formattingOptions: {
    insertSpaces: !indentation?.includes('\t'),
    tabSize: indentation && !indentation.includes('\t') ? indentation.length : 2,
    eol: input.includes('\r\n') ? '\r\n' : '\n'
  } };
  let result = input;
  if (!config) {
    result = applyEdits(result, modify(result, configPath, { version: '2.0.0', tasks: [task] }, options));
  } else {
    if (!version) result = applyEdits(result, modify(result, [...configPath, 'version'], '2.0.0', options));
    result = applyEdits(result, modify(result, tasks ? [...tasksPath, -1] : tasksPath, tasks ? task : [task], options));
  }
  taskDocumentTree(result);
  return result;
}
