const assert = require('node:assert/strict');
const vscode = require('vscode');
const extensionModule = require('../../out/extension.js');

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
    const duplicates = snapshots.filter(task => task.name === 'Repo integration duplicate');
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
    }

    const workspaceScoped = snapshots.find(task => task.name === 'Workspace file integration task');
    assert.ok(workspaceScoped, 'Tasks stored in .code-workspace must be included by default.');
    assert.equal(workspaceScoped.workspaceScoped, true);
    await board.openTasksJson(workspaceScoped.id);
    assert.equal(vscode.window.activeTextEditor.document.uri.toString(),
      vscode.workspace.workspaceFile.toString());
  } finally {
    board.dispose();
  }
}

module.exports = { run };

if (require.main === module) {
  run().catch(error => { console.error(error); process.exitCode = 1; });
}
