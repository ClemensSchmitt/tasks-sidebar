const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const vscode = require('vscode');
const extensionModule = require('../../out/extension.js');

const manifest = require('../../package.json');
const extensionId = `${manifest.publisher}.${manifest.name}`;
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

function createEmbeddedWebviewHarness(html, initialState) {
  const listeners = new Map();
  const documentListeners = new Map();
  const elements = new Map();
  const postedMessages = [];
  let webviewState = initialState;

  class FakeElement {
    constructor(id) {
      this.id = id;
      this.hidden = id.endsWith('Popover');
      this.value = '';
      this.dataset = {};
      this.style = { setProperty() {} };
      this.attributes = new Map();
      this.children = [];
      this.listeners = new Map();
      this.classList = { toggle() {} };
      this.innerHTML = '';
    }
    addEventListener(type, listener) { this.listeners.set(type, listener); }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    removeAttribute(name) { this.attributes.delete(name); }
    replaceChildren(...children) { this.children = children; }
    querySelector(selector) {
      const choice = /^input\[value="([^"]+)"\]$/.exec(selector);
      if (choice) return this.choices?.get(choice[1]) ?? null;
      const panelGroup = { filterPopover: 'filter', sortPopover: 'sort', tagPopover: 'tagFilter' }[this.id];
      if (panelGroup) {
        const group = element(panelGroup);
        const inputs = group.choices ? [...group.choices.values()] : group.querySelectorAll('input');
        if (selector.startsWith('input:checked')) return inputs.find(input => input.checked) ?? null;
        return inputs[0] ?? element('clearTags');
      }
      if (selector === '.inline-alert') return this.children.find(child => child.className === 'inline-alert');
      if (selector === 'button') return new FakeElement('discoveryRetry');
      return null;
    }
    querySelectorAll(selector) {
      if (this.id !== 'tagFilter') return [];
      if (this.tagMarkup !== this.innerHTML) {
        this.tagMarkup = this.innerHTML;
        this.tagInputs = Array.from(this.innerHTML.matchAll(/<input type="checkbox" value="([^"]*)">/g), match => ({
          id: 'tagOption',
          value: match[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"'), checked: false, focus() { this.focused = true; }
        }));
      }
      return selector === 'input:checked' ? this.tagInputs.filter(input => input.checked) : this.tagInputs;
    }
    contains(target) {
      if (this === target) return true;
      const suffix = this.id.endsWith('Picker') ? this.id.slice(0, -'Picker'.length) : '';
      return Boolean(suffix && target?.id.startsWith(suffix)) ||
        (this.id === 'tagPicker' && target?.id === 'clearTags');
    }
    focus() { this.focused = true; }
  }

  const element = id => {
    if (!elements.has(id)) elements.set(id, new FakeElement(id));
    return elements.get(id);
  };
  for (const group of ['filter', 'sort']) {
    element(group).choices = new Map(Array.from(html.matchAll(
      new RegExp('<input type="radio" name="' + group + '" value="([^"]+)"( checked)?><span>([^<]+)</span>', 'g')
    ), ([, value, checked, label]) => [value, {
      id: group + 'Option', value, checked: Boolean(checked),
      nextElementSibling: { textContent: label },
      matches: selector => selector === 'input[type="radio"]',
      focus() { this.focused = true; }
    }]));
  }
  function setChoice(group, value) {
    const control = element(group);
    control.choices.forEach(choice => { choice.checked = choice.value === value; });
    control.listeners.get('change')?.({ target: control.choices.get(value) });
  }
  const scriptMatch = html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/);
  assert.ok(scriptMatch, 'The webview must contain its executable script.');
  const context = {
    acquireVsCodeApi: () => ({
      postMessage: message => postedMessages.push(message),
      getState: () => webviewState,
      setState: state => { webviewState = state; }
    }),
    document: {
      activeElement: null,
      getElementById: element,
      createElement: tag => new FakeElement(tag),
      querySelectorAll: () => [],
      addEventListener: (type, listener) => documentListeners.set(type, listener)
    },
    window: {
      matchMedia: () => ({ matches: true, addEventListener() {} }),
      addEventListener: (type, listener) => listeners.set(type, listener)
    },
    performance: { now: () => 1000 },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
    Map, Set, Array, Math, String, Number, JSON, Promise, encodeURIComponent, decodeURIComponent
  };
  new vm.Script(scriptMatch[1], { filename: 'tasks-sidebar-webview.js' }).runInNewContext(context);

  return {
    list: element('list'),
    taskCount: element('taskCount'),
    tagFilter: element('tagFilter'),
    tagSummary: element('tagSummary'),
    tagPopover: element('tagPopover'),
    toggleTagDropdown() { element('tagSummary').listeners.get('click')?.(); },
    pointerDown(target) { documentListeners.get('pointerdown')?.({ target: element(target) }); },
    pressEscape() { documentListeners.get('keydown')?.({ key: 'Escape', preventDefault() {} }); },
    search: element('search'),
    regexToggle: element('regexToggle'),
    searchError: element('searchError'),
    sort: element('sort'),
    setSort(value) { setChoice('sort', value); },
    setFilter(value) { setChoice('filter', value); },
    dropdown: element,
    getState: () => webviewState,
    warningRegion: element('warning'),
    setSearch(value) { const search = element('search'); search.value = value; search.listeners.get('input')?.(); },
    toggleRegex() { element('regexToggle').listeners.get('click')?.(); },
    postedMessages,
    selectTag(value) {
      const select = element('tagFilter');
      const values = Array.isArray(value) ? value : [value];
      select.querySelectorAll('input').forEach(input => { input.checked = values.includes(input.value); });
      select.listeners.get('change')?.();
    },
    clearTags() { element('clearTags').listeners.get('click')?.(); },
    send(data) {
      const listener = listeners.get('message');
      assert.ok(listener, 'The webview must register a window message listener.');
      listener({ data });
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

  // Discovery must populate a provider snapshot even if no WebviewView
  // has been resolved. Opening it later must replay that cached result.
  const preloadBoard = new extensionModule.TaskBoard({
    workspaceState: { get: (_key, fallback) => fallback, update: async () => {} }
  });
  const preloadView = new extensionModule.TaskBoardView(
    vscode.workspace.workspaceFolders[0].uri, 'test', 'host', preloadBoard
  );
  preloadBoard.attachView(preloadView);
  let preloadFetches = 0;
  preloadBoard.fetchTasksWithProviderFallback = async () => {
    preloadFetches += 1;
    return { tasks: [task], providerFailed: false };
  };
  preloadBoard.loadWorkspaceTaskSpecs = async () => new Map();
  preloadBoard.getTasksJsonWarning = async () => undefined;
  try {
    await preloadBoard.refresh();
    assert.equal(preloadFetches, 1, 'Preloading should perform discovery before the view opens.');
    assert.ok(preloadView.pending?.some(snapshot => snapshot.name === taskLabel));
    const replayedMessages = [];
    preloadView.resolveWebviewView({ webview: {
      options: {}, html: '',
      onDidReceiveMessage: () => ({ dispose() {} }),
      postMessage: message => { replayedMessages.push(message); return Promise.resolve(true); }
    } });
    assert.ok(replayedMessages.some(message =>
      message.command === 'render' && message.snapshots.some(snapshot => snapshot.name === taskLabel)
    ), 'Opening the view must display the already discovered task.');
    assert.equal(preloadFetches, 1, 'Opening the view must not repeat provider discovery.');
  } finally {
    preloadBoard.dispose();
  }

  // Regression: initial task-provider scan can expose only one of several
  // configured tasks. The board must retry and must not lose last-known tasks
  // when a later provider scan is temporarily partial.
  const recoveryBoard = new extensionModule.TaskBoard({
    workspaceState: { get: (_key, fallback) => fallback, update: async () => {} }
  });
  const recoveryView = new extensionModule.TaskBoardView(
    vscode.workspace.workspaceFolders[0].uri, 'test', 'host', recoveryBoard
  );
  recoveryBoard.attachView(recoveryView);
  const folder = vscode.workspace.workspaceFolders[0];
  const laterTask = new vscode.Task(
    { type: 'shell', task: 'recovery' }, folder, 'Later workspace task', 'Workspace',
    new vscode.ShellExecution('echo ready')
  );
  const workspaceLevelTask = new vscode.Task(
    { type: 'shell', task: 'workspace-scope' }, vscode.TaskScope.Workspace,
    'Workspace-level task', 'Workspace', new vscode.ShellExecution('echo workspace')
  );
  let recoveryScans = 0;
  recoveryBoard.fetchTasksWithProviderFallback = async () => ({
    tasks: ++recoveryScans === 1 || recoveryScans === 3
      ? [task] : [task, laterTask, workspaceLevelTask],
    providerFailed: false
  });
  recoveryBoard.loadWorkspaceTaskSpecs = async () => new Map([
    [folder.uri.toString(), {
      dependencies: {}, tags: {}, configuredBuiltInLabels: [taskLabel, 'Later workspace task']
    }]
  ]);
  recoveryBoard.getTasksJsonWarning = async () => undefined;
  try {
    await recoveryBoard.refresh();
    assert.equal(recoveryBoard.incompleteDiscoveryAttempts, 1, 'Incomplete first scan must trigger a retry.');
    assert.ok(recoveryBoard.discoveryTimer, 'Retry must be scheduled without the webview being opened.');
    assert.match(recoveryView.pendingWarning, /Waiting for tasks from/);
    await recoveryBoard.refresh();
    assert.equal(recoveryBoard.incompleteDiscoveryAttempts, 0, 'Complete recovery resets backoff.');
    assert.equal(recoveryView.pending.filter(snapshot => snapshot.name === 'Later workspace task').length, 1);
    assert.equal(recoveryView.pending.filter(snapshot => snapshot.name === 'Workspace-level task').length, 1,
      'Workspace-scoped tasks from .code-workspace must be accepted without the external-provider toggle.');
    const ids = new Set(recoveryView.pending.map(snapshot => snapshot.id));
    assert.equal(ids.size, recoveryView.pending.length, 'Distinct task identities must be preserved.');
    await recoveryBoard.refresh();
    assert.match(recoveryView.pendingWarning, /Waiting for tasks from/);
    assert.ok(recoveryView.pending.some(snapshot => snapshot.name === 'Later workspace task'),
      'Temporarily missing task must be kept from the previous complete snapshot.');
    await recoveryBoard.refresh();
    assert.equal(recoveryView.pendingWarning, undefined, 'Warning clears when all folders recover.');
    assert.equal(recoveryBoard.incompleteDiscoveryAttempts, 0);
    recoveryBoard.fetchTasksWithProviderFallback = async () => { throw new Error('provider temporarily unavailable'); };
    recoveryBoard.getDiscoveryWarning = async () => 'Temporary provider outage';
    await recoveryBoard.refresh();
    assert.match(recoveryView.pendingWarning, /Temporary provider outage/);
    assert.ok(recoveryView.pending.some(snapshot => snapshot.name === 'Workspace-level task'),
      'A transient provider failure must preserve cached workspace-scoped tasks.');
    assert.ok(recoveryView.pending.some(snapshot => snapshot.name === 'Later workspace task'),
      'A transient provider failure must preserve cached folder-scoped tasks.');
  } finally {
    recoveryBoard.dispose();
    assert.equal(recoveryBoard.disposed, true, 'Dispose must stop future discovery.');
  }

  // Use the real workspace, document and editor APIs to check card navigation.
  const navigationBoard = new extensionModule.TaskBoard({
    workspaceState: { get: (_key, fallback) => fallback, update: async () => {} }
  });
  navigationBoard.findTask = async () => task;
  const originalText = editor.document.getText();
  await navigationBoard.openTasksJson('selected-task');
  const selectedEditor = vscode.window.activeTextEditor;
  assert.equal(selectedEditor.document.uri.toString(), editor.document.uri.toString());
  assert.match(selectedEditor.document.getText(selectedEditor.selection), /Tasks Sidebar integration task/);
  assert.equal(selectedEditor.document.getText(), originalText, 'Navigation must not rewrite JSONC.');
  assert.equal(selectedEditor.document.isDirty, false);
  const toolbarHtml = extensionModule.createTaskBoardHtml('test', 'host');
  assert.doesNotMatch(toolbarHtml, /id="output"|id="terminal"/);
  assert.doesNotMatch(toolbarHtml, /Choose a terminal|Open VS Code task output|Focus the active task terminal/);
  const toolbarActions = toolbarHtml.match(/<div class="actions" role="group" aria-label="Task actions">([\s\S]*?)<\/div>/)?.[1] ?? '';
  assert.match(toolbarActions, /id="refresh"[\s\S]*id="create"[\s\S]*id="edit"/);

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
  assert.match(html, /aria-label="Search tasks, tags, sources, groups/);
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
  assert.match(html, /if \(!target && bookmark\.action && bookmark\.taskId\) \{/);
  assert.match(html, /card\?\.getAttribute\('data-task-id'\) === bookmark\.taskId/);
  assert.match(html, /card\.getAttribute\('data-execution-id'\) === bookmark\.executionId/);
  assert.match(html, /\(target \|\| list\)\.focus\(\{ preventScroll: true \}\)/);
  assert.match(html, /#list:focus-visible, \.task:focus-visible/);
  assert.match(html, /#list:focus-visible, \.task:focus-visible \{ outline: 2px solid Highlight;/);
  assert.match(html, /if \(renderSignature === lastRenderSignature\) \{\s*updateTaskCards\(visibleTasks, renderTime\);\s*return;/);
  assert.match(html, /if \(lastRenderSignature === 'empty'\) return;/);
  assert.match(html, /id="discoveryRetry" type="button" aria-label="Retry task discovery"/);
  assert.match(html, /current && current\.dataset\.message === message/);
  assert.match(html, /if \(task\.isRunning\) \{\s*if \(!task\.isStopping && task\.lifecycle !== 'awaiting-task-end'\) actions\.push\('Stop'\);\s*\} else \{\s*actions\.push\('Run'\);\s*\}/);
  assert.match(html, /if \(task\.isRunning \|\| task\.lastOutcome\) actions\.push\('Restart'\);/);
  assert.match(html, /return actions\.length \? actions\.join\(', '\) : 'No actions available';/);
  assert.match(html, /if \(event\.matches && progressFrame\) \{\s*cancelAnimationFrame\(progressFrame\);/);

  const escaped = extensionModule.createTaskBoardHtml('<script>', 'Host <script>');
  assert.doesNotMatch(escaped, /<span class="version"><script>/);
  assert.doesNotMatch(escaped, /<span class="host">Host <script>/);
  assert.match(escaped, /&lt;script&gt;/);

  const routeCases = [
    { command: 'run', id: 'workspace-task', method: 'run', args: ['workspace-task'] },
    { command: 'stop', id: 'execution-1', method: 'stop', args: ['execution-1'] },
    { command: 'restart', id: 'execution-1', method: 'restart', args: ['execution-1'] },
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

  // Webview messages may be posted before its JavaScript has registered
  // listeners. A readiness handshake must replay the latest cached snapshot.
  const early = [{ id: 'preloaded-task', name: 'Preloaded task', source: 'Workspace' }];
  webviewHarness.provider.render(early);
  const beforeReady = webviewHarness.postedMessages.length;
  await webviewHarness.send({ command: 'ready' });
  assert.equal(webviewHarness.postedMessages.length, beforeReady + 1);
  assert.deepEqual(webviewHarness.postedMessages.at(-1).snapshots, early);
  assert.match(webviewHarness.html, /vscode\.postMessage\(\{ command: 'ready' \}\)/);
  assert.ok(manifest.activationEvents.includes('onStartupFinished'),
    'Task discovery must activate even if the sidebar stays closed.');

  for (const control of [
    'id="refresh"', 'id="create"', 'id="edit"',
    'id="search"', 'id="filter"', 'id="tagFilter"', 'id="sort"'
  ]) assert.ok(webviewHarness.html.includes(control), 'Missing sidebar UI control ' + control + '.');
  assert.match(webviewHarness.html, /<input id="search" class="search" type="text"/);
  assert.match(webviewHarness.html, /id="taskCount" class="host" role="status" aria-live="polite"/);
  assert.match(webviewHarness.html, /\.board-tools \{ display: grid; grid-template-columns: minmax\(0, 1fr\);/);
  const searchControls = webviewHarness.html.match(/<div class="search-wrap">([^]*?)<\/div>/)[1];
  assert.deepStrictEqual(searchControls.match(/<(?:input|button)\b[^>]*>/g).map(control => control.match(/\bid="([^"]+)"/)?.[1]), ['search', 'regexToggle']);
  assert.doesNotMatch(webviewHarness.html, /::-webkit-search-cancel-button/);
  assert.match(webviewHarness.html, /\.dropdown-panel \{ position: absolute; z-index: 40;/);
  assert.match(webviewHarness.html, /\.dropdown-panel\[hidden\] \{ display: none;/);
  assert.match(webviewHarness.html, /\.dropdown-options \{[^}]*overflow-y: auto;/);
  for (const id of ['filter', 'tag', 'sort']) {
    assert.match(webviewHarness.html, new RegExp('id="' + id + 'Summary" class="dropdown-trigger"[^>]+aria-controls="' + id + 'Popover"'));
    assert.match(webviewHarness.html, new RegExp('id="' + id + 'Popover" class="dropdown-panel" role="dialog"[^>]+hidden'));
  }
  assert.match(webviewHarness.html, /id="tagSummary"[^>]*><span class="dropdown-value">Tags<\/span>/);
  assert.doesNotMatch(webviewHarness.html, /Tags \(all required\)/);
  assert.doesNotMatch(webviewHarness.html, /resetView|Reset search and filters/);
  for (const action of ['run', 'stop', 'restart', 'edit']) {
    assert.ok(webviewHarness.html.includes('data-action="' + action + '"'), 'Missing task-card action ' + action + '.');
  }
  assert.match(webviewHarness.html, /search\?\.addEventListener\('input'/);
  assert.match(webviewHarness.html, /filter\?\.addEventListener\('change'/);
  assert.match(webviewHarness.html, /tagFilter\?\.addEventListener\('change'/);
  assert.match(webviewHarness.html, /sort\?\.addEventListener\('change'/);
  assert.ok(webviewHarness.html.includes('Sort: custom (drag)'));
  assert.ok(webviewHarness.html.includes('data-reorder="up"'));
  assert.ok(webviewHarness.html.includes('data-reorder="down"'));
  assert.ok(webviewHarness.html.includes("addEventListener('dragstart'"));
  assert.ok(webviewHarness.html.includes("addEventListener('drop'"));

  for (const route of routeCases) {
    await webviewHarness.send({ command: route.command, ...(route.id ? { id: route.id } : {}) });
  }
  assert.deepEqual(boardCalls, routeCases.map(({ method, args }) => ({ method, args })));

  webviewHarness.postedMessages.length = 0;
  const uiSnapshots = [{ id: 'task-1', name: 'Task', source: 'Workspace' }];
  webviewHarness.provider.render(uiSnapshots, 'Provider warning');
  assert.deepEqual(webviewHarness.postedMessages, [{
    command: 'render',
    snapshots: uiSnapshots,
    warning: 'Provider warning',
    customOrder: []
  }]);

  const embeddedWebview = createEmbeddedWebviewHarness(
    extensionModule.createTaskBoardHtml('0.0.5', 'Integration test')
  );
  const taskSnapshot = {
    id: 'validated-task',
    name: 'Validated task',
    source: 'Workspace',
    group: 'build',
    tags: ['test & smoke'],
    dependsOn: [],
    dependsOrder: 'all',
    dependencyIds: [],
    isDependency: false,
    isBackground: false,
    isRunning: false,
    elapsedMs: 0,
    progress: 0,
    progressState: 'idle',
    isStopping: false,
    lifecycle: 'idle',
    orphaned: false,
    elapsedBasis: 'measured',
    runCount: 0
  };
  const untaggedTaskSnapshot = { ...taskSnapshot, id: 'untagged-task', name: 'Untagged task', tags: [] };
  embeddedWebview.send({
    command: 'render',
    snapshots: [taskSnapshot, untaggedTaskSnapshot],
    warning: 'Some task providers could not be scanned.'
  });
  let renderedTaskHtml = embeddedWebview.list.innerHTML;
  assert.match(renderedTaskHtml, /Validated task/, 'A valid render message should display the task.');
  assert.equal(embeddedWebview.taskCount.textContent, '2 tasks', 'The header counts available task definitions.');
  assert.match(renderedTaskHtml, /test &amp; smoke/, 'Task tags should be rendered as escaped labels.');
  assert.match(renderedTaskHtml, /Untagged task/, 'Tasks without tags remain visible before filtering.');
  assert.match(embeddedWebview.regexToggle.id, /regexToggle/);
  assert.equal(embeddedWebview.regexToggle.getAttribute('aria-pressed'), 'false');
  const messageCountBeforeRegex = embeddedWebview.postedMessages.length;
  embeddedWebview.setSearch('^Valid');
  assert.equal(embeddedWebview.taskCount.textContent, '2 tasks', 'Search does not change the total task count.');
  assert.match(embeddedWebview.list.innerHTML, /No matching tasks/, 'Literal search does not interpret anchors.');
  embeddedWebview.toggleRegex();
  assert.equal(embeddedWebview.regexToggle.getAttribute('aria-pressed'), 'true');
  assert.match(embeddedWebview.list.innerHTML, /Validated task/);
  assert.doesNotMatch(embeddedWebview.list.innerHTML, /Untagged task/);
  embeddedWebview.setSearch('[');
  assert.match(embeddedWebview.searchError.textContent, /Invalid regular expression/);
  assert.equal(embeddedWebview.search.getAttribute('aria-invalid'), 'true');
  assert.match(embeddedWebview.list.innerHTML, /Validated task/, 'Invalid regex preserves the last valid cards.');
  embeddedWebview.toggleRegex();
  assert.equal(embeddedWebview.regexToggle.getAttribute('aria-pressed'), 'false');
  assert.equal(embeddedWebview.searchError.textContent, '');
  embeddedWebview.setSearch('');
  assert.equal(embeddedWebview.postedMessages.length, messageCountBeforeRegex,
    'Regex changes must not request new task discovery.');

  embeddedWebview.send({ command: 'render', snapshots: [taskSnapshot, untaggedTaskSnapshot], customOrder: ['untagged-task', 'validated-task'] });
  embeddedWebview.setSort('custom');
  assert.ok(embeddedWebview.list.innerHTML.indexOf('Untagged task') < embeddedWebview.list.innerHTML.indexOf('Validated task'),
    'Custom sort uses the saved logical task order.');
  assert.equal(embeddedWebview.dropdown('sortValue').textContent, 'Sort: custom (drag)');
  const restoredSort = createEmbeddedWebviewHarness(html, embeddedWebview.getState());
  assert.equal(restoredSort.dropdown('sortValue').textContent, 'Sort: custom (drag)', 'Restoring the webview also restores the dropdown value.');
  embeddedWebview.setSort('name');
  const filterTrigger = embeddedWebview.dropdown('filterSummary');
  const filterPanel = embeddedWebview.dropdown('filterPopover');
  filterTrigger.listeners.get('click')();
  assert.equal(filterPanel.hidden, false);
  assert.equal(embeddedWebview.dropdown('filter').choices.get('all').focused, true);
  embeddedWebview.setFilter('running');
  assert.equal(embeddedWebview.dropdown('filterValue').textContent, 'Running');
  filterPanel.listeners.get('keydown')({ key: 'Enter', target: embeddedWebview.dropdown('filter').choices.get('running'), preventDefault() {} });
  assert.equal(filterPanel.hidden, true);
  assert.equal(filterTrigger.focused, true);
  embeddedWebview.setFilter('all');
  assert.match(embeddedWebview.tagFilter.innerHTML, /value="test &amp; smoke"/, 'Tag choices should be populated from task snapshots.');
  assert.equal(embeddedWebview.tagPopover.hidden, true, 'Tag dropdown starts closed.');
  embeddedWebview.toggleTagDropdown();
  assert.equal(embeddedWebview.tagPopover.hidden, false, 'Clicking the trigger opens the overlay.');
  assert.equal(embeddedWebview.tagSummary.getAttribute('aria-expanded'), 'true');
  embeddedWebview.pointerDown('tagFilter');
  assert.equal(embeddedWebview.tagPopover.hidden, false, 'Interacting inside the overlay keeps it open.');
  embeddedWebview.selectTag('test & smoke');
  assert.match(embeddedWebview.list.innerHTML, /Validated task/, 'Selecting a tag keeps matching tasks visible.');
  assert.doesNotMatch(embeddedWebview.list.innerHTML, /Untagged task/, 'Selecting a tag hides tasks without that tag.');
  const both = { ...taskSnapshot, id: 'both', name: 'Both tags', tags: ['test & smoke', 'second'] };
  const extra = { ...both, id: 'extra', name: 'Extra tags', tags: [...both.tags, 'third'] };
  const second = { ...taskSnapshot, id: 'second', name: 'Second only', tags: ['second'] };
  const tagSnapshots = [taskSnapshot, untaggedTaskSnapshot, both, extra, second];
  embeddedWebview.send({ command: 'render', snapshots: tagSnapshots, warning: 'Some task providers could not be scanned.' });
  embeddedWebview.selectTag(['test & smoke', 'second']);
  assert.equal(embeddedWebview.tagPopover.hidden, false, 'Selecting multiple checkboxes keeps the dropdown open.');
  assert.equal(embeddedWebview.tagSummary.getAttribute('aria-label'), 'Tags, 2 selected');
  embeddedWebview.pointerDown('sort');
  assert.equal(embeddedWebview.tagPopover.hidden, true, 'Clicking outside closes the dropdown.');
  embeddedWebview.toggleTagDropdown();
  embeddedWebview.pressEscape();
  assert.equal(embeddedWebview.tagPopover.hidden, true, 'Escape closes the dropdown.');
  assert.equal(embeddedWebview.tagSummary.focused, true, 'Escape returns focus to the trigger.');
  // Combined search and AND tag filtering must not lose selected state.
  embeddedWebview.toggleRegex();
  embeddedWebview.setSearch('^(Both|Extra) tags$');
  assert.match(embeddedWebview.list.innerHTML, /Both tags/);
  assert.match(embeddedWebview.list.innerHTML, /Extra tags/);
  assert.doesNotMatch(embeddedWebview.list.innerHTML, /Second only/);
  embeddedWebview.toggleRegex();
  embeddedWebview.setSearch('');
  assert.match(embeddedWebview.list.innerHTML, /Both tags/);
  assert.match(embeddedWebview.list.innerHTML, /Extra tags/);
  assert.doesNotMatch(embeddedWebview.list.innerHTML, /Validated task|Untagged task|Second only/);
  embeddedWebview.send({ command: 'render', snapshots: tagSnapshots });
  assert.equal(embeddedWebview.tagFilter.querySelectorAll('input:checked').length, 2, 'Refresh retains selected tags.');
  embeddedWebview.selectTag(['second']);
  assert.match(embeddedWebview.list.innerHTML, /Second only/);
  embeddedWebview.clearTags();
  assert.match(embeddedWebview.list.innerHTML, /Untagged task/);
  assert.equal(embeddedWebview.tagFilter.querySelectorAll('input:checked').length, 0);
  const sixTags = { ...taskSnapshot, id: 'six-tags', tags: ['one', 'two', 'three', 'four', 'five', 'six'] };
  embeddedWebview.send({ command: 'render', snapshots: [sixTags] });
  assert.equal(embeddedWebview.tagFilter.querySelectorAll('input').length, 6,
    'All options remain reachable even though only five checkbox rows fit in the scrollable panel.');
  embeddedWebview.send({ command: 'render', snapshots: [untaggedTaskSnapshot] });
  assert.match(embeddedWebview.tagFilter.innerHTML, /No tags available/, 'Empty tag lists show an empty state.');
  embeddedWebview.send({ command: 'render', snapshots: tagSnapshots });
  embeddedWebview.selectTag(['test & smoke', 'second']);
  embeddedWebview.send({ command: 'render', snapshots: [taskSnapshot, untaggedTaskSnapshot] });
  assert.match(embeddedWebview.list.innerHTML, /Validated task/);
  assert.doesNotMatch(embeddedWebview.list.innerHTML, /Untagged task/);
  assert.equal(embeddedWebview.tagFilter.querySelectorAll('input:checked').length, 1, 'Only vanished tags are deselected.');
  embeddedWebview.send({ command: 'render', snapshots: [taskSnapshot, untaggedTaskSnapshot], warning: 'Some task providers could not be scanned.' });
  renderedTaskHtml = embeddedWebview.list.innerHTML;
  assert.equal(
    embeddedWebview.warningRegion.children[0]?.dataset.message,
    'Some task providers could not be scanned.',
    'A valid warning should remain visible.'
  );

  for (const malformedMessage of [
    undefined,
    null,
    {},
    { command: 'refresh', snapshots: [] },
    { command: 'render' },
    { command: 'render', snapshots: null },
    { command: 'render', snapshots: 'not-an-array' },
    { command: 'render', snapshots: [null] },
    { command: 'render', snapshots: [{}] },
    { command: 'render', snapshots: [{ ...taskSnapshot, id: '' }] },
    { command: 'render', snapshots: [{ ...taskSnapshot, id: '   ' }] },
    { command: 'render', snapshots: [taskSnapshot, { ...taskSnapshot, dependsOn: [null] }] },
    { command: 'render', snapshots: [{ ...taskSnapshot, tags: [null] }] },
    { command: 'refresh', snapshots: [], warning: 'Must be ignored' }
  ]) {
    assert.doesNotThrow(() => embeddedWebview.send(malformedMessage));
    assert.equal(embeddedWebview.list.innerHTML, renderedTaskHtml, 'Malformed or unrelated messages must not erase the task board.');
    assert.equal(
      embeddedWebview.warningRegion.children[0]?.dataset.message,
      'Some task providers could not be scanned.',
      'Malformed or unrelated messages must not clear or replace a warning.'
    );
  }

  embeddedWebview.send({ command: 'render', snapshots: [taskSnapshot], warning: 'Updated warning.' });
  assert.equal(embeddedWebview.warningRegion.children[0]?.dataset.message, 'Updated warning.');
  embeddedWebview.send({
    command: 'render',
    snapshots: [
      taskSnapshot,
      { ...taskSnapshot, id: 'global-task', name: 'Global task', source: 'Global · Tasks Sidebar' },
      { ...taskSnapshot, id: 'npm-task', name: 'npm task', source: 'npm' }
    ]
  });
  assert.match(embeddedWebview.list.innerHTML, /aria-label="Edit Validated task"/);
  assert.match(embeddedWebview.list.innerHTML, /aria-label="Edit Global task"/);
  assert.doesNotMatch(embeddedWebview.list.innerHTML, /aria-label="Edit npm task"/);
  embeddedWebview.setFilter('external');
  assert.match(embeddedWebview.list.innerHTML, /npm task/);
  assert.doesNotMatch(embeddedWebview.list.innerHTML, /Global task|Validated task/);
  embeddedWebview.setFilter('all');

  embeddedWebview.send({ command: 'render', snapshots: [taskSnapshot, { ...taskSnapshot, id: 'folder-b', workspaceFolderName: 'Folder B' }, { ...taskSnapshot, id: 'npm-task', source: 'npm' }] });
  assert.equal(embeddedWebview.taskCount.textContent, '3 tasks', 'Multi-root and enabled external-provider definitions count separately.');
  embeddedWebview.send({ command: 'render', snapshots: [taskSnapshot, { ...taskSnapshot, id: 'folder-b', workspaceFolderName: 'Folder B' }] });
  assert.equal(embeddedWebview.taskCount.textContent, '2 tasks', 'Removing external-provider tasks updates the count.');
  embeddedWebview.send({ command: 'render', snapshots: [taskSnapshot, { ...taskSnapshot, executionId: 'parallel-2' }, { ...untaggedTaskSnapshot, orphaned: true }] });
  assert.equal(embeddedWebview.taskCount.textContent, '1 task', 'Parallel executions and orphaned entries do not inflate the count.');
  embeddedWebview.send({ command: 'render', snapshots: [taskSnapshot] });
  assert.equal(embeddedWebview.taskCount.textContent, '1 task', 'Singular label is used for one task.');
  embeddedWebview.send({ command: 'render', snapshots: [] });
  assert.equal(embeddedWebview.taskCount.textContent, '0 tasks', 'A successful empty discovery displays zero tasks.');
  assert.doesNotMatch(embeddedWebview.list.innerHTML, /Validated task/, 'A valid empty render should clear tasks.');
  assert.equal(embeddedWebview.warningRegion.children.length, 0, 'A valid warning-free render should clear warnings.');
  embeddedWebview.send({ command: 'render', snapshots: [], warning: 'Discovery failed' });
  assert.equal(embeddedWebview.taskCount.textContent, 'Tasks unavailable', 'Failure without data must not report zero tasks.');

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

  for (const malformedMessage of [
    undefined,
    {},
    { command: 'run' },
    { command: 'stop', id: '' },
    { command: 'restart', id: 1 },
    { command: 'output', id: {} },
    { command: 'terminal' },
    { command: 'edit', id: null },
    { command: 'unsupported' }
  ]) await failingWebviewHarness.send(malformedMessage);
  assert.deepEqual(failureReports.slice(routeCases.length), [
    { message: 'The sidebar action could not be completed.', error: 'The sidebar sent an invalid action.' },
    { message: 'The sidebar action could not be completed.', error: 'The sidebar sent an invalid action.' },
    { message: 'The sidebar action could not be completed.', error: 'The selected task is no longer available. Refresh the view and try again.' },
    { message: 'The sidebar action could not be completed.', error: 'The selected task is no longer available. Refresh the view and try again.' },
    { message: 'The sidebar action could not be completed.', error: 'The selected task is no longer available. Refresh the view and try again.' },
    { message: 'The sidebar action could not be completed.', error: 'The sidebar sent an unsupported action.' },
    { message: 'The sidebar action could not be completed.', error: 'The sidebar sent an unsupported action.' },
    { message: 'The sidebar action could not be completed.', error: 'The selected task is no longer available. Refresh the view and try again.' },
    { message: 'The sidebar action could not be completed.', error: 'The sidebar sent an unsupported action.' }
  ]);
}

module.exports = {
  async run() {
    const { useTestHome, testGlobalTasks } = require('./suite-global.js');
    useTestHome();
    await run();
    await testGlobalTasks();
  }
};
