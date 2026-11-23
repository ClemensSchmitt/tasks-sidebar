const assert = require('node:assert/strict');
const vscode = require('vscode');
const extensionModule = require('../../out/extension.js');
const { parseJsonc, appendShellTask, findTaskDefinitionRange } = require('../../out/runtime.js');

async function replaceDocument(document, text) {
  const editor = await vscode.window.showTextDocument(document);
  assert.equal(await editor.edit(builder => builder.replace(
    new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), text
  )), true);
  assert.equal(await document.save(), true);
}

function creationUI(workspaceScoped, label) {
  const inputs = [label, 'echo tasks-sidebar-created'];
  return {
    async showQuickPick(items) {
      assert.equal(items[0].label, 'Entire Workspace');
      assert.ok(items[0].description.includes('.code-workspace'));
      assert.equal(items.length, 7);
      return workspaceScoped ? items[0] : items.find(item => item.label === 'repo-a');
    },
    async showInputBox() { return inputs.shift(); }
  };
}

async function waitForSnapshot(board, provider, label, workspaceScoped) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    await board.refresh();
    const task = provider.pending.find(item => item.name === label && item.workspaceScoped === workspaceScoped);
    if (task) return task;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('Created task was not discovered: ' + label);
}


async function run() {
  const roots = vscode.workspace.workspaceFolders || [];
  assert.equal(roots.length, 5, 'The test host must open the five-root .code-workspace fixture.');
  const requiredNames = ['integration-root', 'repo-a', 'repo-b', 'repo-c', 'repo-empty'];
  assert.deepEqual(roots.map(folder => folder.name), requiredNames);

  const extensionId = 'ClemboMembo.tasks-sidebar';
  const extension = vscode.extensions.getExtension(extensionId);
  assert.ok(extension, 'The Tasks Sidebar extension must be available in the test host.');
  await extension.activate();

  const expected = [
    ['integration-root', 'Tasks Sidebar integration task'],
    ['repo-a', 'Repo integration duplicate'],
    ['repo-b', 'Repo integration duplicate'],
    ['repo-c', 'Repo C integration task']
  ];
  let actualTasks = [];
  let discoveredAllRoots = false;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    actualTasks = await vscode.tasks.fetchTasks();
    const seen = new Set(actualTasks
      .filter(task => task.source === 'Workspace' && task.scope && typeof task.scope === 'object')
      .map(task => task.scope.uri.toString() + '|' + task.name));
    if (expected.every(([folderName, label]) =>
      seen.has(roots.find(folder => folder.name === folderName).uri.toString() + '|' + label))) {
      discoveredAllRoots = true;
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  assert.equal(discoveredAllRoots, true, 'VS Code must expose tasks from every populated root.');

  const board = new extensionModule.TaskBoard({
    workspaceState: { get: (_key, fallback) => fallback, update: async () => {} }
  });
  const provider = new extensionModule.TaskBoardView(
    roots[0].uri, '0.0.9-test', 'integration host', board
  );
  board.attachView(provider);
  try {
    await board.refresh();
    const snapshots = provider.pending;
    assert.ok(Array.isArray(snapshots), 'Refresh must populate cached snapshots before opening a sidebar.');
    assert.equal(board.incompleteDiscoveryAttempts, 0,
      'All configured task roots are complete; an empty tasks.json must not cause retries.');
    const duplicates = snapshots.filter(task => task.name === 'Repo integration duplicate' && !task.workspaceScoped);
    assert.equal(duplicates.length, 2);
    assert.notEqual(duplicates[0].id, duplicates[1].id,
      'Duplicate task labels in distinct roots must not share logical identity.');
    assert.notEqual(duplicates[0].workspaceFolderUri, duplicates[1].workspaceFolderUri);
    assert.ok(snapshots.some(task => task.name === 'Repo C integration task'));
    assert.ok(snapshots.some(task => task.name === 'Tasks Sidebar integration task'));

    // Edit actions must route same-named tasks to their individual task files.
    for (const task of duplicates) {
      await board.openTasksJson(task.id);
      assert.equal(vscode.window.activeTextEditor.document.uri.toString(),
        vscode.Uri.joinPath(vscode.Uri.parse(task.workspaceFolderUri), '.vscode', 'tasks.json').toString());
      assert.equal(parseJsonc(vscode.window.activeTextEditor.document.getText(vscode.window.activeTextEditor.selection)).label, task.name);
    }

    const workspaceScoped = snapshots.find(task => task.name === 'Workspace file integration task');
    assert.ok(workspaceScoped, 'Tasks stored in .code-workspace must be included by default.');
    assert.equal(workspaceScoped.workspaceScoped, true);
    await board.openTasksJson(workspaceScoped.id);
    assert.equal(vscode.window.activeTextEditor.document.uri.toString(),
      vscode.workspace.workspaceFile.toString());
    const workspaceDocument = vscode.window.activeTextEditor.document;
    const originalWorkspace = workspaceDocument.getText();
    const selected = vscode.window.activeTextEditor;
    assert.equal(parseJsonc(workspaceDocument.getText(selected.selection)).command, 'echo workspace');
    assert.equal(workspaceDocument.isDirty, false);

    const workspaceDuplicate = snapshots.find(task => task.workspaceScoped && task.name === 'Repo integration duplicate');
    assert.ok(workspaceDuplicate);
    await board.openTasksJson(workspaceDuplicate.id);
    assert.equal(parseJsonc(workspaceDocument.getText(vscode.window.activeTextEditor.selection)).command, 'echo workspace-duplicate');
    assert.equal(workspaceDocument.getText(), originalWorkspace, 'Navigation must preserve all JSONC source.');

    const folderUri = vscode.Uri.joinPath(roots.find(folder => folder.name === 'repo-a').uri, '.vscode', 'tasks.json');
    const folderDocument = await vscode.workspace.openTextDocument(folderUri);
    const originalFolder = folderDocument.getText();
    const originalFindTask = board.findTask;
    const actualWorkspaceTask = (await vscode.tasks.fetchTasks()).find(task => task.scope === vscode.TaskScope.Workspace && task.name === workspaceScoped.name);
    assert.ok(actualWorkspaceTask);
    const errors = [];
    board.reportError = (message, error) => errors.push(message + ' ' + error.message);
    try {
      // Cancellation must leave both files untouched, including comments.
      await board.createTask({ showQuickPick: async () => undefined, showInputBox: async () => assert.fail('Canceled picker must not prompt') });
      assert.equal(workspaceDocument.getText(), originalWorkspace);
      assert.equal(folderDocument.getText(), originalFolder);

      await board.createTask(creationUI(true, 'Created workspace integration task'));
      assert.deepEqual(errors, []);
      const updated = parseJsonc(workspaceDocument.getText());
      assert.deepEqual(updated.folders, parseJsonc(originalWorkspace).folders);
      assert.deepEqual(updated.settings, parseJsonc(originalWorkspace).settings);
      assert.equal(updated.tasks.tasks.length, 3);
      assert.ok(workspaceDocument.getText().includes('// Same label as tasks in repo-a and repo-b'));
      assert.equal(folderDocument.getText(), originalFolder);
      const created = await waitForSnapshot(board, provider, 'Created workspace integration task', true);
      assert.equal(created.workspaceScoped, true);

      // Launch the harmless echo task through the same board API as the sidebar.
      let ended;
      const completion = new Promise(resolve => { ended = resolve; });
      const listener = vscode.tasks.onDidEndTaskProcess(event => {
        if (event.execution.task.name === created.name) ended(event.exitCode);
      });
      let timer;
      try {
        await board.run(created.id);
        assert.equal(await Promise.race([completion, new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('Created workspace task did not finish.')), 20000);
        })]), 0);
      } finally {
        clearTimeout(timer);
        listener.dispose();
      }

      await board.createTask(creationUI(false, 'Created folder integration task'));
      assert.deepEqual(errors, []);
      assert.equal(parseJsonc(folderDocument.getText()).tasks.at(-1).label, 'Created folder integration task');
      const folderCreated = await waitForSnapshot(board, provider, 'Created folder integration task', false);
      assert.equal(folderCreated.workspaceFolderUri, roots.find(folder => folder.name === 'repo-a').uri.toString());

      // Missing workspace tasks section is initialized, other sections survive.
      const noTasks = '{\n // keep folders\n "folders": ' + JSON.stringify(updated.folders) + ',\n "settings": {"editor.tabSize":3},\n}\n';
      await replaceDocument(workspaceDocument, noTasks);
      await board.createTask(creationUI(true, 'Initialized workspace task'));
      assert.deepEqual(errors, []);
      assert.equal(parseJsonc(workspaceDocument.getText()).tasks.version, '2.0.0');
      assert.equal(parseJsonc(workspaceDocument.getText()).tasks.tasks[0].label, 'Initialized workspace task');
      assert.ok(workspaceDocument.getText().includes('// keep folders'));
      assert.deepEqual(parseJsonc(workspaceDocument.getText()).settings, { 'editor.tabSize': 3 });

      // The current editor buffer must be used; invalid data is never rewritten.
      const invalid = '{"folders":' + JSON.stringify(updated.folders) + ',"tasks":[]}';
      await replaceDocument(workspaceDocument, invalid);
      await board.createTask(creationUI(true, 'Must not be written'));
      assert.equal(workspaceDocument.getText(), invalid);
      assert.equal(workspaceDocument.isDirty, false);
      assert.equal(errors.length, 1);
      assert.ok(errors[0].includes(vscode.workspace.workspaceFile.toString()));

      // A stale card must not select a renamed or ambiguous definition in the real editor.
      board.findTask = async () => actualWorkspaceTask;
      const sourceRange = findTaskDefinitionRange(originalWorkspace, workspaceScoped.name, 'workspace');
      const renamed = originalWorkspace.slice(0, sourceRange.start) +
        originalWorkspace.slice(sourceRange.start, sourceRange.end).replace(workspaceScoped.name, 'Renamed workspace task') +
        originalWorkspace.slice(sourceRange.end);
      for (const source of [renamed, appendShellTask(originalWorkspace, workspaceScoped.name, 'echo duplicate', 'workspace')]) {
        await replaceDocument(workspaceDocument, source);
        const zero = new vscode.Position(0, 0);
        await vscode.window.showTextDocument(workspaceDocument, { selection: new vscode.Range(zero, zero) });
        await board.openTasksJson(workspaceScoped.id);
        assert.equal(vscode.window.activeTextEditor.selection.isEmpty, true);
        assert.equal(workspaceDocument.getText(), source);
        assert.equal(workspaceDocument.isDirty, false);
      }

    } finally {
      board.findTask = originalFindTask;
      await replaceDocument(workspaceDocument, originalWorkspace);
      await replaceDocument(folderDocument, originalFolder);
    }

  } finally {
    board.dispose();
  }
}

module.exports = {
  async run() {
    await run();
    await require('./suite-global.js').testGlobalTasks();
  }
};

if (require.main === module) {
  run().catch(error => { console.error(error); process.exitCode = 1; });
}
