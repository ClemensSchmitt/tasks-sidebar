const path = require('node:path');
const { runTests } = require('@vscode/test-electron');

runTests({
  version: process.env.VSCODE_VERSION || 'stable',
  extensionDevelopmentPath: path.resolve(__dirname, '../..'),
  extensionTestsPath: path.resolve(__dirname, 'suite.js'),
  launchArgs: [
    path.resolve(__dirname, 'workspace'),
    '--disable-workspace-trust',
    '--skip-welcome',
    '--skip-release-notes',
    ...(process.platform === 'linux' ? ['--no-sandbox', '--disable-gpu'] : [])
  ]
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
