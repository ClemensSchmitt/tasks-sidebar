const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs/promises');
const vscode = require('vscode');
const { TaskBoard, TaskBoardView } = require('../../out/extension.js');
const { duplicateLabel, fixture } = require('./global-fixture.js');
const source = 'Global · Tasks Sidebar';

async function waitFor(read, description) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const result = read();
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
    vscode.tasks.onDidEndTaskProcess(event => board.processEnded(event.execution, event.exitCode)),
    vscode.tasks.onDidEndTask(event => board.ended(event.execution))
  ];
  const globals = () => view.pending.filter(task => task.source === source);
  try {
    await board.refresh();
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
    await board.openTasksJson(globals().find(task => task.name === 'Global shell integration task').id);
    const editor = vscode.window.activeTextEditor;
    assert.equal(editor.document.uri.toString(), uri);
    assert.equal(JSON.parse(editor.document.getText(editor.selection)).label, 'Global shell integration task');

    // The same discovery/edit checks run in three independently launched windows.
    if (!execute) return;
    for (const name of ['Global shell integration task', 'Global cwd integration task']) {
      const { id } = globals().find(task => task.name === name);
      await board.run(id);
      await waitFor(() => globals().find(task => task.id === id && task.runCount === 1 && task.lastOutcome === 'success'), name + ' successful history');
    }

    const { id } = duplicate[0];
    await board.run(id);
    const running = await waitFor(() => globals().find(task => task.id === id && task.isRunning), 'first global run');
    await board.restart(running.executionId);
    const restarted = await waitFor(() => globals().find(task => task.id === id && task.isRunning &&
      task.executionId !== running.executionId), 'restarted global run');

    await fs.writeFile(globalPath, '{"version":', 'utf8');
    await waitFor(() => view.pendingWarning?.includes(uri) && view.pendingWarning.includes('Invalid JSONC'), 'malformed file warning');
    assert.equal(globals().length, 3, 'A malformed save preserves the last good discovery.');

    await fs.writeFile(globalPath, JSON.stringify({ ...fixture, tasks: fixture.tasks.filter(task => task.label !== duplicateLabel) }), 'utf8');
    await waitFor(() => globals().find(task => task.id === id && task.orphaned && task.isRunning), 'orphaned running task after definition removal');
    await board.stop(restarted.executionId);
    await waitFor(() => !globals().some(task => task.id === id), 'removed task to stop and disappear');

    await fs.unlink(globalPath);
    await waitFor(() => globals().length === 0 && view.pendingWarning?.includes(uri), 'missing file after removal');
    assert.equal(await fs.stat(globalPath).then(() => true, () => false), false, 'Discovery never recreates a missing file.');
    await vscode.commands.executeCommand('tasksSidebar.openGlobalTasks');
    assert.deepEqual(JSON.parse(await fs.readFile(globalPath, 'utf8')).tasks, []);
    const choices = ['Created global task', 'echo created'];
    await board.createTask({
      showQuickPick() { assert.fail('An empty window has only the global destination.'); },
      showInputBox: async () => choices.shift()
    });
    assert.equal(JSON.parse(await fs.readFile(globalPath, 'utf8')).tasks[0].label, 'Created global task');
  } finally {
    subscriptions.forEach(subscription => subscription.dispose());
    for (const execution of vscode.tasks.taskExecutions) {
      if (execution.task.source === source) execution.terminate();
    }
    board.dispose();
  }
}

async function run() {
  assert.equal(vscode.workspace.workspaceFolders, undefined);
  await testGlobalTasks({ execute: true });
}

module.exports = { run, testGlobalTasks };
