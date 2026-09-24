'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const zlib = require('node:zlib');
const { bump, bumpVersion, readManifests, verify, verifyVsix } = require('../scripts/release');

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

function makeVsix(version) {
  return makeStoredZip({
    'extension/package.json': JSON.stringify({ name: 'fixture', version }),
    'extension.vsixmanifest': `<PackageManifest><Metadata><Identity Id="fixture" Version="${version}" /></Metadata></PackageManifest>`,
  });
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

test('VSIX verifier reads deflated ZIP entries and rejects malformed archives', (t) => {
  const directory = fixtureDirectory(t);
  const vsix = path.join(directory, 'fixture.vsix');
  fs.writeFileSync(vsix, makeStoredZip({
    'extension/package.json': JSON.stringify({ version: '0.0.5' }),
    'extension.vsixmanifest': '<PackageManifest><Identity Version="0.0.5" /></PackageManifest>',
  }, 8));
  assert.doesNotThrow(() => verifyVsix(vsix, '0.0.5'));
  fs.writeFileSync(vsix, Buffer.from('not a zip'));
  assert.throws(() => verifyVsix(vsix, '0.0.5'), /valid ZIP archive/);
});
