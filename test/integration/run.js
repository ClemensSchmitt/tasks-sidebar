const path = require('node:path');
const { runTests } = require('@vscode/test-electron');

const common = {
  version: process.env.VSCODE_VERSION || 'stable',
  extensionDevelopmentPath: path.resolve(__dirname, '../..')
};
const flags = [
  '--disable-workspace-trust',
  '--skip-welcome',
  '--skip-release-notes',
  ...(process.platform === 'linux' ? ['--no-sandbox', '--disable-gpu'] : [])
];

async function run() {
  // Keep original single-root tests unchanged; changing workspace folders
  // inside an active Extension Host restarts the host and cancels tests.
  await runTests({
    ...common,
    extensionTestsPath: path.resolve(__dirname, 'suite.js'),
    launchArgs: [path.resolve(__dirname, 'workspace'), ...flags]
  });
  // A separate VS Code process loads the actual .code-workspace from startup.
  await runTests({
    ...common,
    extensionTestsPath: path.resolve(__dirname, 'suite-multiroot.js'),
    launchArgs: [path.resolve(__dirname, 'multi-root.code-workspace'), ...flags]
  });
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
