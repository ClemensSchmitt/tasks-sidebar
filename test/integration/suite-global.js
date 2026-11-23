const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs/promises');
const vscode = require('vscode');
const { TaskBoard, TaskBoardView } = require('../../out/extension.js');
const { duplicateLabel, fixture } = require('./global-fixture.js');
const source = 'Global · Tasks Sidebar';

function useTestHome() {
  const home = process.env.TASKS_SIDEBAR_TEST_PROFILE;
  assert.ok(home, 'An isolated home must be provided by the integration launcher.');
  // Set this in the Extension Host after Electron and its task service start.
  process.env[process.platform === 'win32' ? 'USERPROFILE' : 'HOME'] = home;
}

async function waitFor(read, description) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const result = await read();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error('Timed out waiting for ' + description);
}

async function testGlobalTasks({ execute = false } = {}) {
  const home = process.env.TASKS_SIDEBAR_TEST_PROFILE;
  assert.equal(os.homedir(), home, 'Integration tests must use the isolated, redirected home.');
  const globalPath = path.join(home, '.vscode', 'extensions', 'tasksidebar', 'tasks.json');
  const uri = vscode.Uri.file(globalPath).toString();
  const extension = vscode.extensions.getExtension('ClemboMembo.tasks-sidebar');
  assert.ok(extension);
  await extension.activate();
  assert.ok((await vscode.commands.getCommands(true)).includes('tasksSidebar.openGlobalTasks'));
  assert.equal(vscode.workspace.getConfiguration('tasksSidebar').get('includeExternalTasks'), false);

  const board = new TaskBoard({ workspaceState: { get: (_key, fallback) => fallback, update: async () => {} } });
  const view = new TaskBoardView(extension.extensionUri, 'integration', 'local', board);
  board.attachView(view);
  const subscriptions = [
    board.watchGlobalTasks(),
    vscode.tasks.onDidStartTask(event => board.started(event.execution)),
    vscode.tasks.onDidStartTaskProcess(event => board.processStarted(event.execution)),
    vscode.tasks.onDidEndTaskProcess(event => board.processEnded(event.execution, event.exitCode)),
    vscode.tasks.onDidEndTask(event => board.ended(event.execution))
  ];
  const globals = () => view.pending.filter(task => task.source === source);
  try {
    if (vscode.workspace.workspaceFolders?.length) {
      const fetchTasks = board.fetchTasksWithProviderFallback.bind(board);
      let releaseProviders;
      const gate = new Promise(resolve => { releaseProviders = resolve; });
      board.fetchTasksWithProviderFallback = async () => {
        await gate;
        return fetchTasks();
      };
      const startup = board.refresh();
      try {
        await waitFor(() => view.pending?.some(task => task.source === source), 'global tasks before workspace providers complete');
        let replayed;
        view.resolveWebviewView({ webview: {
          onDidReceiveMessage() { return { dispose() {} }; },
          postMessage(message) { replayed = message; return Promise.resolve(true); }
        } });
        assert.ok(replayed.snapshots.some(task => task.source === source && task.name === duplicateLabel));
      } finally {
        releaseProviders();
        await startup;
        board.fetchTasksWithProviderFallback = fetchTasks;
      }
      // Workspace task providers may need an additional scan during host startup.
      await waitFor(async () => {
        await board.refresh();
        return view.pending.some(task => task.name === duplicateLabel && task.source === 'Workspace');
      }, 'workspace tasks merged with global tasks');
    } else {
      await board.refresh();
    }
    const duplicate = globals().filter(task => task.name === duplicateLabel);
    assert.equal(duplicate.length, 1, 'The shared definitions are preloaded and identical entries deduplicated.');
    assert.deepEqual(duplicate[0].tags, ['Shared']);
    const workspaceTasks = view.pending.filter(task => task.name === duplicateLabel && task.source === 'Workspace');
    if (vscode.workspace.workspaceFolders?.length) {
      assert.equal(workspaceTasks.length, 1);
      assert.notEqual(workspaceTasks[0].id, duplicate[0].id);
      if (vscode.workspace.workspaceFile) assert.ok(view.pending.some(task => task.workspaceScoped));
    } else {
      assert.equal(workspaceTasks.length, 0);
    }
    assert.equal(vscode.tasks.taskExecutions.filter(execution => execution.task.source === source).length, 0);
    await board.openTasksJson(duplicate[0].id);
    const editor = vscode.window.activeTextEditor;
    assert.equal(editor.document.uri.toString(), uri);
    assert.equal(JSON.parse(editor.document.getText(editor.selection)).label, duplicateLabel);
    assert.equal(editor.selection.start.line, 0); // The fixture is serialized to one line.
    assert.equal(editor.document.offsetAt(editor.selection.start), editor.document.getText().indexOf('{"label"'));

    // The same discovery/edit checks run in three independently launched windows.
    if (!execute) {
      if (vscode.workspace.workspaceFolders?.length === 1) {
        const workspaceId = workspaceTasks[0].id;
        await board.run(workspaceId);
        const execution = await waitFor(() => view.pending.find(task => task.id === workspaceId && task.isRunning),
          'workspace task to start');
        try {
          // The next refresh should measure from the active run while providers are blocked.
          board.running.get(execution.executionId).startedAtMonotonic -= 5000;
          const fetchTasks = board.fetchTasksWithProviderFallback.bind(board);
          let releaseProviders;
          const gate = new Promise(resolve => { releaseProviders = resolve; });
          let providerWaiting = false;
          board.fetchTasksWithProviderFallback = async () => {
            providerWaiting = true;
            await gate;
            return fetchTasks();
          };
          const refresh = board.refresh();
          try {
            await waitFor(() => providerWaiting, 'workspace provider to block');
            assert.ok(view.pending.find(task => task.id === workspaceId).elapsedMs >= 5000,
              'An interim global refresh must not reset workspace task elapsed time.');
          } finally {
            releaseProviders();
            await refresh;
            board.fetchTasksWithProviderFallback = fetchTasks;
          }
        } finally {
          await board.stop(execution.executionId);
          await waitFor(() => view.pending.find(task => task.id === workspaceId && !task.isRunning), 'workspace task to stop');
        }
        const original = await fs.readFile(globalPath, 'utf8');
        try {
          await fs.writeFile(globalPath, '{"version":', 'utf8');
          await waitFor(() => view.pendingWarning?.includes(uri) && view.pendingWarning.includes('Invalid JSONC'), 'malformed file warning with a workspace');
          assert.ok(view.pending.some(task => task.name === duplicateLabel && task.source === 'Workspace'));
          assert.equal(globals().length, 3);
        } finally {
          await fs.writeFile(globalPath, original, 'utf8');
        }
      }
      return;
    }
    async function createGlobalTask(label) {
      const choices = [label, 'echo created'];
      const errors = [];
      const reportError = board.reportError;
      board.reportError = (message, error) => errors.push(`${message} ${error?.message ?? ''}`);
      try {
        await board.createTask({
          showQuickPick() { assert.fail('An empty window has only the global destination.'); },
          showInputBox: async () => choices.shift()
        });
      } finally {
        board.reportError = reportError;
      }
      assert.deepEqual(errors, []);
      const created = JSON.parse(await fs.readFile(globalPath, 'utf8')).tasks;
      assert.ok(created.some(task => task.label === label), 'The global file must contain the saved definition.');
    }
    await board.openGlobalTasks();
    await createGlobalTask('Append to existing global file');
    for (const name of ['Global shell integration task', 'Global cwd integration task']) {
      const { id } = globals().find(task => task.name === name);
      await board.run(id);
      try {
        await waitFor(() => globals().find(task => task.id === id && task.runCount === 1 && task.lastOutcome === 'success'), name + ' successful history');
      } catch (error) {
        const status = globals().find(task => task.id === id);
        throw new Error(`${error.message}. Latest card: ${JSON.stringify(status)}`);
      }
    }

    const { id } = duplicate[0];
    const startedProcesses = new Set();
    subscriptions.push(vscode.tasks.onDidStartTaskProcess(event => {
      if (event.execution.task.source === source && event.execution.task.name === duplicateLabel) {
        startedProcesses.add(event.execution);
      }
    }));
    await board.run(id);
    const running = await waitFor(() => globals().find(task => task.id === id && task.isRunning), 'first global run');
    assert.equal(startedProcesses.size, 1, 'The run card must wait for VS Code to start its process.');
    await board.restart(running.executionId);
    const restarted = await waitFor(() => globals().find(task => task.id === id && task.isRunning &&
      task.executionId !== running.executionId), 'restarted global run');
    assert.equal(startedProcesses.size, 2);

    await fs.writeFile(globalPath, '{"version":', 'utf8');
    await waitFor(() => view.pendingWarning?.includes(uri) && view.pendingWarning.includes('Invalid JSONC'), 'malformed file warning');
    assert.equal(globals().length, 4, 'A malformed save preserves the last good discovery.');

    await fs.writeFile(globalPath, JSON.stringify({ ...fixture, tasks: fixture.tasks.filter(task => task.label !== duplicateLabel) }), 'utf8');
    await waitFor(() => globals().find(task => task.id === id && task.orphaned && task.isRunning), 'orphaned running task after definition removal');
    await board.stop(restarted.executionId);
    await waitFor(() => !globals().some(task => task.id === id), 'removed task to stop and disappear');

    await fs.unlink(globalPath);
    await waitFor(() => globals().length === 0 && view.pendingWarning?.includes(uri), 'missing file after removal');
    assert.equal(await fs.stat(globalPath).then(() => true, () => false), false, 'Discovery never recreates a missing file.');
    await createGlobalTask('Created global task');
    await waitFor(() => globals().some(task => task.name === 'Created global task'), 'task created after external file deletion');
    await fs.unlink(globalPath);
    // Creation and deletion can both occur between file watcher samples.
    await board.refresh();
    assert.equal(globals().length, 0);
    await board.openGlobalTasks();
    assert.deepEqual(JSON.parse(await fs.readFile(globalPath, 'utf8')).tasks, []);
  } finally {
    subscriptions.forEach(subscription => subscription.dispose());
    for (const execution of vscode.tasks.taskExecutions) {
      if (execution.task.source === source) execution.terminate();
    }
    board.dispose();
  }
}

async function run() {
  useTestHome();
  assert.equal(vscode.workspace.workspaceFolders, undefined);
  await testGlobalTasks({ execute: true });
}

module.exports = { run, testGlobalTasks, useTestHome };
