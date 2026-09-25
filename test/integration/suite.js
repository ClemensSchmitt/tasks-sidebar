const assert = require('node:assert/strict');
const path = require('node:path');
const vscode = require('vscode');
const extensionModule = require('../../out/extension.js');

const extensionId = 'local.tasks-sidebar';
const taskLabel = 'Tasks Sidebar integration task';

function withTimeout(promise, description) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Timed out waiting for ${description}.`)), 20000); })
  ]).finally(() => clearTimeout(timer));
}

async function waitForTask(label) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const task = (await vscode.tasks.fetchTasks()).find(item => item.name === label && item.definition.type === 'process');
    if (task) return task;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for task discovery for ${label}.`);
}

function createWebviewHarness(board) {
  let receiveMessage;
  const postedMessages = [];
  const webview = {
    options: undefined,
    html: '',
    onDidReceiveMessage(listener) {
      receiveMessage = listener;
      return { dispose() {} };
    },
    postMessage(message) {
      postedMessages.push(message);
      return Promise.resolve(true);
    }
  };
  const provider = new extensionModule.TaskBoardView(
    vscode.workspace.workspaceFolders[0].uri,
    '0.0.5',
    'Local extension host',
    board
  );
  provider.resolveWebviewView({ webview });
  return {
    html: webview.html,
    provider,
    postedMessages,
    send(message) {
      assert.ok(receiveMessage, 'The webview must register its message handler.');
      return receiveMessage(message);
    }
  };
}

async function run() {
  const extension = vscode.extensions.getExtension(extensionId);
  assert.ok(extension, `Extension ${extensionId} must be present in the test host.`);
  await extension.activate();

  const commands = await vscode.commands.getCommands(true);
  for (const command of [
    'tasksSidebar.refresh',
    'tasksSidebar.openTasksJson',
    'tasksSidebar.createTask',
    'tasksSidebar.toggleExternalTasks'
  ]) assert.ok(commands.includes(command), `Missing command ${command}.`);
  await vscode.commands.executeCommand('tasksSidebar.refresh');

  await vscode.commands.executeCommand('tasksSidebar.openTasksJson');
  const editor = vscode.window.activeTextEditor;
  assert.ok(editor, 'Opening tasks.json should show a text editor.');
  assert.equal(editor.document.uri.fsPath, path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, '.vscode', 'tasks.json'));

  const task = await waitForTask(taskLabel);
  let startSubscription;
  let endSubscription;
  const started = new Promise(resolve => {
    startSubscription = vscode.tasks.onDidStartTask(event => {
      if (event.execution.task.name === taskLabel) resolve();
    });
  });
  const ended = new Promise(resolve => {
    endSubscription = vscode.tasks.onDidEndTaskProcess(event => {
      if (event.execution.task.name === taskLabel) resolve(event);
    });
  });
  try {
    const execution = await vscode.tasks.executeTask(task);
    await withTimeout(started, 'task start');
    execution.terminate();
    const result = await withTimeout(ended, 'task process end');
    assert.equal(result.execution.task.name, taskLabel);
  } finally {
    startSubscription?.dispose();
    endSubscription?.dispose();
  }

  const html = extensionModule.createTaskBoardHtml('0.0.5', 'Remote · test');
  assert.match(html, /--vscode-sideBar-background/);
  assert.match(html, /--vscode-foreground/);
  assert.match(html, /:focus-visible/);
  assert.match(html, /prefers-reduced-motion: reduce/);
  assert.match(html, /forced-colors: active/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /aria-live="off"/);
  assert.match(html, /aria-label="Search tasks, sources, groups/);
  assert.match(html, /aria-valuetext/);
  assert.match(html, /v0\.0\.5/);
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<main id="list" tabindex="-1"/);
  assert.match(html, /<h2 class="empty-title">/);
  assert.match(html, /<h2 class="name"/);
  assert.match(html, /data-task-id=/);
  assert.match(html, /function captureListFocus\(\)/);
  assert.match(html, /function restoreListFocus\(bookmark\)/);
  assert.match(html, /const focusBookmark = captureListFocus\(\);/);
  assert.match(html, /candidate\.getAttribute\('data-action'\) === bookmark\.action/);
  assert.match(html, /candidate\.getAttribute\('data-id'\) === bookmark\.actionId/);
  assert.match(html, /target\.focus\(\{ preventScroll: true \}\)/);
  assert.match(html, /stopAvailable \? 'Stop, restart, and edit task definition\.' : task\.isRunning \? 'Restart and edit task definition\.'/);
  assert.match(html, /if \(event\.matches && progressFrame\) \{\s*cancelAnimationFrame\(progressFrame\);/);

  const escaped = extensionModule.createTaskBoardHtml('<script>', 'Host <script>');
  assert.doesNotMatch(escaped, /<span class="version"><script>/);
  assert.doesNotMatch(escaped, /<span class="host">Host <script>/);
  assert.match(escaped, /&lt;script&gt;/);

  const routeCases = [
    { command: 'run', id: 'workspace-task', method: 'run', args: ['workspace-task'] },
    { command: 'stop', id: 'execution-1', method: 'stop', args: ['execution-1'] },
    { command: 'restart', id: 'execution-1', method: 'restart', args: ['execution-1'] },
    { command: 'output', method: 'openTaskOutput', args: [undefined] },
    { command: 'terminal', method: 'openTaskTerminal', args: [undefined] },
    { command: 'refresh', method: 'refresh', args: [] },
    { command: 'edit', id: 'workspace-task', method: 'openTasksJson', args: ['workspace-task'] },
    { command: 'create', method: 'createTask', args: [] }
  ];
  const boardCalls = [];
  const recordingBoard = Object.fromEntries(
    [...new Set(routeCases.map(item => item.method))].map(method => [
      method,
      async (...args) => boardCalls.push({ method, args })
    ])
  );
  recordingBoard.reportError = () => assert.fail('Successful sidebar actions must not report an error.');
  const webviewHarness = createWebviewHarness(recordingBoard);

  for (const control of [
    'id="refresh"', 'id="output"', 'id="terminal"', 'id="create"', 'id="edit"',
    'id="search"', 'id="filter"', 'id="sort"', 'id="resetView"'
  ]) assert.ok(webviewHarness.html.includes(control), 'Missing sidebar UI control ' + control + '.');
  for (const action of ['run', 'stop', 'restart', 'edit']) {
    assert.ok(webviewHarness.html.includes('data-action="' + action + '"'), 'Missing task-card action ' + action + '.');
  }
  assert.match(webviewHarness.html, /search\?\.addEventListener\('input'/);
  assert.match(webviewHarness.html, /filter\?\.addEventListener\('change'/);
  assert.match(webviewHarness.html, /sort\?\.addEventListener\('change'/);

  for (const route of routeCases) {
    await webviewHarness.send({ command: route.command, ...(route.id ? { id: route.id } : {}) });
  }
  assert.deepEqual(boardCalls, routeCases.map(({ method, args }) => ({ method, args })));

  const uiSnapshots = [{ id: 'task-1', name: 'Task', source: 'Workspace' }];
  webviewHarness.provider.render(uiSnapshots, 'Provider warning');
  assert.deepEqual(webviewHarness.postedMessages, [{
    command: 'render',
    snapshots: uiSnapshots,
    warning: 'Provider warning'
  }]);

  const failureReports = [];
  const failingBoard = Object.fromEntries(
    [...new Set(routeCases.map(item => item.method))].map(method => [
      method,
      async () => { throw new Error(method + ' failed'); }
    ])
  );
  failingBoard.reportError = (message, error) => failureReports.push({ message, error: error.message });
  const failingWebviewHarness = createWebviewHarness(failingBoard);
  for (const route of routeCases) {
    await failingWebviewHarness.send({ command: route.command, ...(route.id ? { id: route.id } : {}) });
  }
  assert.deepEqual(failureReports, routeCases.map(({ method }) => ({
    message: 'The sidebar action could not be completed.',
    error: method + ' failed'
  })));
}

module.exports = { run };
