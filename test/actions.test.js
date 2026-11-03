const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

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
  const file = path.resolve(__dirname, '../out/extension.js');
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    exports: module.exports, module, Buffer, console, setTimeout, clearTimeout,
    require: name => name === 'vscode' ? api : require(path.resolve(path.dirname(file), name))
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
