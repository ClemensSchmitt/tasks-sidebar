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
  if (!Buffer.isBuffer(zip) || zip.length < 22) throw new Error('VSIX is not a valid ZIP archive');
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('VSIX is not a valid ZIP archive (end record missing)');
  if (eocd + 22 > zip.length) throw new Error('VSIX contains a truncated ZIP directory');
  const disk = zip.readUInt16LE(eocd + 4);
  const directoryDisk = zip.readUInt16LE(eocd + 6);
  const diskEntries = zip.readUInt16LE(eocd + 8);
  const entries = zip.readUInt16LE(eocd + 10);
  const directorySize = zip.readUInt32LE(eocd + 12);
  const directoryOffset = zip.readUInt32LE(eocd + 16);
  if (disk !== 0 || directoryDisk !== 0 || diskEntries !== entries || entries === 0xffff || directoryOffset === 0xffffffff) {
    throw new Error('VSIX uses an unsupported multi-disk or ZIP64 archive');
  }
  if (directoryOffset + directorySize > eocd) throw new Error('VSIX contains an invalid ZIP directory range');
  let offset = zip.readUInt32LE(eocd + 16);
  for (let i = 0; i < entries; i++) {
    if (offset + 46 > eocd) throw new Error('VSIX contains a truncated ZIP directory entry');
    if (zip.readUInt32LE(offset) !== 0x02014b50) throw new Error('VSIX contains an invalid ZIP directory');
    const flags = zip.readUInt16LE(offset + 8);
    const method = zip.readUInt16LE(offset + 10);
    const compressedSize = zip.readUInt32LE(offset + 20);
    const uncompressedSize = zip.readUInt32LE(offset + 24);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const localOffset = zip.readUInt32LE(offset + 42);
    const name = zip.toString('utf8', offset + 46, offset + 46 + nameLength);
    const entryLength = 46 + nameLength + extraLength + commentLength;
    if (offset + entryLength > eocd) throw new Error('VSIX contains a truncated ZIP directory entry');
    if (name === wantedName) {
      if ((flags & 1) !== 0) throw new Error(`Encrypted VSIX entry is unsupported: ${name}`);
      if (localOffset + 30 > directoryOffset) throw new Error(`Invalid ZIP entry: ${name}`);
      if (zip.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`Invalid ZIP entry: ${name}`);
      const localNameLength = zip.readUInt16LE(localOffset + 26);
      const localExtraLength = zip.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + localNameLength + localExtraLength;
      if (start + compressedSize > directoryOffset || compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
        throw new Error(`Invalid ZIP entry size: ${name}`);
      }
      const compressed = zip.subarray(start, start + compressedSize);
      let data;
      if (method === 0) data = compressed;
      else if (method === 8) data = zlib.inflateRawSync(compressed);
      else throw new Error(`Unsupported compression method ${method} in VSIX`);
      if (data.length !== uncompressedSize) throw new Error(`Invalid uncompressed size for VSIX entry: ${name}`);
      return data;
    }
    offset += entryLength;
  }
  throw new Error(`VSIX is missing ${wantedName}`);
}

function listZipEntries(zip) {
  if (!Buffer.isBuffer(zip) || zip.length < 22) throw new Error('VSIX is not a valid ZIP archive');
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('VSIX is not a valid ZIP archive (end record missing)');
  const disk = zip.readUInt16LE(eocd + 4);
  const directoryDisk = zip.readUInt16LE(eocd + 6);
  const diskEntries = zip.readUInt16LE(eocd + 8);
  const count = zip.readUInt16LE(eocd + 10);
  const size = zip.readUInt32LE(eocd + 12);
  const start = zip.readUInt32LE(eocd + 16);
  if (disk !== 0 || directoryDisk !== 0 || diskEntries !== count || count === 0xffff || start === 0xffffffff) {
    throw new Error('VSIX uses an unsupported multi-disk or ZIP64 archive');
  }
  if (start + size > eocd) throw new Error('VSIX contains an invalid ZIP directory range');
  let offset = start;
  const names = [];
  for (let i = 0; i < count; i++) {
    if (offset + 46 > eocd || zip.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error('VSIX contains a truncated or invalid ZIP directory entry');
    }
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const entryLength = 46 + nameLength + extraLength + commentLength;
    if (offset + entryLength > eocd) throw new Error('VSIX contains a truncated ZIP directory entry');
    const name = zip.toString('utf8', offset + 46, offset + 46 + nameLength);
    if (names.includes(name)) throw new Error('VSIX contains duplicate ZIP entries: ' + name);
    names.push(name);
    offset += entryLength;
  }
  if (offset !== start + size) throw new Error('VSIX contains an inconsistent ZIP directory size');
  return names.filter(name => !name.endsWith('/')).sort();
}

function getExtensionPackagePath(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('VSIX extension package.json has no ' + label);
  const relative = value.replace(/\\/g, '/').replace(/^\.\//, '');
  if (!relative || relative.startsWith('/') || relative.split('/').includes('..')) {
    throw new Error('VSIX extension package.json has an unsafe ' + label + ' path');
  }
  return 'extension/' + relative;
}

function inspectVsix(vsixPath) {
  const zip = fs.readFileSync(vsixPath);
  const files = listZipEntries(zip);
  const bundledManifest = JSON.parse(readZipEntry(zip, 'extension/package.json').toString('utf8'));
  const vsixManifest = readZipEntry(zip, 'extension.vsixmanifest').toString('utf8');
  const identityTag = vsixManifest.match(/<Identity\b[^>]*>/i);
  if (!identityTag) throw new Error('VSIX extension.vsixmanifest has no Identity');
  const identityVersion = identityTag[0].match(/\bVersion=["']([^"']+)["']/i)?.[1];
  const identityId = identityTag[0].match(/\bId=["']([^"']+)["']/i)?.[1];
  const identityPublisher = identityTag[0].match(/\bPublisher=["']([^"']+)["']/i)?.[1];
  if (!identityVersion || !identityId || !identityPublisher) {
    throw new Error('VSIX extension.vsixmanifest Identity must include Id, Publisher, and Version');
  }
  if (identityId !== bundledManifest.name || identityPublisher !== bundledManifest.publisher) {
    throw new Error('VSIX identity does not match extension/package.json');
  }

  const views = bundledManifest.contributes?.views?.tasksSidebar;
  const containers = bundledManifest.contributes?.viewsContainers?.activitybar;
  if (!Array.isArray(views) || !views.some(view => view.id === 'tasksSidebar.view' && view.type === 'webview')) {
    throw new Error('VSIX package.json is missing the Tasks Sidebar webview contribution');
  }
  if (!Array.isArray(containers) || !containers.some(container => container.id === 'tasksSidebar')) {
    throw new Error('VSIX package.json is missing the Tasks Activity Bar container');
  }

  const requiredFiles = new Set([
    'extension/package.json',
    'extension.vsixmanifest',
    'extension/out/extension.js',
    'extension/out/runtime.js',
    'extension/resources/tasks.svg',
    'extension/resources/marketplace-icon.png',
    'extension/readme.md',
    'extension/changelog.md',
    getExtensionPackagePath(bundledManifest.main, 'main entry point'),
    getExtensionPackagePath(bundledManifest.icon, 'Marketplace icon'),
  ]);
  for (const container of containers) {
    if (container.icon) requiredFiles.add(getExtensionPackagePath(container.icon, 'Activity Bar icon'));
  }
  if (bundledManifest.dependencies?.['jsonc-parser']) {
    for (const file of ['package.json', 'LICENSE.md', 'lib/umd/main.js',
      ...['edit', 'format', 'parser', 'scanner', 'string-intern'].map(name => 'lib/umd/impl/' + name + '.js')]) {
      requiredFiles.add('extension/node_modules/jsonc-parser/' + file);
    }
  }
  const licenseFile = files.find(name => /^extension\/LICENSE(?:\.txt)?$/i.test(name));
  if (!licenseFile) throw new Error('VSIX is missing its license file');
  requiredFiles.add(licenseFile);
  const fileSet = new Set(files.map(name => name.toLowerCase()));
  const missing = [...requiredFiles].filter(name => !fileSet.has(name.toLowerCase()));
  if (missing.length) throw new Error('VSIX is missing required package files: ' + missing.join(', '));

  const forbiddenPatterns = [
    /^extension\/(?:\.git(?:\/|$)|\.github(?:\/|$)|\.vscode(?:\/|$)|src(?:\/|$)|test(?:\/|$)|scripts(?:\/|$))/i,
    /^extension\/(?:CLOUD_PROJECT_HANDOFF\.md|RELEASING\.md|tsconfig\.json|package-lock\.json|\.gitignore)$/i,
    /(?:^|\/)\.env(?:\.[^/]*)?$/i,
    /(?:^|\/)\.npmrc$/i,
    /(?:^|\/)\.pypirc$/i,
    /(?:^|\/)id_(?:rsa|ed25519)(?:\.pub)?$/i,
    /\.(?:pem|key|p12|pfx)$/i,
    /(?:^|\/)[^/]*(?:credential|secret)[^/]*$/i,
    /\.(?:tsbuildinfo|map|log|vsix)$/i,
  ];
  forbiddenPatterns.push(/^extension\/node_modules\/(?!jsonc-parser\/(?:package\.json$|LICENSE\.md$|lib\/umd\/(?:impl\/)?[^/]+\.js$))/i);
  const forbidden = files.filter(name => forbiddenPatterns.some(pattern => pattern.test(name)));
  if (forbidden.length) throw new Error('VSIX contains forbidden development, local, or credential files: ' + forbidden.join(', '));

  return {
    extensionId: identityPublisher + '.' + identityId,
    version: bundledManifest.version,
    identityVersion,
    entryCount: files.length,
    requiredFiles: [...requiredFiles].sort(),
    files,
  };
}

function verifyVsix(vsixPath, expectedVersion) {
  const inspection = inspectVsix(vsixPath);
  if (inspection.version !== expectedVersion || inspection.identityVersion !== expectedVersion) {
    throw new Error('VSIX version mismatch: package.json=' + inspection.version +
      ', VSIX Identity=' + inspection.identityVersion + ', expected=' + expectedVersion);
  }
  return inspection;
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

module.exports = { bump, bumpVersion, inspectVsix, readManifests, verify, verifyVsix };
