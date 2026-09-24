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

  const escaped = extensionModule.createTaskBoardHtml('<script>', 'Host <script>');
  assert.doesNotMatch(escaped, /<span class="version"><script>/);
  assert.doesNotMatch(escaped, /<span class="host">Host <script>/);
  assert.match(escaped, /&lt;script&gt;/);
}

module.exports = { run };
