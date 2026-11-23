const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs/promises');
const { fixture } = require('./global-fixture.js');
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
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'tasks-sidebar-profile-'));
  try {
    const globalPath = path.join(home, '.vscode', 'extensions', 'tasksidebar', 'tasks.json');
    await fs.mkdir(path.dirname(globalPath), { recursive: true });
    await fs.writeFile(globalPath, JSON.stringify(fixture), 'utf8');
    const options = {
      ...common,
      extensionTestsEnv: { HOME: home, USERPROFILE: home, TASKS_SIDEBAR_TEST_PROFILE: home }
    };
    // Distinct VS Code processes use one account-level file across all three window contexts.
    for (const [suite, target] of [
      ['suite.js', 'workspace'],
      ['suite-multiroot.js', 'multi-root.code-workspace'],
      ['suite-global.js', undefined]
    ]) {
      await runTests({
        ...options,
        extensionTestsPath: path.resolve(__dirname, suite),
        launchArgs: [...(target ? [path.resolve(__dirname, target)] : ['--new-window']), ...flags]
      });
    }
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
