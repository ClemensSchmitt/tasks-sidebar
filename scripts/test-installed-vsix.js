'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  downloadAndUnzipVSCode,
  resolveCliArgsFromVSCodeExecutablePath,
  runTests,
} = require('@vscode/test-electron');
const { inspectVsix, readManifests } = require('./release');

const root = path.resolve(__dirname, '..');

function findVsix() {
  const requested = process.env.VSIX_PATH;
  if (requested) {
    const candidate = path.resolve(root, requested);
    if (!fs.existsSync(candidate)) throw new Error('VSIX_PATH does not exist: ' + candidate);
    return candidate;
  }
  const candidates = fs.readdirSync(root).filter(name => name.toLowerCase().endsWith('.vsix'));
  if (candidates.length !== 1) {
    throw new Error('Expected exactly one VSIX in the project root; found ' + candidates.length + '. Run npm run package first.');
  }
  return path.join(root, candidates[0]);
}

function runCli(cli, prefix, args) {
  const result = spawnSync(cli, [...prefix, ...args], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error('VS Code CLI failed (' + result.status + '):\n' + (result.stdout || '') + '\n' + (result.stderr || ''));
  }
  return (result.stdout || '') + (result.stderr || '');
}

async function main() {
  const vsix = findVsix();
  const { version } = readManifests(root);
  const inspection = inspectVsix(vsix);
  if (inspection.version !== version || inspection.identityVersion !== version) {
    throw new Error('VSIX package version does not match the repository manifests.');
  }
  const extensionId = inspection.extensionId;
  const vscodeVersion = process.env.VSCODE_VERSION || 'stable';
  const tempBase = process.platform === 'darwin' ? '/tmp' : os.tmpdir();
  const tempDirectory = fs.mkdtempSync(path.join(tempBase, 'tsv-'));
  const extensionsDirectory = path.join(tempDirectory, 'e');
  const userDataDirectory = path.join(tempDirectory, 'd');
  const hostReportPath = path.join(tempDirectory, 'r.json');
  fs.mkdirSync(extensionsDirectory, { recursive: true });
  fs.mkdirSync(userDataDirectory, { recursive: true });

  try {
    const executable = await downloadAndUnzipVSCode({ version: vscodeVersion });
    const [cli, ...cliPrefix] = resolveCliArgsFromVSCodeExecutablePath(executable, { reuseMachineInstall: true });
    const profileArgs = [
      '--user-data-dir=' + userDataDirectory,
      '--extensions-dir=' + extensionsDirectory,
    ];
    runCli(cli, cliPrefix, [...profileArgs, '--install-extension', vsix, '--force']);
    const installedExtensions = runCli(cli, cliPrefix, [...profileArgs, '--list-extensions', '--show-versions']);
    const expectedIdentity = (extensionId + '@' + version).toLowerCase();
    const actualIdentities = installedExtensions.split(/\r?\n/).map(line => line.trim().toLowerCase());
    assert.ok(actualIdentities.includes(expectedIdentity),
      'VS Code CLI did not report the installed extension ' + expectedIdentity + '. Output:\n' + installedExtensions);

    process.env.VSIX_EXTENSION_ID = extensionId;
    process.env.VSIX_EXPECTED_VERSION = version;
    process.env.VSIX_EXTENSIONS_DIR = extensionsDirectory;
    process.env.VSIX_HOST_REPORT = hostReportPath;
    const fixtureWorkspace = path.join(root, 'test', 'integration', 'workspace');
    await runTests({
      vscodeExecutablePath: executable,
      extensionDevelopmentPath: path.join(root, 'test', 'installed', 'host'),
      extensionTestsPath: path.join(root, 'test', 'installed', 'suite.js'),
      launchArgs: [
        fixtureWorkspace,
        ...profileArgs,
        '--disable-workspace-trust',
        ...(process.platform === 'linux' ? ['--disable-gpu'] : []),
      ],
    });

    const hostReport = JSON.parse(fs.readFileSync(hostReportPath, 'utf8'));
    const report = {
      result: 'passed',
      extensionId,
      extensionVersion: version,
      vsixFile: path.basename(vsix),
      requestedVSCodeVersion: vscodeVersion,
      actualVSCodeVersion: hostReport.actualVSCodeVersion,
      platform: process.platform,
      architecture: process.arch,
      installMethod: 'VS Code CLI --install-extension',
      isolatedProfile: true,
      packageFileCount: inspection.entryCount,
      requiredPackageFiles: inspection.requiredFiles,
      packageFiles: inspection.files,
      installedExtensionRelativePath: hostReport.installedExtensionRelativePath,
      checks: {
        packageContentAudit: 'passed',
        cliInstallationAndVersion: 'passed',
        installedPackageDiscoveredByExtensionHost: 'passed',
        activityBarViewCommand: 'passed',
        installedExtensionActivation: 'passed',
        refreshCommand: 'passed',
      },
    };
    fs.writeFileSync(path.join(root, 'vsix-install-probe.json'), JSON.stringify(report, null, 2) + '\n');
    process.stdout.write(JSON.stringify({
      result: report.result,
      extensionId,
      extensionVersion: version,
      requestedVSCodeVersion: vscodeVersion,
      actualVSCodeVersion: hostReport.actualVSCodeVersion,
      platform: process.platform,
      architecture: process.arch,
      packageFileCount: inspection.entryCount,
      checks: report.checks,
    }, null, 2) + '\n');
  } finally {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
