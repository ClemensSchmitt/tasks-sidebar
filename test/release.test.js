'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const zlib = require('node:zlib');
const { bump, bumpVersion, inspectVsix, readManifests, verify, verifyVsix } = require('../scripts/release');

function fixtureDirectory(t, version = '0.0.5') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tasks-sidebar-release-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name: 'fixture', version }));
  fs.writeFileSync(path.join(directory, 'package-lock.json'), JSON.stringify({
    name: 'fixture', version, lockfileVersion: 3, packages: { '': { name: 'fixture', version } },
  }));
  return directory;
}

function makeStoredZip(entries, method = 0) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const [name, body] of Object.entries(entries)) {
    const nameBytes = Buffer.from(name);
    const uncompressed = Buffer.from(body);
    const data = method === 8 ? zlib.deflateRawSync(uncompressed) : uncompressed;
    const local = Buffer.alloc(30 + nameBytes.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(uncompressed.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    nameBytes.copy(local, 30);
    localParts.push(local, data);

    const central = Buffer.alloc(46 + nameBytes.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(0, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(uncompressed.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    nameBytes.copy(central, 46);
    centralParts.push(central);
    offset += local.length + data.length;
  }
  const centralSize = centralParts.reduce((size, part) => size + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, ...centralParts, end]);
}

function makeVsix(version, method = 0, extraEntries = {}) {
  const manifest = {
    name: 'fixture',
    publisher: 'fixture',
    version,
    main: './out/extension.js',
    icon: './resources/marketplace-icon.png',
    contributes: {
      viewsContainers: { activitybar: [{ id: 'tasksSidebar', title: 'Tasks', icon: './resources/tasks.svg' }] },
      views: { tasksSidebar: [{ id: 'tasksSidebar.view', name: 'Task board', type: 'webview' }] },
    },
  };
  return makeStoredZip({
    'extension/package.json': JSON.stringify(manifest),
    'extension.vsixmanifest': '<PackageManifest><Metadata><Identity Id="fixture" Publisher="fixture" Version="' + version + '" /></Metadata></PackageManifest>',
    'extension/out/extension.js': 'compiled entry',
    'extension/out/runtime.js': 'compiled runtime',
    'extension/resources/tasks.svg': '<svg />',
    'extension/resources/marketplace-icon.png': 'png',
    'extension/README.md': 'readme',
    'extension/CHANGELOG.md': 'changelog',
    'extension/LICENSE': 'license',
    ...extraEntries,
  }, method);
}

test('patch is the default and non-patch increments are explicit', () => {
  assert.equal(bumpVersion('0.0.5'), '0.0.6');
  assert.equal(bumpVersion('1.2.3', 'minor'), '1.3.0');
  assert.equal(bumpVersion('1.2.3', 'major'), '2.0.0');
  assert.throws(() => bumpVersion('1.2.3', 'release'), /Unknown release type/);
});

test('dry run calculates a patch release without changing either manifest', (t) => {
  const directory = fixtureDirectory(t);
  const before = fs.readFileSync(path.join(directory, 'package.json'), 'utf8');
  assert.deepEqual(bump(directory, 'patch', true), { currentVersion: '0.0.5', nextVersion: '0.0.6', dryRun: true });
  assert.equal(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'), before);
  assert.equal(readManifests(directory).version, '0.0.5');
});

test('CLI dry-run demonstrates the default patch release without writing files', (t) => {
  const directory = fixtureDirectory(t);
  const scripts = path.join(directory, 'scripts');
  fs.mkdirSync(scripts);
  const script = path.join(scripts, 'release.js');
  fs.copyFileSync(path.join(__dirname, '../scripts/release.js'), script);
  const result = spawnSync(process.execPath, [script, 'bump', '--dry-run'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { currentVersion: '0.0.5', nextVersion: '0.0.6', dryRun: true });
  assert.equal(readManifests(directory).version, '0.0.5');
});

test('bump updates package.json and all lockfile version fields together', (t) => {
  const directory = fixtureDirectory(t);
  assert.deepEqual(bump(directory), { currentVersion: '0.0.5', nextVersion: '0.0.6', dryRun: false });
  assert.equal(readManifests(directory).version, '0.0.6');
});

test('bump aborts if the manifests already disagree', (t) => {
  const directory = fixtureDirectory(t);
  const lockPath = path.join(directory, 'package-lock.json');
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  lock.packages[''].version = '0.0.4';
  fs.writeFileSync(lockPath, JSON.stringify(lock));
  assert.throws(() => bump(directory), /versions do not match/);
});

test('verification requires matching tag, manifest, lockfile and VSIX metadata', (t) => {
  const directory = fixtureDirectory(t);
  const vsix = path.join(directory, 'fixture.vsix');
  fs.writeFileSync(vsix, makeVsix('0.0.5'));
  assert.deepEqual(verify(directory, 'v0.0.5', vsix), { version: '0.0.5', tag: 'v0.0.5', vsixPath: vsix });
  assert.throws(() => verify(directory, 'v0.0.6', vsix), /does not match manifest/);
  fs.writeFileSync(vsix, makeVsix('0.0.6'));
  assert.throws(() => verifyVsix(vsix, '0.0.5'), /VSIX version mismatch/);
});

test('VSIX content audit checks runtime assets and rejects development or credential files', (t) => {
  const directory = fixtureDirectory(t);
  const vsix = path.join(directory, 'fixture.vsix');
  fs.writeFileSync(vsix, makeVsix('0.0.5'));
  const report = inspectVsix(vsix);
  assert.equal(report.extensionId, 'fixture.fixture');
  assert.ok(report.requiredFiles.includes('extension/out/runtime.js'));
  assert.ok(report.requiredFiles.includes('extension/resources/tasks.svg'));
  assert.ok(report.files.includes('extension/out/extension.js'));

  fs.writeFileSync(vsix, makeVsix('0.0.5', 0, {
    'extension/test/integration/suite.js': 'test fixture',
    'extension/.env.local': 'TOKEN=do-not-package',
  }));
  assert.throws(() => inspectVsix(vsix), /forbidden development, local, or credential files/);
});

test('VSIX verifier reads deflated ZIP entries and rejects malformed archives', (t) => {
  const directory = fixtureDirectory(t);
  const vsix = path.join(directory, 'fixture.vsix');
  fs.writeFileSync(vsix, makeVsix('0.0.5', 8));
  assert.doesNotThrow(() => verifyVsix(vsix, '0.0.5'));
  fs.writeFileSync(vsix, Buffer.from('not a zip'));
  assert.throws(() => verifyVsix(vsix, '0.0.5'), /valid ZIP archive/);
});
