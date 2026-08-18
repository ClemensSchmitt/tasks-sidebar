import * as vscode from 'vscode';

type TaskHistory = {
  lastDurationMs?: number;
  lastCompletedAt?: number;
  runCount: number;
  durationsMs: number[];
};

type TaskSnapshot = {
  id: string;
  name: string;
  source: string;
  group: string;
  isRunning: boolean;
  elapsedMs: number;
  plannedMs?: number;
  lastDurationMs?: number;
  runCount: number;
  progress: number;
  overtimeMs?: number;
};

const HISTORY_KEY = 'tasksSidebar.history';
const MAX_HISTORY_ENTRIES = 20;

export function activate(context: vscode.ExtensionContext): void {
  const board = new TaskBoard(context);
  const view = new TaskBoardView(context.extensionUri, board);
  board.attachView(view);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('tasksSidebar.view', view, {
      webviewOptions: { retainContextWhenHidden: true }
    }),
    vscode.commands.registerCommand('tasksSidebar.refresh', () => board.refresh()),
    vscode.commands.registerCommand('tasksSidebar.openTasksJson', () => board.openTasksJson()),
    vscode.commands.registerCommand('tasksSidebar.toggleExternalTasks', () => board.toggleExternalTasks()),
    vscode.tasks.onDidStartTask(event => board.started(event.execution)),
    vscode.tasks.onDidEndTask(event => board.ended(event.execution)),
    { dispose: () => board.dispose() }
  );

  board.refresh();
}

export function deactivate(): void {}

class TaskBoard {
  private view?: TaskBoardView;
  private timer?: NodeJS.Timeout;
  private disposed = false;
  private readonly running = new Map<string, { execution: vscode.TaskExecution; startedAt: number }>();
  private readonly history: Record<string, TaskHistory>;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.history = context.workspaceState.get<Record<string, TaskHistory>>(HISTORY_KEY, {});
    this.timer = setInterval(() => this.publish(), 1000);
  }

  attachView(view: TaskBoardView): void {
    this.view = view;
  }

  async refresh(): Promise<void> {
    await this.publish();
  }

  async toggleExternalTasks(): Promise<void> {
    const configuration = vscode.workspace.getConfiguration('tasksSidebar');
    const current = configuration.get<boolean>('includeExternalTasks', false);
    await configuration.update('includeExternalTasks', !current, vscode.ConfigurationTarget.Workspace);
    await this.publish();
    void vscode.window.showInformationMessage(
      !current ? 'Externe Task-Provider eingeblendet.' : 'Nur Tasks aus .vscode/tasks.json eingeblendet.'
    );
  }

  async run(id: string): Promise<void> {
    const task = await this.findTask(id);
    if (!task) {
      void vscode.window.showWarningMessage('Dieser Task ist nicht mehr verfügbar. Aktualisiere die Ansicht.');
      return;
    }
    const execution = await vscode.tasks.executeTask(task);
    this.running.set(id, { execution, startedAt: Date.now() });
    await this.publish();
  }

  async stop(id: string): Promise<void> {
    const active = this.running.get(id);
    if (active) {
      active.execution.terminate();
      this.running.delete(id);
      await this.publish();
    }
  }

  started(execution: vscode.TaskExecution): void {
    const id = taskId(execution.task);
    this.running.set(id, { execution, startedAt: Date.now() });
    void this.publish();
  }

  ended(execution: vscode.TaskExecution): void {
    const id = taskId(execution.task);
    const active = this.running.get(id);
    if (active) {
      const durationMs = Math.max(0, Date.now() - active.startedAt);
      const previous = this.history[id] ?? { runCount: 0, durationsMs: [] };
      previous.lastDurationMs = durationMs;
      previous.lastCompletedAt = Date.now();
      previous.runCount += 1;
      previous.durationsMs = [durationMs, ...previous.durationsMs].slice(0, MAX_HISTORY_ENTRIES);
      this.history[id] = previous;
      void this.context.workspaceState.update(HISTORY_KEY, this.history);
    }
    this.running.delete(id);
    void this.publish();
  }

  async openTasksJson(): Promise<void> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      void vscode.window.showInformationMessage('Öffne zuerst einen Workspace, um tasks.json zu bearbeiten.');
      return;
    }
    const uri = vscode.Uri.joinPath(folder.uri, '.vscode', 'tasks.json');
    try {
      await vscode.workspace.fs.stat(uri);
    } catch {
      await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(folder.uri, '.vscode'));
      const template = '{\n  "version": "2.0.0",\n  "tasks": []\n}\n';
      await vscode.workspace.fs.writeFile(uri, Buffer.from(template, 'utf8'));
    }
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document);
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) clearInterval(this.timer);
  }

  private async findTask(id: string): Promise<vscode.Task | undefined> {
    const tasks = await vscode.tasks.fetchTasks();
    return tasks.find(task => taskId(task) === id);
  }

  private async publish(): Promise<void> {
    if (this.disposed || !this.view) return;
    const tasks = await vscode.tasks.fetchTasks();
    const includeExternalTasks = vscode.workspace
      .getConfiguration('tasksSidebar')
      .get<boolean>('includeExternalTasks', false);
    const snapshots = tasks
      .filter(task => includeExternalTasks || isWorkspaceJsonTask(task))
      .filter(task => task.name.trim().length > 0)
      .reduce((unique, task) => {
        if (!unique.some(existing => existing.id === taskId(task))) unique.push(toSnapshot(task, this.running, this.history));
        return unique;
      }, [] as TaskSnapshot[])
      .sort((a, b) => Number(b.isRunning) - Number(a.isRunning) || a.name.localeCompare(b.name));
    this.view.render(snapshots);
  }
}

function isWorkspaceJsonTask(task: vscode.Task): boolean {
  if (task.source !== 'Workspace') return false;
  return typeof task.scope === 'object' && task.scope !== null && 'uri' in task.scope;
}

class TaskBoardView implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private pending?: TaskSnapshot[];

  constructor(private readonly extensionUri: vscode.Uri, private readonly board: TaskBoard) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [this.extensionUri] };
    view.webview.html = getHtml(view.webview);
    view.webview.onDidReceiveMessage(async message => {
      switch (message.command) {
        case 'run': await this.board.run(String(message.id)); break;
        case 'stop': await this.board.stop(String(message.id)); break;
        case 'refresh': await this.board.refresh(); break;
        case 'edit': await this.board.openTasksJson(); break;
      }
    });
    if (this.pending) this.render(this.pending);
  }

  render(snapshots: TaskSnapshot[]): void {
    this.pending = snapshots;
    this.view?.webview.postMessage({ command: 'render', snapshots });
  }
}

function toSnapshot(
  task: vscode.Task,
  running: Map<string, { execution: vscode.TaskExecution; startedAt: number }>,
  history: Record<string, TaskHistory>
): TaskSnapshot {
  const id = taskId(task);
  const active = running.get(id);
  const record = history[id] ?? { runCount: 0, durationsMs: [] };
  const elapsedMs = active ? Date.now() - active.startedAt : 0;
  const plannedMs = record.lastDurationMs;
  return {
    id,
    name: task.name,
    source: task.source || 'Workspace',
    group: taskGroupLabel(task),
    isRunning: Boolean(active),
    elapsedMs,
    plannedMs,
    lastDurationMs: record.lastDurationMs,
    runCount: record.runCount,
    progress: plannedMs ? Math.min(100, Math.round((active ? elapsedMs : plannedMs) / plannedMs * 100)) : 0,
    overtimeMs: active && plannedMs && elapsedMs > plannedMs ? elapsedMs - plannedMs : undefined
  };
}

function taskGroupLabel(task: vscode.Task): string {
  if (!task.group) return 'Task';
  return typeof task.group === 'string' ? task.group : task.group.id || 'Task';
}

function taskId(task: vscode.Task): string {
  let definition = '';
  try { definition = JSON.stringify(task.definition); } catch { definition = task.definition.type; }
  const scope = typeof task.scope === 'object' && task.scope ? task.scope.uri.toString() : String(task.scope ?? 'global');
  return `${task.source}:${task.name}:${scope}:${definition}`;
}

function getHtml(webview: vscode.Webview): string {
  const nonce = getNonce();
  return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <style>
    :root { --violet: #a78bfa; --mint: #5eead4; --ink: #f8fafc; --muted: #94a3b8; --line: rgba(148,163,184,.18); }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 12px; color: var(--ink); font-family: var(--vscode-font-family); font-size: 12px; background: linear-gradient(160deg, rgba(124,58,237,.09), transparent 44%); }
    .top { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 14px; }
    .eyebrow { color: var(--mint); font-size: 10px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; }
    h1 { margin: 3px 0 0; font-size: 21px; letter-spacing: -.03em; }
    .actions { display: flex; gap: 4px; }
    button { border: 0; color: inherit; background: transparent; cursor: pointer; border-radius: 6px; padding: 5px 7px; font: inherit; }
    button:hover { background: var(--vscode-toolbar-hoverBackground); }
    .primary { background: rgba(167,139,250,.16); color: var(--violet); }
    .primary:hover { background: rgba(167,139,250,.27); }
    .empty { padding: 18px 4px; color: var(--muted); line-height: 1.55; }
    .empty strong { display: block; color: var(--ink); font-size: 13px; margin-bottom: 5px; }
    .task { border: 1px solid var(--line); background: rgba(15,23,42,.28); border-radius: 10px; padding: 10px; margin: 8px 0; transition: transform .18s ease, border-color .18s ease; }
    .task:hover { transform: translateY(-1px); border-color: rgba(167,139,250,.5); }
    .task.running { border-color: rgba(94,234,212,.45); box-shadow: 0 0 20px rgba(94,234,212,.06); }
    .row { display: flex; gap: 8px; align-items: center; }
    .glyph { width: 21px; height: 21px; border-radius: 7px; display: grid; place-items: center; background: rgba(148,163,184,.13); color: var(--muted); flex: 0 0 auto; }
    .running .glyph { color: var(--mint); background: rgba(94,234,212,.13); animation: pulse 1.8s ease-in-out infinite; }
    .name { font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
    .sub { color: var(--muted); font-size: 10px; margin: 4px 0 8px 29px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .bar { height: 5px; background: rgba(148,163,184,.15); border-radius: 20px; overflow: hidden; }
    .fill { height: 100%; width: 0; border-radius: inherit; background: linear-gradient(90deg, var(--violet), var(--mint)); transition: width .6s ease; }
    .running .fill { animation: shimmer 1.5s linear infinite; background-size: 200% 100%; }
    .meta { display: flex; justify-content: space-between; gap: 8px; color: var(--muted); font-size: 10px; margin: 7px 0 0 29px; }
    .late { color: #fda4af; }
    .task-actions { margin-left: auto; display: flex; }
    .run { color: var(--mint); }
    .stop { color: #fb7185; }
    @keyframes pulse { 50% { transform: scale(1.08); } }
    @keyframes shimmer { from { background-position: 100% 0; } to { background-position: -100% 0; } }
  </style>
</head>
<body>
  <div class="top">
    <div><div class="eyebrow">Workspace flow</div><h1>Tasks</h1></div>
    <div class="actions"><button type="button" id="refresh" title="Aktualisieren" aria-label="Aktualisieren">↻</button><button type="button" id="edit" class="primary" title="tasks.json öffnen" aria-label="tasks.json öffnen">✎</button></div>
  </div>
  <main id="list"><div class="empty"><strong>Tasks werden geladen …</strong>Ich suche nach deinen VS-Code-Tasks.</div></main>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const list = document.getElementById('list');
    const refresh = () => vscode.postMessage({ command: 'refresh' });
    document.getElementById('refresh')?.addEventListener('click', refresh);
    document.getElementById('edit')?.addEventListener('click', () => vscode.postMessage({ command: 'edit' }));
    window.addEventListener('message', event => render(event.data.snapshots || []));
    function render(tasks) {
      if (!tasks.length) {
        list.innerHTML = '<div class="empty"><strong>Keine Workspace-Tasks gefunden</strong>Lege einen Task in <code>.vscode/tasks.json</code> an und aktualisiere diese Ansicht. Externe Provider lassen sich über die Command Palette einblenden.</div>';
        return;
      }
      list.innerHTML = tasks.map(task => {
        const status = task.isRunning ? format(task.elapsedMs) + (task.overtimeMs ? ' · ' + format(task.overtimeMs) + ' länger als üblich' : '') : task.lastDurationMs ? 'Zuletzt ' + format(task.lastDurationMs) : 'Noch kein Verlauf';
        const planned = task.plannedMs ? 'Plan ' + format(task.plannedMs) : 'Plan wird gelernt';
        const icon = task.isRunning ? '●' : task.lastDurationMs ? '✓' : '·';
        const action = task.isRunning ? '<button class="stop" data-action="stop" title="Task stoppen">■</button>' : '<button class="run" data-action="run" title="Task ausführen">▶</button>';
        return '<article class="task ' + (task.isRunning ? 'running' : '') + '">' +
          '<div class="row"><span class="glyph">' + icon + '</span><span class="name" title="' + escapeHtml(task.name) + '">' + escapeHtml(task.name) + '</span><span class="task-actions">' + action + '</span></div>' +
          '<div class="sub">' + escapeHtml(task.source) + ' · ' + escapeHtml(task.group) + '</div>' +
          '<div class="bar"><div class="fill" style="width:' + task.progress + '%"></div></div>' +
          '<div class="meta"><span class="' + (task.overtimeMs ? 'late' : '') + '">' + escapeHtml(status) + '</span><span>' + escapeHtml(planned) + '</span></div>' +
          '<button class="task-hit" data-action="' + (task.isRunning ? 'stop' : 'run') + '" data-id="' + encodeURIComponent(task.id) + '" aria-label="' + (task.isRunning ? 'Task stoppen' : 'Task ausführen') + '"></button>' +
          '</article>';
      }).join('');
      list.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', event => {
        const target = event.currentTarget;
        if (target.classList.contains('task-hit')) return;
        const card = target.closest('.task');
        const hit = card && card.querySelector('.task-hit');
        vscode.postMessage({ command: target.dataset.action, id: decodeURIComponent(hit.dataset.id) });
      }));
      list.querySelectorAll('.task-hit').forEach(button => button.addEventListener('click', () => vscode.postMessage({ command: button.dataset.action, id: decodeURIComponent(button.dataset.id) })));
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
