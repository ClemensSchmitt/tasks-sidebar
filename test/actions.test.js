const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const runtime = require('../out/runtime.js');
const globalTasks = require('../out/globalTasks.js');

function extensionRequire(vscode) {
  return name => {
    if (name === 'vscode') return vscode;
    if (name === './runtime') return runtime;
    if (name === './globalTasks') return globalTasks;
    return require(name);
  };
}

function extensionCode(file) {
  const source = fs.readFileSync(file, 'utf8');
  return file.endsWith('.ts') ? ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText : source;
}

function harness() {
  const calls = [];
  const folder = { uri: { toString: () => 'folder-two' } };
  const other = { uri: { toString: () => 'folder-one' } };
  const document = {
    getText: () => '{"tasks":[{"label":"same-prefix"},{"label":"same","command":"echo two"}]}',
    positionAt: offset => offset
  };
  class FileSystemError extends Error { constructor(code) { super(code); this.code = code; } }
  const api = {
    FileSystemError,
    TaskScope: { Global: 1, Workspace: 2 },
    Range: class { constructor(start, end) { this.start = start; this.end = end; } },
    TextEditorRevealType: { InCenter: 1 },
    Uri: { joinPath: (uri, ...parts) => uri.toString() + '/' + parts.join('/') },
    workspace: {
      workspaceFolders: [other, folder],
      getWorkspaceFolder: () => ({ name: 'second' }),
      fs: {
        stat: async () => {},
        createDirectory: async () => assert.fail('Navigation must not create folders'),
        writeFile: async () => assert.fail('Navigation must not modify files')
      },
      openTextDocument: async uri => { calls.push(['document', uri]); return document; }
    },
    window: {
      showInformationMessage: async message => calls.push(['info', message]),
      showWarningMessage: async message => calls.push(['warning', message]),
      showTextDocument: async (doc, options) => {
        calls.push(['editor', doc, options]);
        return { revealRange: (...args) => calls.push(['reveal', ...args]) };
      }
    },
  };
  const file = require.resolve('../out/extension.js');
  const module = { exports: {} };
  vm.runInNewContext(extensionCode(file), {
    exports: module.exports, module, Buffer, console, setTimeout, clearTimeout,
    require: extensionRequire(api)
  }, { filename: file });
  const board = Object.create(module.exports.TaskBoard.prototype);
  board.reportError = (message, error) => calls.push(['error', message, error.message]);
  const task = { name: 'same', source: 'Workspace', scope: folder };
  board.findTask = async () => task;
  return { api, board, calls, task, document };
}

test('Edit chooses the exact definition in the task workspace folder', async () => {
  const { board, calls, document } = harness();
  await board.openTasksJson('task');
  assert.equal(calls[0][1], 'folder-two/.vscode/tasks.json');
  const range = calls[1][2].selection;
  assert.equal(JSON.parse(document.getText().slice(range.start, range.end)).command, 'echo two');
  assert.equal(calls[2][0], 'reveal');
});

test('Edit rejects external tasks, missing/ambiguous definitions and read failures', async () => {
  let h = harness();
  h.task.source = 'npm';
  await h.board.openTasksJson('task');
  assert.equal(h.calls[0][0], 'warning');
  for (const text of ['{"tasks":[]}', '{"tasks":[{"label":"renamed"}]}', '{"tasks":[{"label":"same"},{"label":"same"}]}']) {
    h = harness();
    h.document.getText = () => text;
    await h.board.openTasksJson('task');
    assert.equal(h.calls.at(-1)[0], 'warning');
    assert.ok(!h.calls.some(call => call[0] === 'editor'));
  }
  h = harness();
  h.api.workspace.fs.stat = async () => { throw new h.api.FileSystemError('FileNotFound'); };
  await h.board.openTasksJson('task');
  assert.equal(h.calls[0][0], 'warning');
  h = harness();
  h.board.findTask = async () => { throw new Error('provider failed'); };
  await h.board.openTasksJson('task');
  assert.equal(h.calls[0][0], 'error');
  h = harness();
  h.board.findTask = async () => undefined;
  await h.board.openTasksJson('task');
  assert.equal(h.calls[0][0], 'warning');
});


function creationHarness({ saved = true, roots = 2, scheme = 'file', eol = 1, text = saved && scheme !== 'untitled' ? '{"folders":[],"tasks":{"version":"2.0.0","tasks":[]}}' : '{"version":"2.0.0","tasks":[]}', missing = false, dirty = false, race = false, raceAfterEdit = false, save = true } = {}) {
  const uri = value => ({ scheme: value.split(':')[0], toString: () => value });
  const workspaceUri = uri(scheme + ':///workspace/project.code-workspace');
  const folders = Array.from({ length: roots }, (_, index) => ({ name: 'repo-' + index, uri: uri('file:///workspace/repo-' + index) }));
  const calls = { writes: 0, refresh: 0, errors: [], selections: [], opened: [], input: 0 };
  const documents = new Map();
  const createDocument = target => {
    const doc = {
      uri: target, version: 1, isDirty: dirty, text, eol,
      getText: () => doc.text,
      positionAt: offset => ({ offset }),
      save: async () => { if (save) { calls.writes++; doc.isDirty = false; } return save; }
    };
    documents.set(target.toString(), doc);
    return doc;
  };
  if (!missing) createDocument(saved ? workspaceUri : folders[0]?.uri && uri(folders[0].uri.toString() + '/.vscode/tasks.json'));
  class FileSystemError extends Error { constructor(code) { super(code); this.code = code; } }
  const vscode = {
    TaskScope: { Workspace: 2 },
    EndOfLine: { LF: 1, CRLF: 2 },
    Uri: { joinPath: (base, ...parts) => uri(base.toString() + '/' + parts.join('/')) },
    FileSystemError,
    Range: class { constructor(start, end) { this.start = start; this.end = end; } },
    Position: class { constructor(line, character) { this.line = line; this.character = character; } },
    WorkspaceEdit: class {
      createFile(target, options) { this.target = target; assert.equal(options.overwrite, false); }
      insert(_target, _position, value) { this.value = value; }
    },
    TextEditorRevealType: { InCenter: 0 },
    env: {},
    window: {
      showInformationMessage() {}, showWarningMessage(message) { calls.warning = message; },
      showErrorMessage(message) { calls.errors.push(message); },
      async showTextDocument(doc, options) {
        calls.opened.push(doc.uri.toString());
        calls.selections.push(options?.selection);
        if (race) { doc.version++; doc.isDirty = true; }
        return { revealRange() {}, async edit(callback) {
          callback({ replace(_range, value) {
            doc.text = eol === 2 ? value.replace(/\r?\n/g, '\r\n') : value;
            doc.version++;
            doc.isDirty = true;
          } });
          if (raceAfterEdit) { doc.text += '\n// user edit'; doc.version++; }
          return true;
        } };
      }
    },
    workspace: {
      workspaceFile: saved ? workspaceUri : undefined,
      workspaceFolders: folders,
      get textDocuments() { return [...documents.values()]; },
      fs: {
        async stat(target) { if (!documents.has(target.toString())) throw new FileSystemError('FileNotFound'); },
        async createDirectory() { calls.directory = true; }
      },
      async openTextDocument(target) { return documents.get(target.toString()) ?? createDocument(target); },
      async applyEdit(edit) {
        if (documents.has(edit.target.toString())) return false;
        const doc = createDocument(edit.target); doc.text = edit.value; doc.isDirty = true;
        return true;
      }
    }
  };
  const exports = {};
  vm.runInNewContext(extensionCode(require.resolve('../out/extension.js')), {
    exports, require: extensionRequire(vscode),
    Buffer, console, setTimeout, clearTimeout, setInterval, clearInterval, process, performance
  });
  // Creation/navigation do not require activating the board timers or persistence.
  const board = Object.create(exports.TaskBoard.prototype);
  board.refresh = async () => { calls.refresh++; };
  board.reportError = (message, error) => calls.errors.push(message + ' ' + error.message);
  const ui = (pick = items => items[0], inputs = ['new task', 'echo ok']) => ({
    async showQuickPick(items) { calls.targets = items; return pick(items); },
    async showInputBox() { calls.input++; return inputs.shift(); }
  });
  return { board, calls, ui, documents, workspaceUri, vscode, createDocument };
}

test('task creation offers workspace and folder targets and appends at workspace scope', async () => {
  const h = creationHarness();
  await h.board.createTask(h.ui());
  assert.equal(h.calls.targets[0].label, 'Entire Workspace');
  assert.ok(h.calls.targets[0].description.includes('project.code-workspace'));
  assert.deepEqual(Array.from(h.calls.targets, item => item.label), ['Entire Workspace', 'repo-0', 'repo-1']);
  assert.ok(h.calls.targets[1].description.startsWith('Folder'));
  const document = h.documents.get(h.workspaceUri.toString());
  assert.equal(runtime.parseJsonc(document.text).tasks.tasks[0].label, 'new task');
  assert.equal(h.calls.writes, 1);
  assert.equal(h.calls.refresh, 1);
  assert.deepEqual(h.calls.errors, []);
});

test('folder selection creates its own tasks.json and keeps the workspace file unchanged', async () => {
  const h = creationHarness();
  const original = h.documents.get(h.workspaceUri.toString()).text;
  await h.board.createTask(h.ui(items => items[2]));
  assert.equal(h.documents.get(h.workspaceUri.toString()).text, original);
  assert.equal(runtime.parseJsonc(h.documents.get('file:///workspace/repo-1/.vscode/tasks.json').text).tasks[0].label, 'new task');
  assert.equal(h.calls.writes, 1);
  assert.equal(h.calls.refresh, 1);
  assert.deepEqual(h.calls.errors, []);
});

test('unsaved and single-folder workspaces retain folder targets only', async () => {
  for (const options of [{ saved: false }, { scheme: 'untitled' }]) {
    const h = creationHarness(options);
    await h.board.createTask(h.ui());
    assert.deepEqual(Array.from(h.calls.targets, item => item.label), ['repo-0', 'repo-1']);
    assert.equal(h.calls.writes, 1);
  }
  const single = creationHarness({ saved: false, roots: 1, text: '{"version":"2.0.0","tasks":[]}' });
  await single.board.createTask(single.ui(() => { throw new Error('No picker for single folder'); }));
  assert.equal(single.calls.writes, 1);
  const empty = creationHarness({ saved: false, roots: 0, missing: true });
  await empty.board.createTask(empty.ui());
  assert.equal(empty.calls.writes, 0);
  assert.equal(empty.calls.input, 0);
});

test('canceling target, label or command never writes or opens a task file', async () => {
  for (const [picker, inputs] of [[() => undefined, []], [items => items[0], [undefined]], [items => items[0], ['label', undefined]]]) {
    const h = creationHarness();
    await h.board.createTask(h.ui(picker, inputs));
    assert.equal(h.calls.writes, 0);
    assert.equal(h.calls.opened.length, 0);
    assert.equal(h.calls.refresh, 0);
  }
});

test('invalid, ambiguous, dirty and concurrently changed files are not saved; errors name the file', async () => {
  for (const options of [
    { text: '{invalid' }, { text: '{"tasks":[]}' }, { text: '{"tasks":{},"tasks":{}}' },
    { dirty: true }, { race: true }, { raceAfterEdit: true }, { save: false }, { missing: true }
  ]) {
    const h = creationHarness(options);
    await h.board.createTask(h.ui());
    assert.equal(h.calls.writes, 0);
    assert.equal(h.calls.refresh, 0);
    assert.equal(h.calls.errors.length, 1, JSON.stringify(options));
    assert.ok(h.calls.errors[0].includes('project.code-workspace'));
  }
});

test('workspace edit action selects only tasks.tasks without mutating the source', async () => {
  const text = '{"settings":{"tasks":[{"label":"same"}]},"tasks":{"tasks":[{"label":"same","command":"echo ok"}]}}';
  const h = creationHarness({ text });
  h.board.findTask = async () => ({ name: 'same', source: 'Workspace', scope: 2 });
  await h.board.openTasksJson('task');
  assert.deepEqual(h.calls.errors, []);
  const selection = h.calls.selections[0];
  assert.equal(text.slice(selection.start.offset, selection.end.offset), '{"label":"same","command":"echo ok"}');
  assert.equal(h.calls.writes, 0);
  assert.equal(h.documents.get(h.workspaceUri.toString()).text, text);
});

test('saved workspaces without folders can create tasks and continue sidebar discovery', async () => {
  const h = creationHarness({ roots: 0 });
  await h.board.createTask(h.ui());
  assert.equal(h.calls.targets.length, 1);
  assert.equal(h.calls.targets[0].label, 'Entire Workspace');
  assert.equal(h.calls.writes, 1);
  assert.equal(runtime.parseJsonc(h.documents.get(h.workspaceUri.toString()).text).tasks.tasks[0].label, 'new task');

  const board = h.board;
  board.view = {};
  board.refreshRevision = 0;
  board.running = new Map();
  board.lastGoodSnapshots = [];
  board.context = { workspaceState: { update: async () => {} } };
  h.vscode.workspace.getConfiguration = () => ({ get: () => false });
  let discovered = false;
  board.fetchTasksWithProviderFallback = async () => { discovered = true; return { tasks: [], providerFailed: false }; };
  board.reconcileRunningExecutions = () => {};
  board.reconcilePersistedObservations = () => {};
  board.loadWorkspaceTaskSpecs = async () => new Map();
  board.getTasksJsonWarning = async () => undefined;
  board.renderSnapshot = (_tasks, warning) => { assert.equal(warning, undefined); };
  board.scheduleNextDiscovery = () => {};
  await board.publish();
  assert.equal(discovered, true, 'A saved workspace is open even when it contains no folder roots.');
  assert.doesNotMatch(await board.getDiscoveryWarning(false), /No workspace is open/);
});

test('global task path uses the current account home with native path rules', () => {
  assert.equal(globalTasks.globalTaskPath('C:\\Users\\Alice', 'win32'),
    'C:\\Users\\Alice\\.vscode\\extensions\\tasksidebar\\tasks.json');
  assert.equal(globalTasks.globalTaskPath('D:\\Redirected Home\\Alice', 'win32'),
    'D:\\Redirected Home\\Alice\\.vscode\\extensions\\tasksidebar\\tasks.json');
  assert.equal(globalTasks.globalTaskPath('\\\\server\\profiles\\Alice', 'win32'),
    '\\\\server\\profiles\\Alice\\.vscode\\extensions\\tasksidebar\\tasks.json');
  assert.equal(globalTasks.globalTaskPath('/home/alice', 'linux'),
    '/home/alice/.vscode/extensions/tasksidebar/tasks.json');
});

test('global JSONC supports OS overrides, tags and deduplication while reporting invalid entries', () => {
  const definition = `{
    "label": "Hello", "type": "shell", "command": "echo", "args": ["base"],
    "tags": [" Example ", "example"], "options": { "cwd": "work", "env": { "BASE": "yes" } },
    "windows": { "args": [{"value": "my value", "quoting": "strong"}], "options": { "env": { "OS": "windows" } } },
    "problemMatcher": "$tsc", "presentation": { "reveal": "silent" }
  }`;
  const result = globalTasks.parseGlobalTasks(`{
    // Comments and trailing commas are part of tasks.json
    "version": "2.0.0", "tasks": [${definition}, ${definition}, {"label":"Unsupported","type":"npm"},],
  }`, 'win32');
  assert.equal(result.tasks.length, 1);
  assert.equal(result.tasks[0].index, 0);
  assert.equal(result.problems.length, 1);
  assert.match(result.problems[0], /shell or process/);
  const [task] = result.tasks;
  assert.deepEqual(task.tags, ['Example']);
  assert.deepEqual(task.args, [{ value: 'my value', quoting: 'strong' }]);
  assert.deepEqual(task.env, { BASE: 'yes', OS: 'windows' });
  assert.equal(task.cwd, 'work');
  assert.deepEqual(task.problemMatchers, ['$tsc']);
  assert.equal(task.presentation.reveal, 'silent');

  const renamed = globalTasks.parseGlobalTasks(`{"version":"2.0.0","tasks":[${definition.replace('Hello', 'Renamed')}]}`, 'win32');
  assert.equal(task.fingerprint, renamed.tasks[0].fingerprint);
  const conflicting = globalTasks.parseGlobalTasks(`{"version":"2.0.0","tasks":[${definition}, ${definition.replace('"echo"', '"other"')}]}`, 'win32');
  assert.equal(conflicting.tasks.length, 0);
  assert.match(conflicting.problems[0], /Conflicting definitions/);
  assert.throws(() => globalTasks.parseGlobalTasks('{"version":', 'win32'), /Invalid JSONC/);
});

test('global commands resolve folder variables only with unique context and resolve relative cwd from home', () => {
  const context = {
    home: 'D:\\Redirected Home\\Alice', platform: 'win32', env: { EXAMPLE: 'test' },
    folders: [{ name: 'A', path: 'D:\\Work\\first' }, { name: 'B', path: 'D:\\Work\\second' }]
  };
  const task = { problemMatchers: [], command: 'node', cwd: 'work', args: ['${workspaceFolder:B}', '${env:EXAMPLE}', '${userHome}'] };
  const resolved = globalTasks.resolveGlobalExecution(task, context);
  assert.equal(resolved.cwd, 'D:\\Redirected Home\\Alice\\work');
  assert.deepEqual(resolved.args, ['D:\\Work\\second', 'test', 'D:\\Redirected Home\\Alice']);
  assert.equal(globalTasks.resolveGlobalExecution({ command: 'node', problemMatchers: [] }, { ...context, folders: [] }).cwd, '${userHome}');
  assert.equal(globalTasks.resolveGlobalExecution({ command: 'node', problemMatchers: [], cwd: '${workspaceFolder}' }, {
    ...context, folders: context.folders.slice(0, 1)
  }).cwd, 'D:\\Work\\first');
  assert.throws(() => globalTasks.resolveGlobalExecution({ ...task, cwd: '${workspaceFolder}' }, context), /exactly one/);
  assert.throws(() => globalTasks.resolveGlobalExecution(task, { ...context, folders: [] }), /exactly one/);
  assert.throws(() => globalTasks.resolveGlobalExecution({ command: '${command:extension.run}', problemMatchers: [] }, context), /Unsupported variable/);
  const nested = { ...context, env: { NESTED: '${workspaceFolder}' } };
  assert.throws(() => globalTasks.resolveGlobalExecution({ ...task, command: '${env:NESTED}' }, nested), /expanded to another VS Code variable/);
  assert.equal(globalTasks.resolveGlobalExecution({ ...task, command: 'echo ${SHELL_VALUE}' }, context).command, 'echo ${SHELL_VALUE}');
  const withMatcher = { command: 'node', problemMatchers: ['$tsc'] };
  assert.throws(() => globalTasks.resolveGlobalExecution(withMatcher, context), /Named problem matchers/);
  assert.throws(() => globalTasks.resolveGlobalExecution(withMatcher, { ...context, folders: [] }), /Named problem matchers/);
  assert.equal(globalTasks.resolveGlobalExecution(withMatcher, { ...context, folders: context.folders.slice(0, 1) }).cwd, context.home);
});

test('global creation in an empty window appends to the shared file and preserves comments', async () => {
  const h = creationHarness({ roots: 0, saved: false, missing: true, eol: 2 });
  const location = 'file:///home/alice/.vscode/extensions/tasksidebar/tasks.json';
  h.board.globalUri = { toString: () => location };
  h.board.createGlobalTaskFile = async (target, value) => {
    assert.ok(!h.documents.has(target.toString()), 'Global creation must never replace an existing file.');
    h.createDocument(target).text = value;
    h.calls.writes++;
  };
  await h.board.createTask(h.ui());
  assert.equal(runtime.parseJsonc(h.documents.get(location).text).tasks[0].label, 'new task');
  h.documents.get(location).text = JSON.stringify(runtime.parseJsonc(h.documents.get(location).text))
    .replace('"tasks":', '/* keep this comment */ "tasks":');
  await h.board.createTask(h.ui(undefined, ['another', 'echo another']));
  assert.match(h.documents.get(location).text, /keep this comment/);
  assert.deepEqual(runtime.parseJsonc(h.documents.get(location).text).tasks.map(task => task.label), ['new task', 'another']);
  assert.match(h.documents.get(location).text, /\r\n/);
  await h.board.createTask(h.ui());
  assert.equal(h.calls.writes, 2);
  assert.match(h.calls.errors[0], /already uses that label/);
});
