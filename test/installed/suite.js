'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');

function waitFor(predicate, description, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (predicate()) return resolve();
      if (Date.now() >= deadline) return reject(new Error('Timed out waiting for ' + description + '.'));
      setTimeout(poll, 100);
    };
    poll();
  });
}

async function run() {
  const extensionId = process.env.VSIX_EXTENSION_ID;
  const expectedVersion = process.env.VSIX_EXPECTED_VERSION;
  const installDirectory = path.resolve(process.env.VSIX_EXTENSIONS_DIR);
  const reportPath = process.env.VSIX_HOST_REPORT;
  assert.ok(extensionId, 'The installed VSIX extension id must be provided.');
  assert.ok(expectedVersion, 'The packaged version must be provided.');
  assert.ok(reportPath, 'A VSIX host report path must be provided.');

  const extension = vscode.extensions.getExtension(extensionId);
  assert.ok(extension, 'The extension installed from the VSIX must be discoverable.');
  assert.equal(extension.packageJSON.version, expectedVersion, 'Installed extension version must match the VSIX.');
  const relativeInstallPath = path.relative(installDirectory, path.resolve(extension.extensionPath));
  assert.ok(relativeInstallPath && !relativeInstallPath.startsWith('..') && !path.isAbsolute(relativeInstallPath),
    'The extension must load from the isolated extensions directory, not the development checkout.');

  await vscode.commands.executeCommand('workbench.view.extension.tasksSidebar');
  await waitFor(() => extension.isActive, 'activation after opening the Tasks Activity Bar view');
  const commands = await vscode.commands.getCommands(true);
  assert.ok(commands.includes('tasksSidebar.refresh'), 'The installed extension must register its refresh command.');
  await vscode.commands.executeCommand('tasksSidebar.refresh');

  fs.writeFileSync(reportPath, JSON.stringify({
    actualVSCodeVersion: vscode.version,
    extensionId,
    extensionVersion: extension.packageJSON.version,
    installedExtensionRelativePath: relativeInstallPath,
    checks: {
      installedPackageDiscovered: true,
      activityBarViewCommandResolved: 'workbench.view.extension.tasksSidebar',
      extensionActivated: extension.isActive,
      refreshCommandCompleted: true,
    },
  }, null, 2) + '\n');
}

module.exports = { run };
