'use strict';

// Read-only, fail-closed public-release inspection. No build, network call,
// git mutation, artifact generation or publishing is performed.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');
const { TextDecoder } = require('node:util');
const { inspectVsix, listZipEntries, readZipEntry } = require('./release');

const ROOT = path.resolve(__dirname, '..');
const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const decoder = new TextDecoder('utf-8', { fatal: true });
const patterns = [
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/i],
  ['github-token', /\b(?:github_pat_[A-Za-z0-9_]{15,}|gh[pousr]_[A-Za-z0-9_]{20,})\b/],
  ['cloud-access-key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['api-token', /\b(?:sk-[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/],
  ['secret-assignment', /\b(?:password|passwd|client[_-]?secret|api[_-]?key|access[_-]?token)\s*[:=]\s*["'\x60]?[A-Za-z0-9_+./=-]{12,}/i],
  ['personal-home-path', /(?:[A-Z]:\\Users\\[^\\\s"'\x60]+\\|\/(?:home|Users)\/[^/\s"'\x60]+\/)/i],
  ['private-endpoint', /\b(?:intranet|internal|private)\.[a-z0-9.-]+\.(?:local|lan|corp)\b/i],
];
const suspiciousPath = /(^|\/)(?:CLOUD_PROJECT_HANDOFF\.md|\.env(?:\.[^/]*)?|\.npmrc|\.pypirc|id_(?:rsa|ed25519)(?:\.pub)?|[^/]*\.(?:pem|key|p12|pfx))$/i;
const textFile = /(?:\.(?:json|jsonc|md|txt|js|cjs|mjs|ts|tsx|html?|xml|svg|yml|yaml|sh|ps1|css)|(?:^|\/)LICENSE)$/i;

function git(args, options = {}) {
  return execFileSync('git', args, {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function findingsIn(source, text, output) {
  for (const [rule, expression] of patterns) {
    if (expression.test(text)) output.push({ source, rule });
  }
}

function inspectHistory() {
  const entries = git(['rev-list', '--objects', '--all']).trim().split(/\r?\n/).filter(Boolean);
  const objects = new Map(entries.map(line => {
    const [sha, ...parts] = line.split(' ');
    return [sha, parts.join(' ') || '(historical object)'];
  }));
  const checked = git(['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'], {
    input: [...objects.keys()].join('\n') + '\n',
  });
  const findings = [];
  let scanned = 0;
  let skippedBinary = 0;
  let pngBlobsInspected = 0;
  let oversized = 0;
  for (const line of checked.trim().split(/\r?\n/)) {
    const match = /^([0-9a-f]{40,64}) blob (\d+)$/.exec(line);
    if (!match) continue;
    const [unused, sha, bytesText] = match;
    const name = objects.get(sha) || '(unnamed blob)';
    if (suspiciousPath.test(name)) findings.push({ source: name, sha, rule: 'sensitive-path-in-reachable-history' });
    const size = Number(bytesText);
    if (size > MAX_TEXT_BYTES) { oversized++; findings.push({ source: name, sha, rule: 'oversized-blob-not-content-scanned' }); continue; }
    const buffer = execFileSync('git', ['cat-file', 'blob', sha], {
      cwd: ROOT, encoding: null, maxBuffer: MAX_TEXT_BYTES + 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let text;
    try { text = decoder.decode(buffer); }
    catch {
      if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
        pngBlobsInspected++;
        for (const rule of pngMetadata(buffer)) findings.push({ source: name, sha, rule: 'png-metadata-' + rule });
        continue;
      }
      skippedBinary++;
      continue;
    }
    if (text.includes('\0')) { skippedBinary++; continue; }
    scanned++;
    const matches = [];
    findingsIn(name, text, matches);
    for (const item of matches) findings.push({ ...item, sha });
  }
  return { totalObjects: objects.size, textBlobsScanned: scanned, pngBlobsInspected, binaryBlobsSkipped: skippedBinary,
    oversizedBlobs: oversized, findings };
}

function scanWithGitleaks() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tasks-sidebar-gitleaks-'));
  const reportPath = path.join(tempDir, 'findings.json');
  try {
    const result = spawnSync('gitleaks', [
      'git', '--no-banner', '--log-opts=--all', '--redact',
      '--report-format=json', '--report-path', reportPath,
    ], { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, windowsHide: true });
    if (result.error) return { status: 'NOT_CHECKED', reason: 'gitleaks executable unavailable' };
    if (![0, 1].includes(result.status)) {
      return { status: 'NOT_CHECKED', reason: 'gitleaks could not complete (exit ' + result.status + ')' };
    }
    if (!fs.existsSync(reportPath)) {
      return { status: 'NOT_CHECKED', reason: 'gitleaks did not produce a JSON report' };
    }
    const matches = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    if (!Array.isArray(matches) || (result.status === 1 && matches.length === 0)) {
      return { status: 'NOT_CHECKED', reason: 'gitleaks report and exit status were inconsistent' };
    }
    return { status: matches.length ? 'FINDINGS' : 'OK', findingCount: matches.length,
      // Do not reproduce scanner secrets or matched code in terminal output.
      rules: [...new Set(matches.map(item => item.RuleID).filter(Boolean))].sort() };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function pngMetadata(buffer) {
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
    return ['not-a-png'];
  }
  const found = [];
  let offset = 8;
  while (offset + 12 <= buffer.length) {
    const len = buffer.readUInt32BE(offset);
    if (len > buffer.length - offset - 12) { found.push('invalid-chunk-length'); break; }
    const chunk = buffer.toString('ascii', offset + 4, offset + 8);
    if (['tEXt', 'iTXt', 'zTXt', 'eXIf'].includes(chunk)) found.push(chunk);
    offset += 12 + len;
    if (chunk === 'IEND') break;
  }
  return found;
}

function inspectArtifact(file) {
  const zip = fs.readFileSync(file);
  const summary = { artifact: path.basename(file),
    sha256: crypto.createHash('sha256').update(zip).digest('hex'),
    result: 'OK', problems: [] };
  try {
    const entries = listZipEntries(zip);
    summary.fileCount = entries.length;
    try {
      const inspected = inspectVsix(file);
      summary.version = inspected.version;
      summary.structure = 'CURRENT';
    } catch {
      // An older release may predate the current required-file contract.
      // Still inspect every archive entry rather than declaring the ZIP uninspected.
      summary.structure = 'LEGACY_REVIEW';
    }
    for (const filename of entries) {
      if (suspiciousPath.test(filename)) summary.problems.push({ source: filename, rule: 'sensitive-path' });
      if (/\.png$/i.test(filename)) {
        for (const chunk of pngMetadata(readZipEntry(zip, filename))) {
          summary.problems.push({ source: filename, rule: 'png-metadata-' + chunk });
        }
      } else if (textFile.test(filename) || filename === 'extension.vsixmanifest') {
        const data = readZipEntry(zip, filename);
        if (data.length > MAX_TEXT_BYTES) {
          summary.problems.push({ source: filename, rule: 'oversized-entry-not-content-scanned' });
          continue;
        }
        try {
          const text = decoder.decode(data);
          if (text.includes('\0')) throw new Error('binary text entry');
          findingsIn(filename, text, summary.problems);
        } catch {
          summary.problems.push({ source: filename, rule: 'unreadable-text-entry' });
        }
      }
    }
    if (summary.problems.length) summary.result = 'FINDINGS';
    else if (summary.structure === 'LEGACY_REVIEW') summary.result = 'LEGACY_REVIEW';
  } catch (error) {
    summary.result = 'NOT_CHECKED';
    // Error descriptions from third-party artifacts can include paths; do not print the raw message.
    summary.reason = 'VSIX structural/package inspection failed';
  }
  return summary;
}

function main(args) {
  const vsixFiles = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== '--vsix' || !args[i + 1]) {
      throw new Error('Usage: node scripts/audit-public-release.js [--vsix path] ...');
    }
    vsixFiles.push(path.resolve(args[++i]));
  }

  const findings = inspectHistory();
  const gitleaks = scanWithGitleaks();
  const png = fs.existsSync(path.join(ROOT, 'resources', 'marketplace-icon.png'))
    ? pngMetadata(fs.readFileSync(path.join(ROOT, 'resources', 'marketplace-icon.png'))) : ['missing-icon'];
  const artifacts = vsixFiles.map(inspectArtifact);
  const status = findings.findings.length || findings.binaryBlobsSkipped > 0 || gitleaks.status !== 'OK' || png.length
    || artifacts.length === 0 || artifacts.some(a => a.result !== 'OK') ? 'NO-GO' : 'TECHNICAL_CHECKS_PASSED';
  const report = { status, checkedGitRefs: 'all locally fetched refs (--all)',
    history: findings, secretScanner: gitleaks,
    marketplaceIconMetadata: png.map(type => ({ type })),
    note: 'Git PNG blobs receive metadata-only inspection. All skipped unknown binaries and legacy package structure still require independent review.',
    artifacts: artifacts.length ? artifacts : [{ result: 'NOT_CHECKED', reason: 'No existing VSIX supplied' }],
    limitations: [
      'This check cannot grant copyright, employer or privacy approval.',
      'All remote branches and tags must be fetched before running this audit.',
      'GitHub issues, PRs, attachments, release logs and GitHub security alerts require separate review.',
      'Prior releases must be supplied as --vsix files to inspect their actual contents.',
      'No local scanner result alone authorizes a public repository or Marketplace release.',
    ] };
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  if (status !== 'TECHNICAL_CHECKS_PASSED') process.exitCode = 1;
}

try { main(process.argv.slice(2)); }
catch (error) {
  // Avoid accidentally printing sensitive context from scanner or blob errors.
  process.stderr.write('Publication audit aborted: unable to complete a required check.\n');
  process.exitCode = 1;
}
