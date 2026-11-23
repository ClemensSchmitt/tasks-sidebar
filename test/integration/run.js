const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs/promises');
const { fixture, testHomeVariable } = require('./global-fixture.js');
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
  const tempBase = process.platform === 'darwin' ? '/tmp' : os.tmpdir();
  const home = await fs.mkdtemp(path.join(tempBase, 'tasks-sidebar-profile-'));
  try {
    const globalPath = path.join(home, '.vscode', 'extensions', 'tasksidebar', 'tasks.json');
    await fs.mkdir(path.dirname(globalPath), { recursive: true });
    await fs.writeFile(globalPath, JSON.stringify(fixture), 'utf8');
    await fs.writeFile(path.join(home, 'shell-fixture.js'),
      'setTimeout(() => require("node:fs").writeFileSync("shell-result.txt", "ok"), 750);\n', 'utf8');
    // Distinct VS Code processes use one account-level file across all three window contexts.
    for (const [suite, target] of [
      ['suite.js', 'workspace'],
      ['suite-multiroot.js', 'multi-root.code-workspace'],
      ['suite-global.js', undefined]
    ]) {
      console.log(`Launching Extension Host suite ${suite}`);
      await runTests({
        ...common,
        extensionTestsEnv: { [testHomeVariable]: home },
        extensionTestsPath: path.resolve(__dirname, suite),
        launchArgs: [
          ...(target ? [path.resolve(__dirname, target)] : ['--new-window']),
          '--user-data-dir=' + path.join(home, suite + '-profile'),
          '--extensions-dir=' + path.join(home, '.vscode', 'extensions'),
          ...flags
        ]
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
