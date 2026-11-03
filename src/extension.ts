import * as vscode from 'vscode';
import { applyTaskExecutionEvent, calculateElapsedMs, calculatePlanDuration, calculateProgressPercent, calculateProgressState, classifyDiscoveryFailure, createHistoryMigrationSuffix, createHistoryTaskId, createLegacyTaskId, createLogicalTaskId, isCurrentRefresh, isSupportedVSCodeVersion, isWorkspaceFolderVisible, missingWorkspaceTaskFolders, observationKey, findTaskDefinitionRange, parseJsonc, parseTaskDependencySpecs, parseTaskProviderTypes, parseTaskTags, reconcilePersistedObservations, resolveDependencyState, resolveTaskOutcome, selectHistoryKey, selectRecentHistoryKeys, shouldAllowStart, shouldCountSuccessfulRun, shouldScheduleStaleCheck, type DependencyOrder, type DependencyState, type PersistedTaskObservation, type ProgressState, type TaskDependencySpec, type TaskExecutionLifecycle, type TaskOutcome } from './runtime';

type TaskLifecycle = TaskExecutionLifecycle;
type TaskHistory = {
  lastDurationMs?: number;

  lastCompletedAt?: number;
  lastUpdatedAt?: number;
  lastOutcome?: TaskOutcome;
  lastExitCode?: number;
  runCount: number;
  durationsMs: number[];
};

type ActiveTask = {
  executionId: string;
  logicalId: string;
  legacyLogicalId: string;
  historyId: string;
  historyMigrationSuffix: string;
  execution: vscode.TaskExecution;
  startedAtMonotonic: number;
  observedAt: number;
  name: string;
  source: string;
  group: string;
  isBackground: boolean;
  workspaceFolderUri?: string;
  workspaceFolderName?: string;
  workspaceScoped?: boolean;
  dependsOn: string[];
  dependsOrder: DependencyOrder;
  dependencyIds: string[];
  lifecycle: TaskLifecycle;
  stopRequested: boolean;
  recovered: boolean;
  processEndSeen: boolean;
  taskEndSeen: boolean;
  exitCode?: number;
  finishTimer?: NodeJS.Timeout;
  staleTimer?: NodeJS.Timeout;
  restartRequested: boolean;
};

type TaskMetadata = {
  logicalId: string;
  legacyLogicalId: string;
  historyId: string;
  historyMigrationSuffix: string;
  name: string;
  source: string;
  group: string;
  tags: string[];
  isBackground: boolean;
  workspaceFolderUri?: string;
  workspaceFolderName?: string;
  workspaceScoped?: boolean;
  dependsOn: string[];
  dependsOrder: DependencyOrder;
  dependencyIds: string[];
};

type WorkspaceTaskSpecs = {
  dependencies: Record<string, TaskDependencySpec>;
  tags: Record<string, string[]>;
  configuredBuiltInLabels: string[];
};

type TaskSnapshot = {
  id: string;
  name: string;
  source: string;
  group: string;
  tags?: string[];
  isBackground: boolean;
  workspaceFolderUri?: string;
  workspaceFolderName?: string;
  workspaceScoped?: boolean;
  dependsOn: string[];
  dependsOrder: DependencyOrder;
  dependencyIds: string[];
  dependencyState?: DependencyState;
  dependencyFailure?: string;
  isDependency: boolean;
  isRunning: boolean;
  elapsedMs: number;
  plannedMs?: number;
  lastDurationMs?: number;
  runCount: number;
  progress: number;
  progressState: ProgressState;
  overtimeMs?: number;
  isStopping: boolean;
  lastOutcome?: TaskOutcome;

  lastExitCode?: number;
  executionId?: string;
  lifecycle: TaskLifecycle | 'idle';
  orphaned: boolean;
  elapsedBasis: 'measured' | 'since-reload';
};

type PersistedActiveObservation = PersistedTaskObservation & {
  legacyLogicalId: string;
  historyId: string;
  historyMigrationSuffix: string;
  name: string;
  source: string;
};

const HISTORY_KEY = 'tasksSidebar.history';
const LAST_GOOD_KEY = 'tasksSidebar.lastGoodSnapshots';
const CUSTOM_ORDER_KEY = 'tasksSidebar.customTaskOrder';
const ACTIVE_OBSERVATIONS_KEY = 'tasksSidebar.activeObservations';
const MAX_HISTORY_ENTRIES = 20;
const MAX_HISTORY_RECORDS = 200;
const END_EVENT_GRACE_MS = 1000;
const END_EVENT_TIMEOUT_MS = 10000;
const STOP_TIMEOUT_MS = 10000;
const MIN_VSCODE_VERSION = '1.85.0';
const NORMAL_DISCOVERY_POLL_MS = 60000;
const PARTIAL_DISCOVERY_BACKOFF_MS = [1500, 4000, 10000, 30000, 60000];

export function activate(context: vscode.ExtensionContext): void {
  if (!isSupportedVSCodeVersion(vscode.version, MIN_VSCODE_VERSION)) {
    void vscode.window.showErrorMessage(`[${hostLabel()}] Tasks Sidebar requires Visual Studio Code ${MIN_VSCODE_VERSION} or newer. Current version: ${vscode.version}.`);
    return;
  }
  const board = new TaskBoard(context);
  const view = new TaskBoardView(context.extensionUri, String(context.extension.packageJSON.version || 'dev'), hostLabel(), board);
  board.attachView(view);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('tasksSidebar.view', view, {
      webviewOptions: { retainContextWhenHidden: true }
    }),
    vscode.commands.registerCommand('tasksSidebar.refresh', () => board.refresh()),
    vscode.commands.registerCommand('tasksSidebar.openTasksJson', () => board.openTasksJson()),
    vscode.commands.registerCommand('tasksSidebar.createTask', () => board.createTask()),
    vscode.commands.registerCommand('tasksSidebar.toggleExternalTasks', () => board.toggleExternalTasks()),
    vscode.tasks.onDidStartTask(event => board.started(event.execution)),
    vscode.tasks.onDidEndTaskProcess(event => board.processEnded(event.execution, event.exitCode)),
    vscode.tasks.onDidEndTask(event => board.ended(event.execution)),
    vscode.workspace.onDidChangeWorkspaceFolders(() => board.workspaceChanged()),
    vscode.workspace.onDidSaveTextDocument(document => {
      const path = document.uri.path.replace(/\\/g, '/').toLowerCase();
      if (path.endsWith('/.vscode/tasks.json')) void board.refresh();
    }),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('tasksSidebar.includeExternalTasks')) void board.refresh();
    }),
    { dispose: () => board.dispose() }
  );
  const tasksWatcher = vscode.workspace.createFileSystemWatcher('**/.vscode/tasks.json');
  context.subscriptions.push(
    tasksWatcher,
    tasksWatcher.onDidChange(() => { void board.refresh(); }),
    tasksWatcher.onDidCreate(() => { void board.refresh(); }),
    tasksWatcher.onDidDelete(() => { void board.refresh(); })
  );

  board.rehydrateRunningTasks();
  board.refresh();
}

export function deactivate(): void {}

export class TaskBoard {
  private view?: TaskBoardView;
  private timer?: NodeJS.Timeout;
  private discoveryTimer?: NodeJS.Timeout;
  private incompleteDiscoveryAttempts = 0;
  private disposed = false;
  private readonly running = new Map<string, ActiveTask>();
  private readonly executionIds = new WeakMap<vscode.TaskExecution, string>();
  private readonly starting = new Set<string>();
  private readonly history: Record<string, TaskHistory>;
  private customTaskOrder: string[];
  private nextExecutionNumber = 1;
  private refreshRevision = 0;
  private lastPublishedSnapshots: TaskSnapshot[] = [];
  private lastPublishedWarning?: string;
  private lastPublishedAtMonotonic = 0;
  private lastGoodSnapshots: TaskSnapshot[];
  private lastGoodCacheSignature: string;
  private pendingActiveObservations: PersistedActiveObservation[];
  private activeObservationSignature = '';

  constructor(private readonly context: vscode.ExtensionContext) {
    const savedOrder = context.workspaceState.get<unknown>(CUSTOM_ORDER_KEY, []);
    this.customTaskOrder = Array.isArray(savedOrder)
      ? [...new Set(savedOrder.filter((id): id is string => typeof id === 'string' && id.trim().length > 0))].slice(0, 10000)
      : [];
    const storedHistory = context.workspaceState.get<Record<string, TaskHistory>>(HISTORY_KEY, {});
    this.history = storedHistory && typeof storedHistory === 'object' ? storedHistory : {};
    const historyKeyCount = Object.keys(this.history).length;
    pruneHistory(this.history);
    if (Object.keys(this.history).length !== historyKeyCount) {
      void Promise.resolve(context.workspaceState.update(HISTORY_KEY, this.history))
        .catch(error => this.reportError('The old task history could not be pruned.', error));
    }
    const storedSnapshots = context.workspaceState.get<TaskSnapshot[]>(LAST_GOOD_KEY, []);
    this.lastGoodSnapshots = Array.isArray(storedSnapshots) ? storedSnapshots : [];
    this.lastGoodCacheSignature = JSON.stringify(this.lastGoodSnapshots);
    const storedObservations = context.workspaceState.get<PersistedActiveObservation[]>(ACTIVE_OBSERVATIONS_KEY, []);
    this.pendingActiveObservations = Array.isArray(storedObservations) ? storedObservations : [];
    this.activeObservationSignature = JSON.stringify(this.pendingActiveObservations);
    // Elapsed time updates must never restart task discovery. A slow provider can
    // otherwise be cancelled indefinitely by the next one-second refresh.
    this.timer = setInterval(() => this.tickElapsed(), 1000);
  }

  attachView(view: TaskBoardView): void {
    this.view = view;
  }

  getCustomTaskOrder(): string[] {
    return [...this.customTaskOrder];
  }

  async updateCustomTaskOrder(value: unknown): Promise<void> {
    if (!Array.isArray(value) || value.length > 10000 ||
        !value.every(id => typeof id === 'string' && id.length > 0 && id.length <= 2048) ||
        new Set(value).size !== value.length) {
      throw new Error('Invalid custom task order.');
    }
    const previousOrder = this.customTaskOrder;
    this.customTaskOrder = [...value];
    try {
      await this.context.workspaceState.update(CUSTOM_ORDER_KEY, this.customTaskOrder);
    } catch (error) {
      this.customTaskOrder = previousOrder;
      this.view?.render(this.lastPublishedSnapshots, this.lastPublishedWarning);
      this.reportError('The custom task order could not be saved.', error);
    }
  }

  rehydrateRunningTasks(): void {
    for (const execution of vscode.tasks.taskExecutions) this.begin(execution, true);
    this.reconcilePersistedObservations();
    this.persistActiveObservations();
  }

  workspaceChanged(): void {
    void this.refresh();
  }

  async refresh(): Promise<void> {
    await this.publish();
  }

  // Provider discovery is not always complete when onStartupFinished fires.
  // A single retry timer is independent from the one-second elapsed-time tick.
  private scheduleNextDiscovery(incomplete: boolean): void {
    if (this.discoveryTimer) clearTimeout(this.discoveryTimer);
    if (this.disposed) return;
    this.incompleteDiscoveryAttempts = incomplete ? this.incompleteDiscoveryAttempts + 1 : 0;
    const delay = incomplete
      ? PARTIAL_DISCOVERY_BACKOFF_MS[Math.min(this.incompleteDiscoveryAttempts - 1, PARTIAL_DISCOVERY_BACKOFF_MS.length - 1)]
      : NORMAL_DISCOVERY_POLL_MS;
    this.discoveryTimer = setTimeout(() => {
      this.discoveryTimer = undefined;
      void this.refresh();
    }, delay);
  }

  private renderSnapshot(snapshots: TaskSnapshot[], warning?: string): void {
    this.lastPublishedSnapshots = snapshots;
    this.lastPublishedWarning = warning;
    this.lastPublishedAtMonotonic = monotonicNow();
    this.view?.render(snapshots, warning);
  }

  private tickElapsed(): void {
    // Reconcile the inexpensive execution registry every second without
    // re-running provider discovery; lost end events can then become stale.
    if (!this.disposed && this.running.size) this.reconcileRunningExecutions();
    if (this.disposed || !this.view || !this.lastPublishedSnapshots.some(snapshot => snapshot.isRunning)) return;
    const delta = Math.max(0, monotonicNow() - this.lastPublishedAtMonotonic);
    const updated = this.lastPublishedSnapshots.map(snapshot => {
      if (!snapshot.isRunning) return snapshot;
      const elapsedMs = snapshot.elapsedMs + delta;
      const plannedMs = snapshot.plannedMs;
      return {
        ...snapshot,
        elapsedMs,
        progress: calculateProgressPercent(elapsedMs, plannedMs, true),
        progressState: calculateProgressState({
          isRunning: true, elapsedMs, plannedMs, lastOutcome: snapshot.lastOutcome
        }),
        overtimeMs: plannedMs && elapsedMs > plannedMs ? elapsedMs - plannedMs : undefined
      };
    });
    this.view.render(updated, this.lastPublishedWarning);
  }

  async toggleExternalTasks(): Promise<void> {
    try {
      const configuration = vscode.workspace.getConfiguration('tasksSidebar');
      const current = configuration.get<boolean>('includeExternalTasks', false);
      await configuration.update('includeExternalTasks', !current, vscode.ConfigurationTarget.Workspace);
      await this.publish();
      void vscode.window.showInformationMessage(
        !current ? 'External task providers are now visible.' : 'Only tasks from .vscode/tasks.json are now visible.'
      );
    } catch (error) {
      this.reportError('The external task provider setting could not be changed.', error);
    }
  }

  async run(id: string): Promise<void> {
    this.reconcileRunningExecutions();
    if (!shouldAllowStart(this.starting.has(id), this.hasActiveLogicalTask(id))) {
      void vscode.window.showInformationMessage('This task is already running.');
      return;
    }
    this.starting.add(id);
    let task: vscode.Task | undefined;
    try {
      task = await this.findTask(id);
    } catch {
      void vscode.window.showErrorMessage('Tasks could not be read. Refresh the view and try again.');
      this.starting.delete(id);
      return;
    }
    if (!task) {
      void vscode.window.showWarningMessage('This task is no longer available. Refresh the view.');
      this.starting.delete(id);
      return;
    }
    try {
      const execution = await vscode.tasks.executeTask(task);
      if (!this.activeForExecution(execution)) this.begin(execution);
      this.persistActiveObservations();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      void vscode.window.showErrorMessage('The task could not be started: ' + message);
      this.starting.delete(id);
      return;
    }
    this.starting.delete(id);
    await this.publish();
  }

  async restart(id: string): Promise<void> {
    const active = this.running.get(id) ?? Array.from(this.running.values()).find(item => item.logicalId === id);
    if (!active) {
      await this.run(id);
      return;
    }
    if (active.lifecycle === 'stopping') {
      void vscode.window.showInformationMessage('This task is already stopping.');
      return;
    }
    if (active.lifecycle === 'stale') {
      active.restartRequested = false;
      await this.run(active.logicalId);
      return;
    }
    active.restartRequested = true;
    if (active.lifecycle === 'awaiting-task-end') {
      await this.publish();
      return;
    }
    await this.stop(active.executionId);
  }

  async stop(executionId: string): Promise<void> {
    const active = this.running.get(executionId);
    if (active && active.lifecycle === 'running' && !active.stopRequested) {
      Object.assign(active, applyTaskExecutionEvent(active, { type: 'stop-requested' }));
      let terminationRequested = false;
      try {
        const termination = active.execution.terminate() as unknown;
        terminationRequested = true;
        if (termination && typeof (termination as { then?: unknown }).then === 'function') {
          void Promise.resolve(termination as PromiseLike<void>).catch(error => this.terminationFailed(active, error));
        }
      } catch {
        active.stopRequested = false;
        active.restartRequested = false;
        active.lifecycle = 'running';
        void vscode.window.showErrorMessage('The task could not be stopped.');
      }
      if (terminationRequested) this.scheduleStaleCheck(active, STOP_TIMEOUT_MS);
      await this.publish();
    }
  }

  started(execution: vscode.TaskExecution): void {
    this.begin(execution);
    this.persistActiveObservations();
    void this.publish();
  }

  processEnded(execution: vscode.TaskExecution, exitCode: number | undefined): void {
    const active = this.activeForExecution(execution);
    if (!active) return;
    Object.assign(active, applyTaskExecutionEvent(active, { type: 'process-end', exitCode }));
    if (active.taskEndSeen) {
      this.scheduleFinish(active, 0);
    } else if (shouldScheduleStaleCheck(active.isBackground, active.stopRequested, active.taskEndSeen)) {
      this.scheduleStaleCheck(active, END_EVENT_TIMEOUT_MS);
    }
  }

  ended(execution: vscode.TaskExecution): void {
    const active = this.activeForExecution(execution);
    if (!active) return;
    Object.assign(active, applyTaskExecutionEvent(active, { type: 'task-end' }));
    this.scheduleFinish(active, active.processEndSeen ? 0 : END_EVENT_GRACE_MS);
  }

  async openTasksJson(id?: string): Promise<void> {
    let folder = vscode.workspace.workspaceFolders?.[0];
    let selectedTask: vscode.Task | undefined;
    if (id) {
      let task: vscode.Task | undefined;
      try {
        task = await this.findTask(id);
      } catch (error) {
        this.reportError('The selected task could not be read.', error);
        return;
      }
      if (!task) {
        void vscode.window.showWarningMessage('This task is no longer available. Refresh the view.');
        return;
      }
      if (!isWorkspaceJsonTask(task)) {
        void vscode.window.showWarningMessage('This task is provided externally and has no editable workspace definition.');
        return;
      }
      selectedTask = task;
      if (task.scope === vscode.TaskScope.Workspace) {
        const workspaceFile = vscode.workspace.workspaceFile;
        if (!workspaceFile) {
          void vscode.window.showWarningMessage('There is no workspace configuration file for this task.');
          return;
        }
        try {
          const document = await vscode.workspace.openTextDocument(workspaceFile);
          const range = findTaskDefinitionRange(document.getText(), task.name);
          if (!range) {
            await vscode.window.showTextDocument(document);
            void vscode.window.showWarningMessage('The workspace task definition could not be located automatically.');
            return;
          }
          const selection = new vscode.Range(document.positionAt(range.start), document.positionAt(range.end));
          const editor = await vscode.window.showTextDocument(document, { selection });
          editor.revealRange(selection, vscode.TextEditorRevealType.InCenter);
        } catch (error) {
          this.reportError('The workspace task definition could not be opened.', error);
        }
        return;
      }
      const taskFolder = taskWorkspaceFolder(task);
      if (taskFolder.workspaceFolderUri) {
        folder = vscode.workspace.workspaceFolders?.find(item => item.uri.toString() === taskFolder.workspaceFolderUri);
      } else {
        void vscode.window.showWarningMessage('This task is provided externally and has no workspace tasks.json to edit.');
        return;
      }
    } else if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 1) {
      const selected = await vscode.window.showQuickPick(
        vscode.workspace.workspaceFolders.map(item => ({
          label: item.name,
          description: item.uri.toString(),
          folder: item
        })),
        { placeHolder: 'Choose the workspace folder for tasks.json' }
      );
      if (!selected) return;
      folder = selected.folder;
    }
    if (!folder) {
      void vscode.window.showInformationMessage('Open a workspace before editing tasks.json.');
      return;
    }
    let operation = 'checking tasks.json';
    try {
      const uri = vscode.Uri.joinPath(folder.uri, '.vscode', 'tasks.json');
      try {
        await vscode.workspace.fs.stat(uri);
      } catch (error) {
        if (!(error instanceof vscode.FileSystemError) || error.code !== 'FileNotFound') throw error;
        if (selectedTask) {
          void vscode.window.showWarningMessage('The selected task definition is missing. Refresh the view.');
          return;
        }
        operation = 'creating the .vscode folder';
        await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(folder.uri, '.vscode'));
        const template = '{\n  "version": "2.0.0",\n  "tasks": []\n}\n';
        operation = 'creating tasks.json';
        await vscode.workspace.fs.writeFile(uri, Buffer.from(template, 'utf8'));
      }
      operation = 'opening tasks.json';
      const document = await vscode.workspace.openTextDocument(uri);
      operation = 'showing tasks.json';
      if (selectedTask) {
        const range = findTaskDefinitionRange(document.getText(), selectedTask.name);
        if (!range) {
          void vscode.window.showWarningMessage('The selected task definition is missing or ambiguous. Refresh the view or open tasks.json manually.');
          return;
        }
        const selection = new vscode.Range(document.positionAt(range.start), document.positionAt(range.end));
        const editor = await vscode.window.showTextDocument(document, { selection });
        editor.revealRange(selection, vscode.TextEditorRevealType.InCenter);
      } else {
        await vscode.window.showTextDocument(document);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown file error';
      this.reportError('Error while ' + operation + '.', message);
    }
  }

  async createTask(): Promise<void> {
    let folder = vscode.workspace.workspaceFolders?.[0];
    if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 1) {
      const selected = await vscode.window.showQuickPick(
        vscode.workspace.workspaceFolders.map(item => ({ label: item.name, description: item.uri.toString(), folder: item })),
        { placeHolder: 'Choose the workspace folder for the new task' }
      );
      if (!selected) return;
      folder = selected.folder;
    }
    if (!folder) {
      void vscode.window.showInformationMessage('Open a workspace before creating a task.');
      return;
    }
    const label = await vscode.window.showInputBox({ prompt: 'Task label', placeHolder: 'build', validateInput: value => value.trim() ? undefined : 'Enter a task label.' });
    if (label === undefined) return;
    const command = await vscode.window.showInputBox({ prompt: 'Shell command', placeHolder: 'npm run build', validateInput: value => value.trim() ? undefined : 'Enter a command.' });
    if (command === undefined) return;
    const uri = vscode.Uri.joinPath(folder.uri, '.vscode', 'tasks.json');
    try {
      let parsed: { version?: string; tasks?: unknown[] } = { version: '2.0.0', tasks: [] };
      try {
        const contents = await vscode.workspace.fs.readFile(uri);
        parsed = parseJsonc(Buffer.from(contents).toString('utf8')) as { version?: string; tasks?: unknown[] };
      } catch (error) {
        if (!(error instanceof vscode.FileSystemError) || error.code !== 'FileNotFound') throw error;
      }
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.tasks)) {
        throw new Error('tasks.json must contain a top-level tasks array.');
      }
      parsed.version = parsed.version || '2.0.0';
      parsed.tasks.push({ label: label.trim(), type: 'shell', command: command.trim() });
      await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(folder.uri, '.vscode'));
      await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify(parsed, null, 2) + '\n', 'utf8'));
      const document = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(document);
      await this.refresh();
    } catch (error) {
      this.reportError('The task could not be created. Check tasks.json permissions and JSON syntax.', error);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.persistActiveObservations();
    if (this.timer) clearInterval(this.timer);
    if (this.discoveryTimer) clearTimeout(this.discoveryTimer);
    for (const active of this.running.values()) {
      if (active.finishTimer) clearTimeout(active.finishTimer);
      if (active.staleTimer) clearTimeout(active.staleTimer);
    }
  }

  private async findTask(id: string): Promise<vscode.Task | undefined> {
    const tasks = await vscode.tasks.fetchTasks();
    return tasks.find(task => taskId(task) === id);
  }

  private async workspaceTaskTypes(): Promise<string[]> {
    const types = new Set(['shell', 'process']);
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const uri = vscode.Uri.joinPath(folder.uri, '.vscode', 'tasks.json');
      try {
        const contents = await vscode.workspace.fs.readFile(uri);
        for (const type of parseTaskProviderTypes(Buffer.from(contents).toString('utf8'))) types.add(type);
      } catch {
        // File diagnostics are reported separately; a missing file needs no fallback provider.
      }
    }
    return [...types];
  }

  private async fetchTasksWithProviderFallback(): Promise<{ tasks: vscode.Task[]; providerFailed: boolean }> {
    try {
      return { tasks: await vscode.tasks.fetchTasks(), providerFailed: false };
    } catch (error) {
      const byType = await Promise.all((await this.workspaceTaskTypes()).map(async type => {
        try {
          return await vscode.tasks.fetchTasks({ type });
        } catch {
          return [];
        }
      }));
      const tasks = [...new Map(byType.flat().map(task => [taskId(task), task])).values()];
      if (!tasks.length) throw error;
      return { tasks, providerFailed: true };
    }
  }

  private begin(execution: vscode.TaskExecution, recovered = false): void {
    const existingId = this.executionIds.get(execution);
    if (existingId && this.running.has(existingId)) return;
    const executionId = existingId ?? `execution-${this.nextExecutionNumber++}`;
    const metadata = toMetadata(execution.task);
    this.executionIds.set(execution, executionId);
    this.running.set(executionId, {
      executionId,
      logicalId: metadata.logicalId,
      legacyLogicalId: metadata.legacyLogicalId,
      historyId: metadata.historyId,
      historyMigrationSuffix: metadata.historyMigrationSuffix,
      execution,
      startedAtMonotonic: monotonicNow(),
      observedAt: Date.now(),
      name: metadata.name,
      source: metadata.source,
      group: metadata.group,
      isBackground: metadata.isBackground,
      workspaceFolderUri: metadata.workspaceFolderUri,
      workspaceFolderName: metadata.workspaceFolderName,
      workspaceScoped: metadata.workspaceScoped,
      dependsOn: metadata.dependsOn,
      dependsOrder: metadata.dependsOrder,
      dependencyIds: metadata.dependencyIds,
      lifecycle: 'running',
      stopRequested: false,
      recovered,
      processEndSeen: false,
      taskEndSeen: false,
      restartRequested: false
    });
  }

  private persistActiveObservations(): void {
    const liveObservations = Array.from(this.running.values())
      .filter(active => active.lifecycle !== 'stale' && !active.taskEndSeen)
      .map(active => ({
        logicalId: active.logicalId,
        legacyLogicalId: active.legacyLogicalId,
        historyId: active.historyId,
        historyMigrationSuffix: active.historyMigrationSuffix,
        workspaceFolderUri: active.workspaceFolderUri,
        name: active.name,
        source: active.source,
        observedAt: active.observedAt
      } satisfies PersistedActiveObservation));
    const observations = [...this.pendingActiveObservations, ...liveObservations]
      .sort((left, right) => observationKey(left.logicalId, left.workspaceFolderUri).localeCompare(observationKey(right.logicalId, right.workspaceFolderUri)) || left.observedAt - right.observedAt);
    const signature = JSON.stringify(observations);
    if (signature === this.activeObservationSignature) return;
    this.activeObservationSignature = signature;
    void Promise.resolve(this.context.workspaceState.update(ACTIVE_OBSERVATIONS_KEY, observations))
      .catch(error => this.reportError('The observed task status could not be saved.', error));
  }

  private reconcilePersistedObservations(): void {
    if (!this.pendingActiveObservations.length) return;
    const liveKeys = Array.from(this.running.values())
      .filter(active => active.lifecycle !== 'stale' && !active.taskEndSeen)
      .map(active => observationKey(active.logicalId, active.workspaceFolderUri));
    const reconciliation = reconcilePersistedObservations(
      this.pendingActiveObservations,
      liveKeys,
      Date.now(),
      END_EVENT_TIMEOUT_MS
    );
    let historyChanged = false;
    for (const observation of reconciliation.unknown) {
      const ageMs = Math.max(0, Date.now() - observation.observedAt);
      const historyId = observation.historyId || observation.logicalId;
      const selectedHistoryKey = findHistoryKey(
        this.history,
        observation.logicalId,
        observation.legacyLogicalId,
        historyId,
        observation.historyMigrationSuffix
      );
      const previous = selectedHistoryKey ? this.history[selectedHistoryKey] : undefined;
      const record = previous ?? { runCount: 0, durationsMs: [] };
      record.lastOutcome = 'unknown';
      record.lastExitCode = undefined;

      record.lastUpdatedAt = Date.now();
      this.history[historyId] = record;
      if (selectedHistoryKey && selectedHistoryKey !== historyId) delete this.history[selectedHistoryKey];
      if (historyId !== observation.logicalId) delete this.history[observation.logicalId];
      if (observation.legacyLogicalId !== observation.logicalId) delete this.history[observation.legacyLogicalId];
      pruneHistory(this.history);
      historyChanged = true;
    }
    this.pendingActiveObservations = reconciliation.pending;
    if (historyChanged) {
      void Promise.resolve(this.context.workspaceState.update(HISTORY_KEY, this.history))
        .catch(error => this.reportError('The unknown reload task status could not be saved.', error));
    }
    this.persistActiveObservations();
  }

  private hasActiveLogicalTask(logicalId: string): boolean {
    return Array.from(this.running.values()).some(active => active.logicalId === logicalId && active.lifecycle !== 'stale');
  }

  private activeForExecution(execution: vscode.TaskExecution): ActiveTask | undefined {
    const executionId = this.executionIds.get(execution);
    return executionId ? this.running.get(executionId) : undefined;
  }

  private async loadWorkspaceTaskSpecs(): Promise<Map<string, WorkspaceTaskSpecs>> {
    const specs = new Map<string, WorkspaceTaskSpecs>();
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const uri = vscode.Uri.joinPath(folder.uri, '.vscode', 'tasks.json');
      try {
        const contents = await vscode.workspace.fs.readFile(uri);
        const parsed = parseJsonc(Buffer.from(contents).toString('utf8')) as unknown;
        const entries = parsed && typeof parsed === 'object' && 'tasks' in parsed &&
          Array.isArray(parsed.tasks) ? parsed.tasks : [];
        const configuredBuiltInLabels = entries
          .filter((entry: unknown): entry is Record<string, unknown> =>
            Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry))
          .filter(entry => entry.type === undefined || entry.type === 'shell' || entry.type === 'process')
          .map(entry => entry.label)
          .filter((label): label is string => typeof label === 'string' && label.trim().length > 0);
        specs.set(folder.uri.toString(), {
          dependencies: parseTaskDependencySpecs(parsed),
          tags: parseTaskTags(parsed),
          configuredBuiltInLabels
        });
      } catch {
        // Discovery and JSON diagnostics are handled independently; one bad root must not hide others.
      }
    }
    return specs;
  }

  private workspaceTaskSpecForTask(
    task: vscode.Task,
    specs: Map<string, WorkspaceTaskSpecs>
  ): { dependency?: TaskDependencySpec; tags: string[] } {
    const folder = taskWorkspaceFolder(task);
    const byLabel = folder.workspaceFolderUri ? specs.get(folder.workspaceFolderUri) : undefined;
    return {
      dependency: byLabel?.dependencies[task.name],
      tags: task.source === 'Workspace' ? (byLabel?.tags[task.name] ?? []) : []
    };
  }

  private isActiveInCurrentWorkspace(active: ActiveTask, includeExternalTasks: boolean): boolean {
    if (active.workspaceScoped) return Boolean(vscode.workspace.workspaceFile);
    return isWorkspaceFolderVisible(
      active.workspaceFolderUri,
      (vscode.workspace.workspaceFolders ?? []).map(folder => folder.uri.toString()),
      includeExternalTasks
    );
  }

  private reconcileRunningExecutions(): void {
    const executions = new Set(vscode.tasks.taskExecutions);
    let recoveredExecution = false;
    for (const active of this.running.values()) {
      if (active.taskEndSeen) continue;
      if (executions.has(active.execution)) {
        if (active.lifecycle === 'stale') {
          Object.assign(active, applyTaskExecutionEvent(active, { type: 'execution-observed' }));
          if (active.staleTimer) clearTimeout(active.staleTimer);
          active.staleTimer = undefined;
          recoveredExecution = true;
          if (shouldScheduleStaleCheck(active.isBackground, active.stopRequested, active.taskEndSeen)) {
            this.scheduleStaleCheck(active, END_EVENT_TIMEOUT_MS);
          }
        }
        if (active.lifecycle === 'running' && !active.stopRequested && !active.processEndSeen && active.staleTimer) {
          clearTimeout(active.staleTimer);
          active.staleTimer = undefined;
        }
      } else {
        if (active.lifecycle === 'stale') continue;
        if (!shouldScheduleStaleCheck(active.isBackground, active.stopRequested, active.taskEndSeen, true)) continue;
        if (!active.staleTimer) this.scheduleStaleCheck(active, END_EVENT_TIMEOUT_MS);
      }
    }
    if (recoveredExecution) this.persistActiveObservations();
  }

  private scheduleFinish(active: ActiveTask, delayMs: number): void {
    if (active.finishTimer) clearTimeout(active.finishTimer);
    active.finishTimer = setTimeout(() => {
      active.finishTimer = undefined;
      void this.finish(active);
    }, delayMs);
  }

  private scheduleStaleCheck(active: ActiveTask, delayMs: number): void {
    if (active.staleTimer) clearTimeout(active.staleTimer);
    active.staleTimer = setTimeout(() => {
      active.staleTimer = undefined;
      void this.markStale(active);
    }, delayMs);
  }

  private async markStale(active: ActiveTask): Promise<void> {
    if (this.running.get(active.executionId) !== active || active.lifecycle === 'stale' || active.taskEndSeen) return;
    Object.assign(active, applyTaskExecutionEvent(active, { type: 'stale' }));
    const selectedHistoryKey = findHistoryKey(
      this.history,
      active.logicalId,
      active.legacyLogicalId,
      active.historyId,
      active.historyMigrationSuffix
    );
    const record = selectedHistoryKey ? this.history[selectedHistoryKey] : undefined;
    const previous = record ?? { runCount: 0, durationsMs: [] };
    previous.lastOutcome = 'stale';
    previous.lastExitCode = active.exitCode;
    previous.lastUpdatedAt = Date.now();
    this.history[active.historyId] = previous;
    if (selectedHistoryKey && selectedHistoryKey !== active.historyId) delete this.history[selectedHistoryKey];
    if (active.historyId !== active.logicalId) delete this.history[active.logicalId];
    if (active.legacyLogicalId !== active.logicalId) delete this.history[active.legacyLogicalId];
    pruneHistory(this.history);
    this.persistActiveObservations();
    try {
      await this.context.workspaceState.update(HISTORY_KEY, this.history);
    } catch (error) {
      this.reportError('The stale task status could not be saved.', error);
    }
    try {
      await this.publish();
    } catch (error) {
      this.reportError('The task view could not be refreshed after the timeout.', error);
    }
    if (active.restartRequested && !this.disposed) {
      active.restartRequested = false;
      await this.run(active.logicalId);
    }
  }

  private terminationFailed(active: ActiveTask, error: unknown): void {
    if (this.running.get(active.executionId) !== active || active.taskEndSeen || active.lifecycle !== 'stopping') return;
    Object.assign(active, applyTaskExecutionEvent(active, { type: 'termination-failed' }));
    active.restartRequested = false;
    if (active.staleTimer) {
      clearTimeout(active.staleTimer);
      active.staleTimer = undefined;
    }
    this.reportError('The task could not be stopped.', error);
    void this.publish();
  }

  private async finish(active: ActiveTask): Promise<void> {
    if (this.running.get(active.executionId) !== active) return;
    const shouldRestart = active.restartRequested;
    const durationMs = calculateElapsedMs(active.startedAtMonotonic, monotonicNow());
    const outcome = resolveTaskOutcome({
      stopRequested: active.stopRequested,
      taskEndSeen: active.taskEndSeen,
      processEndSeen: active.processEndSeen,
      exitCode: active.exitCode,
      graceExpired: true,
      stale: active.lifecycle === 'stale'
    });
    const selectedHistoryKey = findHistoryKey(
      this.history,
      active.logicalId,
      active.legacyLogicalId,
      active.historyId,
      active.historyMigrationSuffix
    );
    const previous = selectedHistoryKey ? this.history[selectedHistoryKey] : undefined;
    const record = previous ?? { runCount: 0, durationsMs: [] };
    record.lastOutcome = outcome;
    record.lastExitCode = active.exitCode;
    record.lastUpdatedAt = Date.now();

    if (shouldCountSuccessfulRun(outcome, active.recovered)) {
      record.lastDurationMs = durationMs;
      record.lastCompletedAt = Date.now();
      record.runCount += 1;
      record.durationsMs = [durationMs, ...record.durationsMs].slice(0, MAX_HISTORY_ENTRIES);
    }
    this.history[active.historyId] = record;
    if (selectedHistoryKey && selectedHistoryKey !== active.historyId) delete this.history[selectedHistoryKey];
    if (active.historyId !== active.logicalId) delete this.history[active.logicalId];
    if (active.legacyLogicalId !== active.logicalId) delete this.history[active.legacyLogicalId];
    pruneHistory(this.history);
    if (active.finishTimer) clearTimeout(active.finishTimer);
    if (active.staleTimer) clearTimeout(active.staleTimer);
    this.running.delete(active.executionId);
    this.persistActiveObservations();
    try {
      await this.context.workspaceState.update(HISTORY_KEY, this.history);
    } catch (error) {
      this.reportError('Task history could not be saved.', error);
    }
    try {
      await this.publish();
    } catch (error) {
      this.reportError('The task view could not be refreshed after task completion.', error);
    }
    if (shouldRestart && !this.disposed) {
      await this.run(active.logicalId);
    }
  }

  reportError(message: string, error?: unknown): void {
    const detail = error instanceof Error ? error.message : typeof error === 'string' ? error : undefined;
    const text = detail ? `${message} ${detail}` : message;
    void vscode.window.showErrorMessage(`[${hostLabel()}] ${text}`);
  }

  private async getTasksJsonWarning(): Promise<string | undefined> {
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const uri = vscode.Uri.joinPath(folder.uri, '.vscode', 'tasks.json');
      try {
        await vscode.workspace.fs.stat(uri);
      } catch (error) {
        const code = error instanceof vscode.FileSystemError ? error.code : undefined;
        if (code && code !== 'FileNotFound') return `${hostLabel()} · ${folder.name}: Could not read tasks.json. Check the file permissions.`;
        if (code === 'FileNotFound') continue;
      }
      try {
        await vscode.workspace.fs.readFile(uri);
      } catch {
        return `${hostLabel()} · ${folder.name}: Could not read tasks.json. Check the file permissions.`;
      }
      const diagnostics = vscode.languages.getDiagnostics(uri).filter(item =>
        item.severity === vscode.DiagnosticSeverity.Error &&
        !/property\s+["']?tags["']?\s+is not allowed/i.test(item.message)
      );
      if (diagnostics.length) return `${hostLabel()} · ${folder.name}: tasks.json has ${diagnostics.length} errors. Fix the JSON syntax and retry.`;
    }
    return undefined;
  }

  private async getDiscoveryWarning(includeExternalTasks: boolean, providerFailed = false): Promise<string> {
    const jsonWarning = await this.getTasksJsonWarning();
    if (jsonWarning) return jsonWarning;
    const failureKind = classifyDiscoveryFailure({
      hasWorkspace: Boolean(vscode.workspace.workspaceFolders?.length),
      providerFailed
    });
    if (failureKind === 'empty-workspace') return `[${hostLabel()}] No workspace is open. Open a workspace and try again.`;
    return failureKind === 'provider'
      ? `[${hostLabel()}] Some task providers could not be queried. Tasks from available providers remain visible; retry after checking the workspace connection.`
      : `[${hostLabel()}] Task discovery failed. Check tasks.json and try again.`;
  }

  private async publish(): Promise<void> {
    if (this.disposed || !this.view) return;
    const revision = ++this.refreshRevision;
    let includeExternalTasks = false;
    let fetchFailed = false;
    try {
      includeExternalTasks = vscode.workspace
        .getConfiguration('tasksSidebar')
        .get<boolean>('includeExternalTasks', false);
      if (!includeExternalTasks && !vscode.workspace.workspaceFolders?.length) {
        if (isCurrentRefresh(revision, this.refreshRevision) && this.view) {
          this.renderSnapshot([], 'No workspace is open. Open a workspace and try again.');
        }
        return;
      }
      const discovery = await this.fetchTasksWithProviderFallback();
      const tasks = discovery.tasks;
      fetchFailed = discovery.providerFailed;
      if (!isCurrentRefresh(revision, this.refreshRevision) || this.disposed || !this.view) return;
      this.reconcileRunningExecutions();
      this.reconcilePersistedObservations();
      const workspaceTaskSpecs = await this.loadWorkspaceTaskSpecs();
      if (!isCurrentRefresh(revision, this.refreshRevision) || this.disposed || !this.view) return;
      const currentFolderUris = (vscode.workspace.workspaceFolders ?? []).map(folder => folder.uri.toString());
      const visibleTasks = tasks
        .filter(task => includeExternalTasks || isWorkspaceJsonTask(task))
        .filter(task => task.scope === vscode.TaskScope.Workspace ||
          isWorkspaceFolderVisible(taskWorkspaceFolder(task).workspaceFolderUri, currentFolderUris, includeExternalTasks))
        .filter(task => task.name.trim().length > 0);
      const expectedLabels = new Map(Array.from(workspaceTaskSpecs, ([uri, specs]) => [uri, specs.configuredBuiltInLabels]));
      const missingTaskFolderUris = missingWorkspaceTaskFolders(
        expectedLabels,
        visibleTasks.map(task => ({
          workspaceFolderUri: taskWorkspaceFolder(task).workspaceFolderUri,
          name: task.name,
          source: task.source
        }))
      );
      const metadataItems: Array<{ task: vscode.Task; metadata: TaskMetadata }> = [];
      const snapshots: TaskSnapshot[] = [];
      const representedExecutionIds = new Set<string>();
      const seenLogicalIds = new Set<string>();
      for (const task of visibleTasks) {
        const taskSpec = this.workspaceTaskSpecForTask(task, workspaceTaskSpecs);
        const metadata = toMetadata(task, taskSpec.dependency, taskSpec.tags);
        if (seenLogicalIds.has(metadata.logicalId)) continue;
        seenLogicalIds.add(metadata.logicalId);
        metadataItems.push({ task, metadata });
      }
      const metadataByScopeAndName = new Map<string, TaskMetadata>();
      for (const item of metadataItems) {
        metadataByScopeAndName.set(taskScopeNameKey(item.metadata.workspaceFolderUri, item.metadata.name), item.metadata);
      }
      const dependencyIds = new Set<string>();
      for (const item of metadataItems) {
        item.metadata.dependencyIds = item.metadata.dependsOn
          .map(name => metadataByScopeAndName.get(taskScopeNameKey(item.metadata.workspaceFolderUri, name))?.logicalId)
          .filter((id): id is string => Boolean(id));
        item.metadata.dependencyIds.forEach(id => dependencyIds.add(id));
      }
      for (const item of metadataItems) {
        const { metadata } = item;
        const activeTasks = Array.from(this.running.values()).filter(active => active.logicalId === metadata.logicalId);
        if (!activeTasks.length) {
          snapshots.push(toSnapshot(metadata, undefined, this.history, false, dependencyIds.has(metadata.logicalId)));
          continue;
        }
        for (const active of activeTasks) {
          representedExecutionIds.add(active.executionId);
          snapshots.push(toSnapshot(metadata, active, this.history, false, dependencyIds.has(metadata.logicalId)));
        }
      }
      for (const active of this.running.values()) {
        if (!representedExecutionIds.has(active.executionId) && this.isActiveInCurrentWorkspace(active, includeExternalTasks)) {
          snapshots.push(toSnapshot({
            logicalId: active.logicalId,
            legacyLogicalId: active.legacyLogicalId,
            historyId: active.historyId,
            historyMigrationSuffix: active.historyMigrationSuffix,
            name: active.name,
            source: active.source,
            group: active.group,
            tags: [],
            isBackground: active.isBackground,
            workspaceFolderUri: active.workspaceFolderUri,
            workspaceFolderName: active.workspaceFolderName,
            workspaceScoped: active.workspaceScoped,
            dependsOn: active.dependsOn,
            dependsOrder: active.dependsOrder,
            dependencyIds: active.dependencyIds
          }, active, this.history, true, dependencyIds.has(active.logicalId)));
        }
      }
      // Do not erase valid tasks from other roots on a transient partial
      // provider result (e.g. early VS Code multi-root initialization).
      if (missingTaskFolderUris.length) {
        const missing = new Set(missingTaskFolderUris);
        const knownIds = new Set(snapshots.map(snapshot => snapshot.id));
        for (const cached of this.lastGoodSnapshots) {
          if (!cached.workspaceFolderUri || !missing.has(cached.workspaceFolderUri) ||
              !expectedLabels.get(cached.workspaceFolderUri)?.includes(cached.name) ||
              knownIds.has(cached.id)) continue;
          knownIds.add(cached.id);
          snapshots.push({
            ...cached, isRunning: false, elapsedMs: 0, progress: 0,
            progressState: calculateProgressState({
              isRunning: false, elapsedMs: 0, plannedMs: cached.plannedMs, lastOutcome: cached.lastOutcome
            }),
            isStopping: false, overtimeMs: undefined, executionId: undefined,
            lifecycle: 'idle', orphaned: false
          });
        }
      }
      applyDependencyState(snapshots);
      snapshots.sort((a, b) => Number(b.isRunning) - Number(a.isRunning) || a.name.localeCompare(b.name) || a.executionId?.localeCompare(b.executionId ?? '') || 0);
      let warning: string | undefined;
      try {
        warning = fetchFailed
          ? await this.getDiscoveryWarning(includeExternalTasks, true)
          : await this.getTasksJsonWarning();
      } catch {
        warning = `[${hostLabel()}] Could not check tasks.json. Check the workspace file permissions.`;
      }
      if (!isCurrentRefresh(revision, this.refreshRevision) || this.disposed || !this.view) return;
      if (missingTaskFolderUris.length) {
        const names = (vscode.workspace.workspaceFolders ?? [])
          .filter(folder => missingTaskFolderUris.includes(folder.uri.toString()))
          .map(folder => folder.name);
        warning = `[${hostLabel()}] Waiting for tasks from: ${names.join(', ')}. Retrying automatically.` +
          (warning ? ' ' + warning : '');
      }
      this.lastGoodSnapshots = snapshots.map(snapshot => ({ ...snapshot }));
      const cacheSnapshots = snapshots
        .filter(snapshot => !snapshot.orphaned)
        .map(snapshot => ({
          ...snapshot,
          isRunning: false,
          elapsedMs: 0,
          progress: 0,
          progressState: calculateProgressState({
            isRunning: false,
            elapsedMs: 0,
            plannedMs: snapshot.plannedMs,
            lastOutcome: snapshot.lastOutcome
          }),
          overtimeMs: undefined,
          isStopping: false,
          executionId: undefined,
          lifecycle: 'idle' as const,
          orphaned: false
        }));
      const cacheSignature = JSON.stringify(cacheSnapshots);
      if (cacheSignature !== this.lastGoodCacheSignature) {
        this.lastGoodCacheSignature = cacheSignature;
        void Promise.resolve(this.context.workspaceState.update(LAST_GOOD_KEY, cacheSnapshots))
          .catch(error => this.reportError('The last valid task snapshot could not be saved.', error));
      }
      this.renderSnapshot(snapshots, warning);
      this.scheduleNextDiscovery(missingTaskFolderUris.length > 0);
    } catch (error) {
      if (!isCurrentRefresh(revision, this.refreshRevision) || this.disposed || !this.view) return;
      let warning = `[${hostLabel()}] Task discovery failed. Check tasks.json, permissions, or external providers and try again.`;
      try {
        warning = await this.getDiscoveryWarning(includeExternalTasks, fetchFailed);
      } catch {
        // Keep the refresh failure visible even if diagnostics or file inspection also fails.
      }
      if (!isCurrentRefresh(revision, this.refreshRevision) || this.disposed || !this.view) return;
      const currentFolders = new Set((vscode.workspace.workspaceFolders ?? []).map(folder => folder.uri.toString()));
      const fallbackSnapshots = this.lastGoodSnapshots.filter(snapshot => {
        if (!includeExternalTasks && snapshot.source !== 'Workspace') return false;
        if (snapshot.workspaceScoped) return Boolean(vscode.workspace.workspaceFile);
        return isWorkspaceFolderVisible(snapshot.workspaceFolderUri, currentFolders, includeExternalTasks);
      });
      this.renderSnapshot(fallbackSnapshots, warning);
      this.scheduleNextDiscovery(true);
    }
  }
}

function isWorkspaceJsonTask(task: vscode.Task): boolean {
  if (task.source !== 'Workspace') return false;
  return task.scope === vscode.TaskScope.Workspace ||
    (typeof task.scope === 'object' && task.scope !== null && 'uri' in task.scope);
}

function hostLabel(): string {
  return vscode.env.remoteName ? `Remote · ${vscode.env.remoteName}` : 'Local extension host';
}

function monotonicNow(): number {
  return typeof globalThis.performance?.now === 'function' ? globalThis.performance.now() : Date.now();
}

function pruneHistory(history: Record<string, TaskHistory>): void {
  const keep = new Set(selectRecentHistoryKeys(history, MAX_HISTORY_RECORDS));
  for (const key of Object.keys(history)) {
    if (!keep.has(key)) delete history[key];
  }
}

export class TaskBoardView implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private pending?: TaskSnapshot[];
  private pendingWarning?: string;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly extensionVersion: string,
    private readonly host: string,
    private readonly board: TaskBoard
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [this.extensionUri] };
    view.webview.html = createTaskBoardHtml(this.extensionVersion, this.host);
    view.webview.onDidReceiveMessage(message => this.handleWebviewMessage(message));
    if (this.pending) this.render(this.pending, this.pendingWarning);
  }

  private async handleWebviewMessage(message: unknown): Promise<void> {
    try {
      if (!message || typeof message !== 'object' || !('command' in message) || typeof message.command !== 'string') {
        throw new Error('The sidebar sent an invalid action.');
      }
      const id = 'id' in message ? message.id : undefined;
      const requiredId = (): string => {
        if (typeof id !== 'string' || !id.trim()) throw new Error('The selected task is no longer available. Refresh the view and try again.');
        return id;
      };
      const optionalId = (): string | undefined => {
        if (id === undefined) return undefined;
        if (typeof id !== 'string' || !id.trim()) throw new Error('The selected task is no longer available. Refresh the view and try again.');
        return id;
      };
      switch (message.command) {
        case 'run': await this.board.run(requiredId()); break;
        case 'stop': await this.board.stop(requiredId()); break;
        case 'restart': await this.board.restart(requiredId()); break;
        case 'refresh': await this.board.refresh(); break;
        case 'ready': if (this.pending) this.render(this.pending, this.pendingWarning); break;
        case 'saveOrder': await this.board.updateCustomTaskOrder('order' in message ? message.order : undefined); break;
        case 'edit': await this.board.openTasksJson(optionalId()); break;
        case 'create': await this.board.createTask(); break;
        default: throw new Error('The sidebar sent an unsupported action.');
      }
    } catch (error) {
      this.board.reportError('The sidebar action could not be completed.', error);
    }
  }

  render(snapshots: TaskSnapshot[], warning?: string): void {
    this.pending = snapshots;
    this.pendingWarning = warning;
    const message = this.view?.webview.postMessage({
      command: 'render', snapshots, warning, customOrder: this.board.getCustomTaskOrder?.() ?? []
    });
    if (message) void Promise.resolve(message).catch(error => this.board.reportError('The Tasks Sidebar could not be updated.', error));
  }
}

function toSnapshot(
  metadata: TaskMetadata,
  active: ActiveTask | undefined,
  history: Record<string, TaskHistory>,
  orphaned = false,
  isDependency = false
): TaskSnapshot {
  const record = findHistoryRecord(
    history,
    metadata.logicalId,
    metadata.legacyLogicalId,
    metadata.historyId,
    metadata.historyMigrationSuffix
  ) ?? { runCount: 0, durationsMs: [] };
  const isRunning = active?.lifecycle === 'running' || active?.lifecycle === 'stopping' || active?.lifecycle === 'awaiting-task-end';
  const elapsedMs = active ? calculateElapsedMs(active.startedAtMonotonic, monotonicNow()) : 0;
  const plannedMs = calculatePlanDuration(record);
  const lastOutcome = active?.lifecycle === 'stale' ? 'stale' : record.lastOutcome;
  const dependsOn = metadata.dependsOn.length ? metadata.dependsOn : active?.dependsOn ?? [];
  const dependencyIdsForSnapshot = metadata.dependencyIds.length ? metadata.dependencyIds : active?.dependencyIds ?? [];
  return {
    id: metadata.logicalId,
    name: active?.name ?? metadata.name,
    source: active?.source ?? metadata.source,
    group: active?.group ?? metadata.group,
    tags: metadata.tags,
    isBackground: active?.isBackground ?? metadata.isBackground,
    workspaceFolderUri: active?.workspaceFolderUri ?? metadata.workspaceFolderUri,
    workspaceFolderName: active?.workspaceFolderName ?? metadata.workspaceFolderName,
    workspaceScoped: active?.workspaceScoped ?? metadata.workspaceScoped,
    dependsOn,
    dependsOrder: metadata.dependsOrder ?? active?.dependsOrder ?? 'parallel',
    dependencyIds: dependencyIdsForSnapshot,
    isDependency,
    isRunning,
    elapsedMs,
    plannedMs,
    lastDurationMs: plannedMs,
    runCount: record.runCount,
    progress: calculateProgressPercent(elapsedMs, plannedMs, isRunning),
    progressState: calculateProgressState({ isRunning, elapsedMs, plannedMs, lastOutcome }),
    overtimeMs: isRunning && plannedMs && elapsedMs > plannedMs ? elapsedMs - plannedMs : undefined,
    isStopping: active?.lifecycle === 'stopping',
    lastOutcome,

    lastExitCode: record.lastExitCode,
    executionId: active?.executionId,
    lifecycle: active?.lifecycle ?? 'idle',
    orphaned,
    elapsedBasis: active?.recovered ? 'since-reload' : 'measured'
  };
}

function toMetadata(task: vscode.Task, dependencySpec?: TaskDependencySpec, tags: string[] = []): TaskMetadata {
  const source = task.source || 'Workspace';
  const folder = taskWorkspaceFolder(task);
  const scope = folder.workspaceFolderUri ?? String(task.scope ?? 'global');
  return {
    logicalId: createLogicalTaskId(source, task.name, scope, task.definition),
    legacyLogicalId: createLegacyTaskId(source, task.name, scope, task.definition),
    historyId: createHistoryTaskId(source, scope, task.definition),
    historyMigrationSuffix: createHistoryMigrationSuffix(scope, task.definition),
    name: task.name,
    source,
    group: taskGroupLabel(task),
    tags,
    isBackground: task.isBackground,
    workspaceFolderUri: folder.workspaceFolderUri,
    workspaceFolderName: folder.workspaceFolderName,
    workspaceScoped: task.scope === vscode.TaskScope.Workspace,
    dependsOn: dependencySpec?.dependsOn ?? [],
    dependsOrder: dependencySpec?.dependsOrder ?? 'parallel',
    dependencyIds: []
  };
}

function taskWorkspaceFolder(task: vscode.Task): { workspaceFolderUri?: string; workspaceFolderName?: string } {
  if (!task.scope || typeof task.scope !== 'object' || !('uri' in task.scope)) return {};
  const folder = task.scope as vscode.WorkspaceFolder;
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(folder.uri);
  return {
    workspaceFolderUri: folder.uri.toString(),
    workspaceFolderName: workspaceFolder?.name || folder.name || folderNameFromUri(folder.uri)
  };
}

function folderNameFromUri(uri: vscode.Uri): string {
  const segments = uri.path.replace(/\/+$/, '').split('/').filter(Boolean);
  return segments[segments.length - 1] || uri.toString();
}

function taskScopeNameKey(workspaceFolderUri: string | undefined, name: string): string {
  return (workspaceFolderUri ?? 'global') + ':' + name;
}

function applyDependencyState(snapshots: TaskSnapshot[]): void {
  const byLogicalId = new Map<string, TaskSnapshot[]>();
  for (const snapshot of snapshots) {
    const current = byLogicalId.get(snapshot.id) ?? [];
    current.push(snapshot);
    byLogicalId.set(snapshot.id, current);
  }
  for (const parent of snapshots) {
    if (!parent.dependsOn.length) continue;
    const children = parent.dependencyIds.flatMap(id => byLogicalId.get(id) ?? []);
    const dependency = resolveDependencyState(parent.dependsOn, parent.dependencyIds, children, parent.dependsOrder);
    if (dependency) {
      parent.dependencyState = dependency.state;
      parent.dependencyFailure = dependency.failure;
    }
  }
}

function findHistoryRecord(
  history: Record<string, TaskHistory>,
  logicalId: string,
  legacyLogicalId: string,
  historyId?: string,
  historyMigrationSuffix?: string
): TaskHistory | undefined {
  const key = findHistoryKey(history, logicalId, legacyLogicalId, historyId, historyMigrationSuffix);
  return key ? history[key] : undefined;
}

function findHistoryKey(
  history: Record<string, TaskHistory>,
  logicalId: string,
  legacyLogicalId: string,
  historyId?: string,
  historyMigrationSuffix?: string
): string | undefined {
  return selectHistoryKey(Object.keys(history), logicalId, legacyLogicalId, historyId, historyMigrationSuffix);
}

function taskGroupLabel(task: vscode.Task): string {
  if (!task.group) return 'Task';
  return typeof task.group === 'string' ? task.group : task.group.id || 'Task';
}

function taskId(task: vscode.Task): string {
  const source = task.source || 'Workspace';
  const scope = typeof task.scope === 'object' && task.scope ? task.scope.uri.toString() : String(task.scope ?? 'global');
  return createLogicalTaskId(source, task.name, scope, task.definition);
}

export function createTaskBoardHtml(extensionVersion: string, hostLabel: string): string {
  const nonce = getNonce();
  const safeVersion = extensionVersion.replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' } as Record<string, string>)[character]);
  const safeHost = hostLabel.replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' } as Record<string, string>)[character]);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <style>
    :root {
      --ink: var(--vscode-foreground, CanvasText);
      --violet: var(--vscode-textLink-foreground, var(--ink));
      --mint: var(--vscode-testing-iconPassed, var(--ink));
      --muted: var(--vscode-descriptionForeground, var(--ink));
      --line: var(--vscode-contrastBorder, var(--vscode-panel-border, transparent));
      --surface: var(--vscode-sideBar-background, Canvas);
      --surface-raised: var(--vscode-editorWidget-background, var(--surface));
      --danger: var(--vscode-errorForeground, var(--ink));
      --warning: var(--vscode-editorWarning-foreground, var(--ink));
      --focus: var(--vscode-focusBorder, Highlight);
    }
    * { box-sizing: border-box; }
    .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
    body { min-height: 100vh; margin: 0; padding: 12px; color: var(--ink); font-family: var(--vscode-font-family); font-size: 12px; background: var(--surface); background: radial-gradient(ellipse 90% 62% at 100% 0, color-mix(in srgb, var(--violet) 14%, transparent), transparent 72%), linear-gradient(160deg, color-mix(in srgb, var(--violet) 9%, transparent), transparent 66%), var(--surface); background-repeat: no-repeat; background-attachment: fixed; }
    .top { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 14px; }
    .eyebrow { color: var(--mint); font-size: 10px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; }
    h1 { margin: 3px 0 0; font-size: 21px; letter-spacing: -.03em; }
    .version { display: inline-flex; margin-left: 6px; padding: 2px 6px; vertical-align: 3px; border: 1px solid color-mix(in srgb, var(--mint) 35%, transparent); border-radius: 999px; color: var(--mint); background: color-mix(in srgb, var(--mint) 10%, transparent); font-size: 9px; font-weight: 700; letter-spacing: .04em; }
    .actions { display: flex; gap: 4px; }
    button { min-width: 28px; min-height: 28px; border: 0; color: inherit; background: transparent; cursor: pointer; border-radius: 6px; padding: 5px 7px; font: inherit; }
    button:hover { background: var(--vscode-toolbar-hoverBackground); }
    button:focus-visible, input:focus-visible, select:focus-visible, #list:focus-visible, .task:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
    .primary { background: color-mix(in srgb, var(--violet) 16%, transparent); color: var(--violet); }
    .primary:hover { background: color-mix(in srgb, var(--violet) 27%, transparent); }
    .board-tools { display: grid; grid-template-columns: minmax(0, 1fr); gap: 6px; margin: 0 0 10px; }
    .search-wrap { position: relative; min-width: 0; display: flex; align-items: center; }
    .search-wrap .search { width: 100%; padding-right: 67px; }
    /* Keep Chromium's native clear icon separate from the regex toggle. */
    .search-wrap .search::-webkit-search-cancel-button { margin-right: 33px; }
    #regexToggle { position: absolute; right: 4px; top: 50%; transform: translateY(-50%); min-width: 29px; min-height: 25px; padding: 1px 4px; border: 1px solid transparent; border-radius: 4px; background: transparent; color: var(--ink); font-weight: 700; }
    #regexToggle[aria-pressed="true"] { background: var(--vscode-inputOption-activeBackground, var(--surface-raised)); color: var(--vscode-inputOption-activeForeground, var(--ink)); border-color: var(--vscode-inputOption-activeBorder, var(--focus)); }
    #regexToggle:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
    #searchError { color: var(--vscode-inputValidation-errorForeground, var(--danger)); font-size: 0.85em; padding: 0 3px; }
    #searchError:empty { display: none; }
    .search { min-width: 0; padding: 7px 9px; color: var(--ink); border: 1px solid var(--line); border-radius: 7px; background: color-mix(in srgb, var(--surface-raised) 72%, transparent); font: inherit; }
    .view-select { min-width: 78px; padding: 5px 6px; color: var(--ink); border: 1px solid var(--line); border-radius: 7px; background: var(--surface-raised); font: inherit; }
    .view-options { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 5px; grid-column: 1 / -1; }
    .view-options .view-select { min-width: 0; }
    .view-options #sort { grid-column: 1 / -1; }
    .tag-filter { min-width: 0; border: 1px solid var(--line); border-radius: 7px; padding: 5px 6px; background: var(--surface-raised); }
    .tag-filter summary { cursor: pointer; overflow-wrap: anywhere; }
    #tagFilter { display: grid; gap: 5px; max-height: 180px; overflow-y: auto; margin: 7px 0; }
    #tagFilter label { display: flex; align-items: center; gap: 4px; overflow-wrap: anywhere; }
    #tagFilter input { flex: none; }
    .tag-filter summary:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
    .task[draggable="true"] { cursor: grab; }
    .task[draggable="true"]:active { cursor: grabbing; }
    .task.drag-over { outline: 2px dashed var(--focus); outline-offset: 2px; }
    .move-actions { display: flex; gap: 2px; }
    .move-actions button { min-width: 23px; min-height: 23px; }
    .filtered-empty { padding: 18px 12px; border: 1px dashed var(--line); border-radius: 10px; color: var(--muted); text-align: center; }
    .empty { padding: 8px 0 4px; color: var(--muted); line-height: 1.55; }
    .empty-state { position: relative; isolation: isolate; min-height: 230px; padding: 8px 0 18px; }
    .empty-ambient { position: absolute; z-index: -1; inset: -36px -24px; pointer-events: none; background: radial-gradient(ellipse 70% 58% at 20% 12%, color-mix(in srgb, var(--violet) 13%, transparent), transparent 72%), radial-gradient(ellipse 72% 60% at 82% 72%, color-mix(in srgb, var(--mint) 7%, transparent), transparent 74%); background-repeat: no-repeat; background-size: 100% 100%; filter: blur(22px); opacity: .9; }
    .empty-card { position: relative; border: 1px solid var(--line); border-radius: 16px; padding: 18px 16px 15px; background: var(--surface-raised); background: linear-gradient(145deg, color-mix(in srgb, var(--surface-raised) 90%, transparent), color-mix(in srgb, var(--surface) 70%, transparent)); box-shadow: 0 12px 28px color-mix(in srgb, var(--vscode-widget-shadow, transparent) 20%, transparent), 0 0 0 1px color-mix(in srgb, var(--violet) 3%, transparent); backdrop-filter: blur(10px); }
    .empty-card::before { content: ''; position: absolute; z-index: -1; inset: 0; border-radius: inherit; opacity: .28; pointer-events: none; background-image: linear-gradient(color-mix(in srgb, var(--violet) 7%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in srgb, var(--violet) 7%, transparent) 1px, transparent 1px); background-size: 20px 20px; mask-image: linear-gradient(145deg, color-mix(in srgb, CanvasText 75%, transparent), transparent 72%); }
    .empty-visual { position: relative; display: grid; place-items: center; height: 84px; margin: 0 0 14px; }
    .orbit-system { position: relative; width: 68px; height: 68px; }
    .orbit-ring { position: absolute; inset: 4px; border: 1px solid color-mix(in srgb, var(--violet) 55%, transparent); border-radius: 50%; box-shadow: 0 0 0 8px color-mix(in srgb, var(--violet) 5%, transparent), 0 0 30px color-mix(in srgb, var(--violet) 16%, transparent); }
    .orbit-ring::after { content: ''; position: absolute; inset: 12px; border: 1px dashed color-mix(in srgb, var(--mint) 45%, transparent); border-radius: 50%; }
    .orbit-satellite { position: absolute; inset: 0; transform-origin: center; animation: orbit 12s linear infinite; }
    .orbit-satellite span { position: absolute; top: 0; left: 50%; width: 7px; height: 7px; border-radius: 50%; transform: translateX(-50%); background: var(--mint); box-shadow: 0 0 12px var(--mint); }
    .empty-core { position: absolute; inset: 25px; border-radius: 50%; background: linear-gradient(135deg, var(--violet), var(--mint)); box-shadow: 0 0 18px color-mix(in srgb, var(--mint) 32%, transparent); animation: pulse 1.8s ease-in-out infinite; }
    .empty-title { position: relative; display: block; margin: 0 0 5px; color: var(--ink); font-size: 14px; font-weight: 700; }
    .empty-copy { position: relative; margin: 0; }
    .empty-copy code { color: var(--violet); background: color-mix(in srgb, var(--violet) 10%, transparent); border-radius: 4px; padding: 1px 4px; }
    .empty-actions { position: relative; display: flex; gap: 7px; margin-top: 15px; }
    .empty-cta { padding: 7px 10px; color: var(--vscode-button-foreground, var(--ink)); background: var(--vscode-button-background, var(--surface-raised)); font-size: 11px; font-weight: 700; }
    .empty-cta:hover { background: var(--vscode-button-hoverBackground, var(--mint)); }
    .empty-secondary { padding: 7px 9px; color: var(--muted); border: 1px solid var(--line); font-size: 11px; }
    .empty-secondary:hover { color: var(--ink); border-color: var(--focus); }
    .empty-hint { position: relative; margin: 13px 0 0; padding-top: 10px; border-top: 1px solid var(--line); color: var(--muted); font-size: 10px; }
    .task { border: 1px solid var(--line); background: color-mix(in srgb, var(--surface-raised) 28%, transparent); border-radius: 10px; padding: 10px; margin: 8px 0; transition: transform .18s ease, border-color .18s ease; }
    .task:hover { transform: translateY(-1px); border-color: color-mix(in srgb, var(--violet) 50%, transparent); }
    .task.running { border-color: color-mix(in srgb, var(--mint) 55%, transparent); box-shadow: 0 0 20px color-mix(in srgb, var(--mint) 7%, transparent); }
    .task.overdue { border-color: color-mix(in srgb, var(--danger) 55%, transparent); box-shadow: 0 0 20px color-mix(in srgb, var(--danger) 7%, transparent); }
    .task.failed { border-color: color-mix(in srgb, var(--danger) 48%, transparent); }
    .task.cancelled { border-color: color-mix(in srgb, var(--warning) 42%, transparent); }
    .task.unknown { border-color: color-mix(in srgb, var(--warning) 55%, transparent); }
    .task.awaiting { border-color: color-mix(in srgb, var(--violet) 50%, transparent); }
    .task.stale { border-color: color-mix(in srgb, var(--muted) 50%, transparent); opacity: .84; }
    .task.orphaned { border-style: dashed; }
    .task.stopping { opacity: .72; }
    .task.dependency-failed { border-color: color-mix(in srgb, var(--danger) 55%, transparent); }
    .task.dependency-cancelled { border-color: color-mix(in srgb, var(--warning) 50%, transparent); }
    .task.dependency-unknown, .task.dependency-unresolved { border-color: color-mix(in srgb, var(--violet) 50%, transparent); }
    .task.completed { border-color: color-mix(in srgb, var(--mint) 35%, transparent); }
    .host { display: block; margin-top: 3px; color: var(--muted); font-size: 9px; letter-spacing: .03em; }
    .edit { color: var(--violet); }
    .task.stopping .task-hit { pointer-events: none; }
    .inline-alert { display: flex; align-items: center; gap: 9px; margin: 0 0 9px; padding: 9px 10px; border: 1px solid color-mix(in srgb, var(--warning) 45%, transparent); border-radius: 10px; color: var(--warning); background: color-mix(in srgb, var(--warning) 12%, transparent); line-height: 1.4; }
    .inline-alert-copy { flex: 1; }
    .inline-alert button { flex: 0 0 auto; padding: 4px 8px; color: var(--ink); border: 1px solid color-mix(in srgb, var(--warning) 45%, transparent); background: color-mix(in srgb, var(--warning) 10%, transparent); font-size: 10px; font-weight: 700; }
    .row { display: flex; gap: 8px; align-items: center; }
    .glyph { width: 21px; height: 21px; border-radius: 7px; display: grid; place-items: center; background: color-mix(in srgb, var(--muted) 13%, transparent); color: var(--muted); flex: 0 0 auto; }
    .running .glyph { color: var(--mint); background: color-mix(in srgb, var(--mint) 13%, transparent); animation: pulse 1.8s ease-in-out infinite; }
    .name { min-width: 0; margin: 0; font: inherit; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
    .sub { color: var(--muted); font-size: 10px; margin: 4px 0 8px 29px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tags { display: flex; flex-wrap: wrap; gap: 4px; margin: -2px 0 8px 29px; }
    .tag { padding: 2px 6px; border: 1px solid color-mix(in srgb, var(--mint) 25%, var(--line)); border-radius: 999px; color: var(--mint); background: color-mix(in srgb, var(--mint) 8%, transparent); font-size: 9px; line-height: 1.35; }
    .bar { position: relative; height: 6px; background: color-mix(in srgb, var(--muted) 13%, transparent); border: 1px solid color-mix(in srgb, var(--muted) 10%, transparent); border-radius: 20px; overflow: hidden; box-shadow: inset 0 1px 1px color-mix(in srgb, var(--surface) 42%, transparent); }
    .fill { position: relative; height: 100%; width: 0; border-radius: inherit; background: linear-gradient(90deg, var(--violet), var(--mint)); transition: width .9s cubic-bezier(.22,1,.36,1); will-change: width; }
    .running .fill.indeterminate { width: 100% !important; background: linear-gradient(90deg, color-mix(in srgb, var(--violet) 22%, transparent), color-mix(in srgb, var(--mint) 30%, transparent)); transition: none; }
    .running .fill.indeterminate::after { content: ''; position: absolute; top: -140%; bottom: -140%; left: 0; width: 60%; border-radius: 999px; background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--ink) 34%, transparent) 42%, color-mix(in srgb, var(--mint) 94%, transparent) 50%, color-mix(in srgb, var(--ink) 34%, transparent) 58%, transparent); filter: blur(3px); transform: translate3d(var(--flow-x, -170%), 0, 0); will-change: transform; }
    .task.overdue .fill { background: linear-gradient(90deg, var(--violet), var(--danger)); }
    .meta { display: flex; justify-content: space-between; gap: 8px; color: var(--muted); font-size: 10px; margin: 7px 0 0 29px; }
    .late { color: var(--danger); }
    .task-actions { margin-left: auto; display: flex; }
    .run { color: var(--mint); }
    .stop { color: var(--danger); }
    .restart { color: var(--violet); }
    .high-contrast { border-color: var(--focus); }
    @media (forced-colors: active) {
      body, .task, .empty-card, .search, .view-select, .tag, .tag-filter { color: CanvasText; border-color: CanvasText; background: Canvas; }
      button, input, select, .meta, .sub, .host, .empty-hint { color: CanvasText; }
      button:focus-visible, input:focus-visible, select:focus-visible, #list:focus-visible, .task:focus-visible { outline: 2px solid Highlight; }
      #regexToggle[aria-pressed="true"] { background: Highlight; color: HighlightText; border-color: Highlight; }
      #regexToggle:focus-visible { outline: 2px solid Highlight; }
      #searchError { color: CanvasText; }
      .fill { background: Highlight; }
      .glyph { color: CanvasText; border: 1px solid CanvasText; }
    }
    @keyframes orbit { to { transform: rotate(1turn); } }
    @keyframes pulse { 50% { transform: scale(1.08); } }
    @keyframes shimmer { from { background-position: 100% 0; } to { background-position: -100% 0; } }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { animation: none !important; transition: none !important; scroll-behavior: auto !important; }
      .task:hover { transform: none; }
    }
  </style>
</head>
<body>
  <div class="top">
    <div><div class="eyebrow">Workspace flow</div><h1>Tasks <span class="version">v${safeVersion}</span></h1><span class="host">${safeHost}</span></div>
    <div class="actions" role="group" aria-label="Task actions"><button type="button" id="refresh" title="Refresh tasks" aria-label="Refresh tasks">↻</button><button type="button" id="create" class="primary" title="Create task" aria-label="Create task">＋</button><button type="button" id="edit" class="primary" title="Open tasks.json" aria-label="Open tasks.json">✎</button></div>
  </div>
  <div class="board-tools" role="group" aria-label="Task board controls">
    <div class="search-wrap"><input id="search" class="search" type="search" placeholder="Search tasks, tags, sources, groups…" aria-label="Search tasks, tags, sources, groups" aria-describedby="searchError"><button id="regexToggle" type="button" aria-label="Use Regular Expression" title="Use Regular Expression" aria-pressed="false">.*</button></div>
    <div id="searchError" role="alert" aria-live="polite"></div>
    <div class="view-options">
      <select id="filter" class="view-select" aria-label="Filter tasks"><option value="all">All tasks</option><option value="running">Running</option><option value="failed">Failed</option><option value="completed">Completed</option><option value="unknown">Unknown / stale</option><option value="external">External providers</option></select>
      <details class="tag-filter"><summary id="tagSummary">Tags (all required)</summary><div id="tagFilter" role="group" aria-label="Filter tasks by tags (all required)"></div><button id="clearTags" type="button">Clear tags</button></details>
      <select id="sort" class="view-select" aria-label="Sort tasks"><option value="name">Sort: name</option><option value="status">Sort: status</option><option value="elapsed">Sort: elapsed</option><option value="folder">Sort: folder</option><option value="custom">Sort: custom (drag)</option></select>
    </div>
  </div>
  <div id="announcer" class="sr-only" aria-live="polite" aria-atomic="true"></div>
  <div id="warning"></div>
  <main id="list" tabindex="-1" aria-label="Task board" aria-live="off" aria-busy="true"><div class="empty"><strong>Loading tasks…</strong>Looking for tasks from .vscode/tasks.json.</div></main>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const list = document.getElementById('list');
    const search = document.getElementById('search');
    const regexToggle = document.getElementById('regexToggle');
    const searchError = document.getElementById('searchError');
    const filter = document.getElementById('filter');
    const tagFilter = document.getElementById('tagFilter');
    const sort = document.getElementById('sort');
    const announcer = document.getElementById('announcer');
    const warningRegion = document.getElementById('warning');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let allTasks = [];
    const savedSearch = vscode.getState?.() || {};
    let query = typeof savedSearch.query === 'string' ? savedSearch.query : '';
    let regexEnabled = savedSearch.regexEnabled === true;
    if (search) search.value = query;
    regexToggle?.setAttribute('aria-pressed', String(regexEnabled));
    if (regexToggle) regexToggle.title = regexEnabled ? 'Use Regular Expression (enabled)' : 'Use Regular Expression';
    let selectedFilter = 'all';
    let selectedTags = [];
    let selectedSort = ['name', 'status', 'elapsed', 'folder', 'custom'].includes(savedSearch.selectedSort)
      ? savedSearch.selectedSort : 'name';
    if (sort) sort.value = selectedSort;
    let customOrder = [];
    let draggedId = '';
    let tagOptionsSignature = '';
    let progressFrame = 0;
    let progressOffset = -170;
    let progressLastTime = 0;
    let receivedInitialSnapshot = false;
    let announcedStates = new Map();
    const progressClocks = new Map();
    let lastRenderSignature = '';
    reducedMotion.addEventListener('change', event => {
      if (event.matches && progressFrame) {
        cancelAnimationFrame(progressFrame);
        progressFrame = 0;
      } else if (!event.matches && document.querySelector('.fill.indeterminate')) {
        startProgressAnimation();
      }
    });
    const refresh = () => vscode.postMessage({ command: 'refresh' });
    document.getElementById('refresh')?.addEventListener('click', refresh);

    document.getElementById('create')?.addEventListener('click', () => vscode.postMessage({ command: 'create' }));
    document.getElementById('edit')?.addEventListener('click', () => vscode.postMessage({ command: 'edit' }));
    function persistSearch() {
      vscode.setState?.({ ...savedSearch, query, regexEnabled, selectedSort });
    }
    function displayRegexError(message) {
      searchError.textContent = message;
      search?.setAttribute('aria-invalid', message ? 'true' : 'false');
    }
    function compileViewRegex(value) {
      if (!regexEnabled || !value.length) return undefined;
      if (value.length > 256) throw new Error('Regular expression is too long (maximum 256 characters).');
      return new RegExp(value, 'i');
    }
    search?.addEventListener('input', () => { query = search.value; persistSearch(); render(allTasks); });
    regexToggle?.addEventListener('click', () => {
      regexEnabled = !regexEnabled;
      regexToggle.setAttribute('aria-pressed', String(regexEnabled));
      regexToggle.title = regexEnabled ? 'Use Regular Expression (enabled)' : 'Use Regular Expression';
      persistSearch();
      render(allTasks);
    });
    filter?.addEventListener('change', () => { selectedFilter = filter.value; render(allTasks); });
    tagFilter?.addEventListener('change', () => {
      selectedTags = Array.from(tagFilter.querySelectorAll('input:checked'), input => input.value);
      render(allTasks);
    });
    document.getElementById('clearTags')?.addEventListener('click', () => { selectedTags = []; render(allTasks); });
    sort?.addEventListener('change', () => { selectedSort = sort.value; persistSearch(); render(allTasks); });

    function visibleForReorder() {
      let pattern;
      try { pattern = compileViewRegex(query); } catch { return []; }
      return applyView(allTasks, query, selectedFilter, selectedSort, selectedTags, pattern, customOrder);
    }

    function moveVisibleTask(movedId, targetId, after = false) {
      const visible = visibleForReorder();
      const visibleIds = [...new Set(visible.map(task => task.id))];
      const discovered = [...new Set(allTasks.map(task => task.id))];
      // Preserve hidden entries in their existing slots; new entries are appended
      // in the current visible order, then by discovery order.
      const complete = [...new Set([...customOrder, ...visibleIds, ...discovered])];
      const selected = new Set(visibleIds);
      if (!selected.has(movedId) || !selected.has(targetId) || movedId === targetId) return;
      const movedVisible = visibleIds.filter(id => id !== movedId);
      movedVisible.splice(movedVisible.indexOf(targetId) + (after ? 1 : 0), 0, movedId);
      let cursor = 0;
      customOrder = complete.map(id => selected.has(id) ? movedVisible[cursor++] : id);
      selectedSort = 'custom';
      if (sort) sort.value = 'custom';
      persistSearch();
      vscode.postMessage({ command: 'saveOrder', order: customOrder });
      render(allTasks);
    }

    function isTaskSnapshot(snapshot) {
      const optionalStringKeys = ['workspaceFolderUri', 'workspaceFolderName', 'dependencyState', 'dependencyFailure', 'executionId', 'lastOutcome'];
      const optionalNumberKeys = ['plannedMs', 'lastDurationMs', 'overtimeMs', 'lastExitCode'];
      return Boolean(snapshot) &&
        typeof snapshot === 'object' &&
        !Array.isArray(snapshot) &&
        typeof snapshot.id === 'string' &&
        snapshot.id.trim().length > 0 &&
        typeof snapshot.name === 'string' &&
        typeof snapshot.source === 'string' &&
        typeof snapshot.group === 'string' &&
        (snapshot.tags === undefined || (Array.isArray(snapshot.tags) && snapshot.tags.every(value => typeof value === 'string'))) &&
        Array.isArray(snapshot.dependsOn) &&
        snapshot.dependsOn.every(value => typeof value === 'string') &&
        typeof snapshot.dependsOrder === 'string' &&
        Array.isArray(snapshot.dependencyIds) &&
        snapshot.dependencyIds.every(value => typeof value === 'string') &&
        typeof snapshot.isBackground === 'boolean' &&
        typeof snapshot.isDependency === 'boolean' &&
        typeof snapshot.isRunning === 'boolean' &&
        typeof snapshot.elapsedMs === 'number' &&
        typeof snapshot.runCount === 'number' &&
        typeof snapshot.progress === 'number' &&
        typeof snapshot.progressState === 'string' &&
        typeof snapshot.isStopping === 'boolean' &&
        typeof snapshot.lifecycle === 'string' &&
        typeof snapshot.orphaned === 'boolean' &&
        typeof snapshot.elapsedBasis === 'string' &&
        optionalStringKeys.every(key => snapshot[key] === undefined || typeof snapshot[key] === 'string') &&
        optionalNumberKeys.every(key => snapshot[key] === undefined || typeof snapshot[key] === 'number');
    }
    window.addEventListener('message', event => {
      const message = event.data;
      if (!message || message.command !== 'render' || !Array.isArray(message.snapshots) ||
        !message.snapshots.every(isTaskSnapshot)) return;
      if (Array.isArray(message.customOrder) &&
          message.customOrder.every(id => typeof id === 'string')) {
        customOrder = [...new Set(message.customOrder)];
      }
      render(message.snapshots);
      if (message.warning) renderWarning(message.warning);
      else clearWarning();
    });
    // A webview can finish loading after the provider first posts its cached
    // snapshots. Explicit readiness prevents losing the initial message.
    vscode.postMessage({ command: 'ready' });
    function clearWarning() {
      const retryWasFocused = document.activeElement?.id === 'discoveryRetry';
      warningRegion?.replaceChildren();
      if (retryWasFocused) list.focus({ preventScroll: true });
    }
    function renderWarning(message) {
      if (!warningRegion) return;
      const current = warningRegion.querySelector('.inline-alert');
      if (current && current.dataset.message === message) return;
      const retryWasFocused = document.activeElement?.id === 'discoveryRetry';
      const alert = document.createElement('div');
      alert.className = 'inline-alert';
      alert.dataset.message = message;
      alert.setAttribute('role', 'alert');
      alert.innerHTML = '<span class="inline-alert-copy">' + escapeHtml(message) + '</span><button id="discoveryRetry" type="button" aria-label="Retry task discovery">Retry</button>';
      warningRegion.replaceChildren(alert);
      alert.querySelector('button')?.addEventListener('click', refresh);
      if (retryWasFocused) document.getElementById('discoveryRetry')?.focus({ preventScroll: true });
    }
    function runtimeStatus(task) {
      if (task.lifecycle === 'stopping') return 'Stopping…';
      if (task.lifecycle === 'awaiting-task-end') return 'Process ended · waiting for task end';
      if (task.lifecycle === 'stale') return 'Stale · execution is no longer observable';
      if (task.isRunning) return (task.isBackground ? 'Watch · ' : '') + format(task.elapsedMs) + (task.elapsedBasis === 'since-reload' ? ' · since reload' : '') + (task.overtimeMs ? ' · ' + format(task.overtimeMs) + ' over plan' : '');
      if (task.lastOutcome === 'failed') return 'Failed' + (task.lastExitCode !== undefined ? ' · exit code ' + task.lastExitCode : '');
      if (task.lastOutcome === 'cancelled') return 'Cancelled';
      if (task.lastOutcome === 'unknown') return 'Unknown outcome';
      if (task.lastOutcome === 'stale') return 'Stale · no end event';
      return task.lastDurationMs ? 'Last successful run ' + format(task.lastDurationMs) : 'No run history yet';
    }
    function statusText(task) {
      const dependencyNote = dependencyLabel(task);
      return runtimeStatus(task) + (dependencyNote ? ' · ' + dependencyNote : '');
    }
    function plannedText(task) {
      return task.isBackground && task.isRunning ? 'Runs continuously' : task.plannedMs ? 'Plan ' + format(task.plannedMs) : task.isRunning ? 'Learning duration' : 'Plan will be learned';
    }
    function availableActionsText(task) {
      const actions = [];
      if (task.isRunning) {
        if (!task.isStopping && task.lifecycle !== 'awaiting-task-end') actions.push('Stop');
      } else {
        actions.push('Run');
      }
      if (task.isRunning || task.lastOutcome) actions.push('Restart');
      if (task.source === 'Workspace') actions.push('Edit task definition');
      return actions.length ? actions.join(', ') : 'No actions available';
    }
    function accessibleTaskLabel(task, status, planned) {
      const tags = Array.isArray(task.tags) ? task.tags : [];
      return [task.name, task.source, task.group, task.workspaceFolderName, tags.length ? 'Tags: ' + tags.join(', ') : '', status, planned, 'Available actions: ' + availableActionsText(task)].filter(Boolean).join('. ');
    }
    function taskTagsMarkup(task) {
      const tags = Array.isArray(task.tags) ? task.tags.filter(tag => typeof tag === 'string' && tag.trim()) : [];
      if (!tags.length) return '';
      return '<div class="tags" aria-label="Task tags">' + tags.map(tag => '<span class="tag">' + escapeHtml(tag) + '</span>').join('') + '</div>';
    }
    function updateTaskCards(tasks, renderTime) {
      const cards = Array.from(list.querySelectorAll('article[data-task-id]'));
      tasks.forEach(task => {
        const card = cards.find(candidate =>
          candidate.getAttribute('data-task-id') === task.id &&
          (candidate.getAttribute('data-execution-id') || '') === (task.executionId || '')
        );
        if (!card) return;
        const status = statusText(task);
        const planned = plannedText(task);
        card.setAttribute('aria-label', accessibleTaskLabel(task, status, planned));
        const meta = card.querySelectorAll('.meta span');
        if (meta[0]) {
          meta[0].textContent = status;
          meta[0].classList.toggle('late', Boolean(task.overtimeMs));
        }
        if (meta[1]) meta[1].textContent = planned;
        const bar = card.querySelector('.bar');
        const fill = card.querySelector('.fill');
        if (!bar || !fill) return;
        const progressKey = task.executionId || task.id;
        const clock = progressClocks.get(progressKey);
        const locallyElapsed = task.isRunning && clock ? Math.max(clock.lastElapsedMs, renderTime - clock.startedAt) : task.elapsedMs;
        const indeterminate = task.isRunning && task.progressState === 'unknown';
        const barWidth = indeterminate ? 100 : task.isRunning && task.plannedMs ? Math.min(100, locallyElapsed / task.plannedMs * 100) : task.progress;
        fill.style.width = barWidth + '%';
        if (indeterminate) bar.removeAttribute('aria-valuenow');
        else bar.setAttribute('aria-valuenow', String(Math.round(barWidth)));
        bar.setAttribute('aria-valuetext', status);
      });
      if (list.querySelector('.fill.indeterminate')) startProgressAnimation();
    }
    function captureListFocus() {
      const active = document.activeElement;
      if (!active || !list.contains(active)) return undefined;
      const card = active.closest ? active.closest('article[data-task-id]') : undefined;
      return {
        id: active.id || '',
        action: active.getAttribute('data-action') || '',
        actionId: active.getAttribute('data-id') || '',
        taskId: card?.getAttribute('data-task-id') || '',
        executionId: card?.getAttribute('data-execution-id') || ''
      };
    }
    function restoreListFocus(bookmark) {
      if (!bookmark) return;
      let target = bookmark.id ? document.getElementById(bookmark.id) : undefined;
      if (!target && bookmark.action && bookmark.actionId) {
        target = Array.from(list.querySelectorAll('[data-action]')).find(candidate =>
          candidate.getAttribute('data-action') === bookmark.action &&
          candidate.getAttribute('data-id') === bookmark.actionId
        );
      }
      if (!target && bookmark.action && bookmark.taskId) {
        const actions = Array.from(list.querySelectorAll('[data-action]'));
        target = actions.find(candidate => {
          if (candidate.getAttribute('data-action') !== bookmark.action) return false;
          const card = candidate.closest ? candidate.closest('article[data-task-id]') : undefined;
          return card?.getAttribute('data-task-id') === bookmark.taskId &&
            (!bookmark.executionId || card.getAttribute('data-execution-id') === bookmark.executionId);
        }) || actions.find(candidate => {
          if (candidate.getAttribute('data-action') !== bookmark.action) return false;
          const card = candidate.closest ? candidate.closest('article[data-task-id]') : undefined;
          return card?.getAttribute('data-task-id') === bookmark.taskId;
        });
      }
      if (!target && bookmark.executionId) {
        target = Array.from(list.querySelectorAll('article[data-execution-id]')).find(candidate =>
          candidate.getAttribute('data-execution-id') === bookmark.executionId
        );
      }
      if (!target && bookmark.taskId) {
        target = Array.from(list.querySelectorAll('article[data-task-id]')).find(candidate =>
          candidate.getAttribute('data-task-id') === bookmark.taskId
        );
      }
      (target || list).focus({ preventScroll: true });
    }
    function render(tasks) {
      const focusBookmark = captureListFocus();
      allTasks = tasks;
      updateTagFilterOptions(tasks);
      announceStateChanges(tasks);
      list.setAttribute('aria-busy', 'false');
      let regexPattern;
      try {
        regexPattern = compileViewRegex(query);
        displayRegexError('');
      } catch (error) {
        displayRegexError('Invalid regular expression: ' + (error instanceof Error ? error.message : 'Unknown error'));
        // Preserve the last valid cards rather than showing unfiltered matches.
        return;
      }
      if (!tasks.length) {
        if (lastRenderSignature === 'empty') return;
        lastRenderSignature = 'empty';
        list.innerHTML = '<section class="empty empty-state">' +
          '<div class="empty-ambient" aria-hidden="true"></div>' +
          '<div class="empty-card">' +
          '<div class="empty-visual" aria-hidden="true"><div class="orbit-system"><div class="orbit-ring"></div><div class="orbit-satellite"><span></span></div><div class="empty-core"></div></div></div>' +
          '<h2 class="empty-title">Your board is ready for its first task</h2>' +
          '<p class="empty-copy">Create a workspace task in <code>.vscode/tasks.json</code>. Once you save, it will appear here with history and runtime planning.</p>' +
          '<div class="empty-actions"><button class="empty-cta" id="emptyCreate" type="button">Create task&nbsp; →</button><button class="empty-secondary" id="emptyEdit" type="button">Open tasks.json</button><button class="empty-secondary" id="emptyRefresh" type="button">Refresh</button></div>' +
          '<p class="empty-hint">Only tasks from this workspace file are shown by default. External providers are opt-in.</p>' +
          '</div>' +
          '</section>';
        document.getElementById('emptyCreate')?.addEventListener('click', () => vscode.postMessage({ command: 'create' }));
        document.getElementById('emptyEdit')?.addEventListener('click', () => vscode.postMessage({ command: 'edit' }));
        document.getElementById('emptyRefresh')?.addEventListener('click', refresh);
        restoreListFocus(focusBookmark);
        return;
      }
      const visibleTasks = applyView(tasks, query, selectedFilter, selectedSort, selectedTags, regexPattern, customOrder);
      if (!visibleTasks.length) {
        const emptySignature = JSON.stringify(['filtered-empty', query, selectedFilter, selectedTags, selectedSort, regexEnabled, customOrder]);
        if (lastRenderSignature === emptySignature) return;
        lastRenderSignature = emptySignature;
        list.innerHTML = '<div class="filtered-empty" role="status"><strong>No matching tasks</strong><br><span>Change the search, filters, or tag to see more tasks.</span></div>';
        restoreListFocus(focusBookmark);
        return;
      }
      const renderTime = performance.now();
      visibleTasks.forEach(task => {
        const progressKey = task.executionId || task.id;
        if (task.isRunning) {
          const backendElapsed = Math.max(0, task.elapsedMs || 0);
          const clock = progressClocks.get(progressKey);
          if (!clock) {
            progressClocks.set(progressKey, { startedAt: renderTime - backendElapsed, lastElapsedMs: backendElapsed });
          } else {
            const projectedElapsed = Math.max(0, renderTime - clock.startedAt);
            if (backendElapsed > clock.lastElapsedMs && backendElapsed > projectedElapsed + 120) {
              clock.startedAt = renderTime - backendElapsed;
            }
            clock.lastElapsedMs = Math.max(clock.lastElapsedMs, backendElapsed);
          }
        } else {
          progressClocks.delete(progressKey);
        }
      });
      const renderSignature = JSON.stringify([
        query, selectedFilter, selectedTags, selectedSort, regexEnabled, customOrder,
        ...visibleTasks.map(task => [
          task.id, task.executionId, task.name, task.source, task.group, task.tags || [], task.workspaceFolderName,
          task.isBackground, task.isDependency, task.dependsOn, task.dependsOrder, task.dependencyIds,
          task.dependencyState, task.dependencyFailure, task.isRunning, task.isStopping, task.lifecycle,
          task.orphaned, task.progressState, task.plannedMs, task.lastDurationMs, task.runCount,
          task.lastOutcome, task.lastExitCode, Boolean(task.overtimeMs), task.elapsedBasis
        ])
      ]);
      if (renderSignature === lastRenderSignature) {
        updateTaskCards(visibleTasks, renderTime);
        return;
      }
      lastRenderSignature = renderSignature;
      list.innerHTML = visibleTasks.map(task => {
        const progressKey = task.executionId || task.id;
        const status = statusText(task);
        const planned = plannedText(task);
        const icon = task.lifecycle === 'stopping' ? '…' : task.lifecycle === 'awaiting-task-end' ? '…' : task.lifecycle === 'stale' ? '?' : task.isRunning ? '●' : task.lastOutcome === 'failed' ? '!' : task.lastOutcome === 'cancelled' ? '–' : task.lastOutcome === 'unknown' ? '?' : task.lastDurationMs ? '✓' : '·';
        const actionId = task.isRunning ? task.executionId : task.id;
        const encodedActionId = encodeURIComponent(actionId || task.id);
        const action = task.lifecycle === 'awaiting-task-end' ? '<button class="stop" disabled title="Waiting for task end" aria-label="Waiting for task end">…</button>' : task.isRunning ? task.isStopping ? '<button class="stop" disabled title="Task is stopping" aria-label="Task is stopping">…</button>' : '<button class="stop" data-action="stop" data-id="' + encodedActionId + '" title="Stop task" aria-label="Stop ' + escapeHtml(task.name) + '">■</button>' : '<button class="run" data-action="run" data-id="' + encodedActionId + '" title="Run task" aria-label="Run ' + escapeHtml(task.name) + '">▶</button>';
        const restartAction = task.isRunning || task.lastOutcome ? '<button class="restart" data-action="restart" data-id="' + encodedActionId + '" title="Restart task" aria-label="Restart ' + escapeHtml(task.name) + '">↻</button>' : '';
        const editAction = task.source === 'Workspace' ? '<button class="edit" data-action="edit" data-id="' + encodeURIComponent(task.id) + '" title="Edit task definition" aria-label="Edit ' + escapeHtml(task.name) + '">✎</button>' : '';
        const indeterminate = task.isRunning && task.progressState === 'unknown';
        const clock = progressClocks.get(progressKey);
        const locallyElapsed = task.isRunning && clock ? Math.max(clock.lastElapsedMs, renderTime - clock.startedAt) : task.elapsedMs;
        const barWidth = indeterminate ? 100 : task.isRunning && task.plannedMs ? Math.min(100, locallyElapsed / task.plannedMs * 100) : task.progress;
        const progressId = encodeURIComponent(task.executionId || task.id);
        const plannedMs = task.plannedMs || '';
        const stateClass = task.lifecycle === 'awaiting-task-end' ? 'awaiting' : task.isRunning ? 'running' : task.progressState === 'completed' ? 'completed' : task.lifecycle === 'stale' || task.lastOutcome === 'stale' ? 'stale' : task.lastOutcome === 'failed' ? 'failed' : task.lastOutcome === 'cancelled' ? 'cancelled' : task.lastOutcome === 'unknown' ? 'unknown' : '';
        const dependencyClass = task.dependencyState ? ' dependency-' + task.dependencyState : '';
        const executionLabel = task.executionId ? ' · ' + escapeHtml(task.executionId) : '';
        const accessibleLabel = escapeHtml(accessibleTaskLabel(task, status, planned));
        const tagsMarkup = taskTagsMarkup(task);
        const progressValue = indeterminate ? '' : ' aria-valuenow="' + Math.round(barWidth) + '"';
        return '<article draggable="true" class="task ' + stateClass + dependencyClass + (task.orphaned ? ' orphaned' : '') + (task.isStopping ? ' stopping' : '') + (task.overtimeMs ? ' overdue' : '') + '" role="article" tabindex="-1" data-task-id="' + escapeHtml(task.id) + '" data-execution-id="' + escapeHtml(task.executionId || '') + '" aria-label="' + accessibleLabel + '">' +
          '<div class="row"><span class="glyph" aria-hidden="true">' + icon + '</span><h2 class="name" title="' + escapeHtml(task.name) + '">' + escapeHtml(task.name) + '</h2><span class="task-actions"><span class="move-actions"><button type="button" data-reorder="up" data-id="' + encodeURIComponent(task.id) + '" aria-label="Move ' + escapeHtml(task.name) + ' up" title="Move up">↑</button><button type="button" data-reorder="down" data-id="' + encodeURIComponent(task.id) + '" aria-label="Move ' + escapeHtml(task.name) + ' down" title="Move down">↓</button></span>' + action + restartAction + editAction + '</span></div>' +
          '<div class="sub" title="' + escapeHtml(task.source + ' · ' + task.group + (task.workspaceFolderName ? ' · ' + task.workspaceFolderName : '')) + '">' + escapeHtml(task.source) + ' · ' + escapeHtml(task.group) + (task.workspaceFolderName ? ' · ' + escapeHtml(task.workspaceFolderName) : '') + (task.isDependency ? ' · Child' : task.dependsOn.length ? ' · Depends on ' + escapeHtml(task.dependsOn.join(', ')) + ' (' + escapeHtml(task.dependsOrder) + ')' : '') + executionLabel + (task.orphaned ? ' · Orphaned' : '') + '</div>' + tagsMarkup +
          '<div class="bar" role="progressbar" aria-label="Progress for ' + escapeHtml(task.name) + '" aria-valuemin="0" aria-valuemax="100"' + progressValue + ' aria-valuetext="' + escapeHtml(status) + '"><div class="fill' + (indeterminate ? ' indeterminate' : '') + '" data-progress-id="' + progressId + '" data-planned-ms="' + plannedMs + '" style="width:' + barWidth + '%"></div></div>' +
          '<div class="meta"><span class="' + (task.overtimeMs ? 'late' : '') + '">' + escapeHtml(status) + '</span><span>' + escapeHtml(planned) + '</span></div>' +
          '</article>';
      }).join('');
      list.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', event => {
        const target = event.currentTarget;
        const encodedId = target.dataset.id;
        if (!encodedId) return;
        vscode.postMessage({ command: target.dataset.action, id: decodeURIComponent(encodedId) });
      }));
      list.querySelectorAll('article[data-task-id]').forEach(article => {
        article.addEventListener('dragstart', event => {
          draggedId = article.getAttribute('data-task-id') || '';
          if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', draggedId);
          }
        });
        article.addEventListener('dragover', event => {
          if (!draggedId) return;
          event.preventDefault();
          article.classList.add('drag-over');
        });
        article.addEventListener('dragleave', () => article.classList.remove('drag-over'));
        article.addEventListener('drop', event => {
          event.preventDefault();
          article.classList.remove('drag-over');
          const targetId = article.getAttribute('data-task-id') || '';
          const bounds = article.getBoundingClientRect();
          const after = event.clientY > bounds.top + bounds.height / 2;
          moveVisibleTask(draggedId, targetId, after);
          draggedId = '';
        });
        article.addEventListener('dragend', () => { draggedId = ''; article.classList.remove('drag-over'); });
      });
      list.querySelectorAll('[data-reorder]').forEach(button => button.addEventListener('click', event => {
        const target = event.currentTarget;
        const id = decodeURIComponent(target.dataset.id || '');
        const visibleIds = [...new Set(visibleForReorder().map(task => task.id))];
        const index = visibleIds.indexOf(id);
        if (index < 0) return;
        if (target.dataset.reorder === 'up' && index > 0) moveVisibleTask(id, visibleIds[index - 1]);
        if (target.dataset.reorder === 'down' && index < visibleIds.length - 1) moveVisibleTask(id, visibleIds[index + 1], true);
      }));
      restoreListFocus(focusBookmark);
      if (list.querySelector('.fill.indeterminate')) startProgressAnimation();
    }
    function announceStateChanges(tasks) {
      const nextStates = new Map();
      const messages = [];
      tasks.forEach(task => {
        const key = task.executionId || task.id;
        const state = task.lifecycle + '|' + (task.lastOutcome || '');
        const previous = announcedStates.get(key);
        if (receivedInitialSnapshot && previous !== state) {
          const label = task.isRunning ? task.isStopping ? 'Stopping' : task.lifecycle === 'awaiting-task-end' ? 'Finishing' : 'Running' : task.lastOutcome === 'success' ? 'Completed successfully' : task.lastOutcome === 'failed' ? 'Failed' : task.lastOutcome === 'cancelled' ? 'Cancelled' : task.lastOutcome === 'stale' ? 'No longer observable' : task.lastOutcome === 'unknown' ? 'Outcome unknown' : 'Ready';
          const duration = task.isRunning ? format(task.elapsedMs) + ' elapsed.' : task.lastOutcome === 'success' && task.lastDurationMs ? 'Last successful run ' + format(task.lastDurationMs) + '.' : '';
          messages.push(task.name + ', ' + task.source + ': ' + label + '. ' + duration);
        }
        nextStates.set(key, state);
      });
      announcedStates = nextStates;
      if (messages.length && announcer) announcer.textContent = messages.join(' ');
      receivedInitialSnapshot = true;
    }
    function startProgressAnimation() {
      if (progressFrame || reducedMotion.matches) return;
      progressLastTime = 0;
      progressFrame = requestAnimationFrame(animateProgress);
    }
    function animateProgress(timestamp) {
      const fills = document.querySelectorAll('.task.running .fill');
      if (!fills.length) { progressFrame = 0; return; }
      if (reducedMotion.matches) { progressFrame = 0; return; }
      if (!progressLastTime) progressLastTime = timestamp;
      const delta = Math.min(50, timestamp - progressLastTime);
      progressLastTime = timestamp;
      fills.forEach(fill => {
        const progressId = decodeURIComponent(fill.dataset.progressId || '');
        const clock = progressClocks.get(progressId);
        const plannedMs = Number(fill.dataset.plannedMs || 0);
        if (plannedMs && clock) {
          const elapsed = Math.max(clock.lastElapsedMs, timestamp - clock.startedAt);
          clock.lastElapsedMs = elapsed;
          const percent = Math.min(100, elapsed / plannedMs * 100);
          fill.style.width = percent + '%';
          const bar = fill.parentElement;
          if (bar) {
            bar.setAttribute('aria-valuenow', String(Math.round(percent)));
            bar.setAttribute('aria-valuetext', format(elapsed) + ' elapsed');
          }
        }
      });
      const indeterminate = document.querySelector('.fill.indeterminate');
      if (indeterminate) {
        progressOffset += delta * 0.075;
        if (progressOffset >= 330) progressOffset -= 500;
        indeterminate.style.setProperty('--flow-x', progressOffset + '%');
      }
      progressFrame = requestAnimationFrame(animateProgress);
    }
    function updateTagFilterOptions(tasks) {
      if (!tagFilter) return;
      const tagsByKey = new Map();
      tasks.forEach(task => {
        const tags = Array.isArray(task.tags) ? task.tags : [];
        tags.forEach(tag => {
          if (typeof tag !== 'string') return;
          const label = tag.trim();
          const key = label.toLocaleLowerCase();
          if (key && !tagsByKey.has(key)) tagsByKey.set(key, label);
        });
      });
      const entries = Array.from(tagsByKey.entries()).sort((left, right) => left[1].localeCompare(right[1]));
      selectedTags = selectedTags.filter(tag => tagsByKey.has(tag));
      document.getElementById('tagSummary').textContent = 'Tags (all required)' + (selectedTags.length ? ' · ' + selectedTags.length + ' selected' : '');
      const signature = JSON.stringify(entries);
      if (signature !== tagOptionsSignature) {
        tagFilter.innerHTML = entries.length ? entries
          .map(([value, label]) => '<label><input type="checkbox" value="' + escapeHtml(value) + '"> ' + escapeHtml(label) + '</label>')
          .join('') : '<span>No tags available</span>';
        tagOptionsSignature = signature;
      }
      tagFilter.querySelectorAll('input').forEach(input => { input.checked = selectedTags.includes(input.value); });
    }
    function applyView(tasks, query, filter, sort, tagFilter, regexPattern, order = []) {
      const needle = String(query || '').trim().toLocaleLowerCase();
      const selectedTags = tagFilter.map(tag => tag.trim().toLocaleLowerCase()).filter(Boolean);
      const matches = tasks.filter(task => {
        const tags = Array.isArray(task.tags) ? task.tags.filter(tag => typeof tag === 'string') : [];
        const searchable = [task.name, task.source, task.group, task.workspaceFolderName || '', ...tags].join(' ').toLocaleLowerCase();
        if (regexPattern) {
          const fields = [task.name, task.source, task.group, task.workspaceFolderName || '', ...tags];
          if (!fields.some(field => regexPattern.test(String(field).slice(0, 2048)))) return false;
        } else if (needle && !searchable.includes(needle)) return false;
        if (!selectedTags.every(selectedTag => tags.some(tag => tag.trim().toLocaleLowerCase() === selectedTag))) return false;
        if (filter === 'running' && !task.isRunning) return false;
        if (filter === 'failed' && task.lastOutcome !== 'failed') return false;
        if (filter === 'completed' && task.lastOutcome !== 'success') return false;
        if (filter === 'unknown' && !(['unknown', 'stale'].includes(task.lastOutcome) || task.progressState === 'unknown')) return false;
        if (filter === 'external' && task.source === 'Workspace') return false;
        return true;
      });
      const customIndex = new Map(order.map((id, index) => [id, index]));
      const rank = task => task.isRunning ? 0 : task.lastOutcome === 'failed' ? 1 : ['unknown', 'stale'].includes(task.lastOutcome) ? 2 : task.lastOutcome === 'success' ? 3 : 4;
      return matches.slice().sort((left, right) => {
        let result = sort === 'status' ? rank(left) - rank(right) : sort === 'elapsed' ? right.elapsedMs - left.elapsedMs : sort === 'folder' ? (left.workspaceFolderName || '').localeCompare(right.workspaceFolderName || '') : sort === 'custom' ? (customIndex.get(left.id) ?? Infinity) - (customIndex.get(right.id) ?? Infinity) : 0;
        // Two unknown IDs yield Infinity - Infinity = NaN: use normal name ordering.
        if (Number.isNaN(result)) result = 0;
        return result || left.name.localeCompare(right.name) || left.source.localeCompare(right.source) || left.id.localeCompare(right.id) || (left.executionId || '').localeCompare(right.executionId || '');
      });
    }
    function dependencyLabel(task) {
      if (!task.dependencyState) return '';
      const name = task.dependencyFailure ? ': ' + task.dependencyFailure : '';
      if (task.dependencyState === 'failed') return 'Dependency failed' + name;
      if (task.dependencyState === 'cancelled') return 'Dependency cancelled' + name;
      if (task.dependencyState === 'unknown') return 'Dependency unknown' + name;
      if (task.dependencyState === 'running') return 'Dependency running' + name;
      if (task.dependencyState === 'success') return 'Dependencies satisfied';
      return 'Dependency unresolved' + name;
    }
    function format(ms) { const s = Math.max(1, Math.round(ms / 1000)); const m = Math.floor(s / 60); const sec = s % 60; return m ? m + 'm ' + String(sec).padStart(2, '0') + 's' : sec + 's'; }
    function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]); }
  </script>
</body>
</html>`;
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let value = '';
  for (let index = 0; index < 32; index += 1) value += chars.charAt(Math.floor(Math.random() * chars.length));
  return value;
}
