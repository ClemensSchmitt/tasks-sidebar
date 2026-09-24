#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const root = path.resolve(__dirname, '..');

function readManifests(directory = root) {
  const packagePath = path.join(directory, 'package.json');
  const lockPath = path.join(directory, 'package-lock.json');
  const manifest = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  const versions = [manifest.version, lock.version, lock.packages?.['']?.version];
  if (versions.some((version) => typeof version !== 'string') || new Set(versions).size !== 1) {
    throw new Error(`package.json and package-lock.json versions do not match (${versions.join(', ')})`);
  }
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) {
    throw new Error(`Expected a stable X.Y.Z version, got ${manifest.version}`);
  }
  return { manifest, lock, packagePath, lockPath, version: manifest.version };
}

function bumpVersion(version, type = 'patch') {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Expected a stable X.Y.Z version, got ${version}`);
  const parts = version.split('.').map(Number);
  if (!['patch', 'minor', 'major'].includes(type)) throw new Error(`Unknown release type: ${type}`);
  if (type === 'major') return `${parts[0] + 1}.0.0`;
  if (type === 'minor') return `${parts[0]}.${parts[1] + 1}.0`;
  return `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
}

function bump(directory = root, type = 'patch', dryRun = false) {
  const current = readManifests(directory);
  const nextVersion = bumpVersion(current.version, type);
  if (!dryRun) {
    current.manifest.version = nextVersion;
    current.lock.version = nextVersion;
    current.lock.packages[''].version = nextVersion;
    fs.writeFileSync(current.packagePath, `${JSON.stringify(current.manifest, null, 2)}\n`);
    fs.writeFileSync(current.lockPath, `${JSON.stringify(current.lock, null, 2)}\n`);
  }
  return { currentVersion: current.version, nextVersion, dryRun };
}

function readZipEntry(zip, wantedName) {
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('VSIX is not a valid ZIP archive (end record missing)');
  const entries = zip.readUInt16LE(eocd + 10);
  let offset = zip.readUInt32LE(eocd + 16);
  for (let i = 0; i < entries; i++) {
    if (zip.readUInt32LE(offset) !== 0x02014b50) throw new Error('VSIX contains an invalid ZIP directory');
    const method = zip.readUInt16LE(offset + 10);
    const compressedSize = zip.readUInt32LE(offset + 20);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const localOffset = zip.readUInt32LE(offset + 42);
    const name = zip.toString('utf8', offset + 46, offset + 46 + nameLength);
    if (name === wantedName) {
      if (zip.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`Invalid ZIP entry: ${name}`);
      const localNameLength = zip.readUInt16LE(localOffset + 26);
      const localExtraLength = zip.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = zip.subarray(start, start + compressedSize);
      if (method === 0) return compressed;
      if (method === 8) return zlib.inflateRawSync(compressed);
      throw new Error(`Unsupported compression method ${method} in VSIX`);
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error(`VSIX is missing ${wantedName}`);
}

function verifyVsix(vsixPath, expectedVersion) {
  const zip = fs.readFileSync(vsixPath);
  const bundledManifest = JSON.parse(readZipEntry(zip, 'extension/package.json').toString('utf8'));
  const vsixManifest = readZipEntry(zip, 'extension.vsixmanifest').toString('utf8');
  const identity = vsixManifest.match(/<Identity\b[^>]*\bVersion=["']([^"']+)["']/i);
  if (!identity) throw new Error('VSIX extension.vsixmanifest has no Identity Version');
  if (bundledManifest.version !== expectedVersion || identity[1] !== expectedVersion) {
    throw new Error(`VSIX version mismatch: package.json=${bundledManifest.version}, VSIX Identity=${identity[1]}, expected=${expectedVersion}`);
  }
}

function verify(directory, tag, vsixPath) {
  const { version } = readManifests(directory);
  const expectedTag = `v${version}`;
  if (tag !== expectedTag) throw new Error(`Tag ${tag} does not match manifest version ${expectedTag}`);
  if (!vsixPath) throw new Error('A packaged VSIX path is required');
  verifyVsix(vsixPath, version);
  return { version, tag, vsixPath };
}

function parseArgs(argv) {
  const [command, ...args] = argv;
  const options = { type: 'patch', dryRun: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--type') options.type = args[++i];
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--tag') options.tag = args[++i];
    else if (arg === '--vsix') options.vsix = args[++i];
    else throw new Error(`Unknown option: ${arg}`);
  }
  return { command, options };
}

if (require.main === module) {
  try {
    const { command, options } = parseArgs(process.argv.slice(2));
    let result;
    if (command === 'bump') result = bump(root, options.type, options.dryRun);
    else if (command === 'verify') result = verify(root, options.tag, options.vsix);
    else throw new Error('Usage: node scripts/release.js bump [--type patch|minor|major] [--dry-run] | verify --tag vX.Y.Z --vsix <path>');
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`Release check failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { bump, bumpVersion, readManifests, verify, verifyVsix };
