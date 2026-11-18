#!/usr/bin/env node
'use strict';
// Export a whitelisted working-tree snapshot. NEVER copy Git history.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const root = path.resolve(__dirname, '..');
const publicRepo = 'ClemensSchmitt/tasks-sidebar-vscode';
const fromUrl = 'https://github.com/ClemensSchmitt/tasks-sidebar';
const toUrl = 'https://github.com/' + publicRepo;
const explicit = new Set([
  '.gitignore', '.vscodeignore', 'README.md', 'SUPPORT.md', 'CHANGELOG.md',
  'LICENSE', 'package.json', 'package-lock.json', 'tsconfig.json',
  'resources/marketplace-icon.png', 'resources/tasks.svg',
  'scripts/release.js', 'scripts/test-installed-vsix.js'
]);
const allow = p => explicit.has(p) || /^src\/[\w/-]+\.ts$/.test(p) ||
  (/^docs\/manual\/[\w.-]+\.md$/.test(p) && p !== 'docs/manual/coverage-matrix.md') ||
  (/^test\/[\w./-]+$/.test(p) && /\.(?:js|json|md|code-workspace)$/.test(p));
const checks = [
  ['local user path', /(?:[A-Z]:\\Users\\[^\\\s"']+\\|\/(?:home|Users)\/[^/\s"']+\/)/i],
  ['specific internal company', /Vanderlande|Casaventa|Toyota Automated Logistics/i],
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/i],
  ['high-risk token', /\b(?:github_pat_[a-z0-9_]{15,}|gh[pousr]_[a-z0-9_]{20,}|AKIA[A-Z0-9]{16})\b/i],
  ['historical issue or commit link', /https:\/\/github\.com\/ClemensSchmitt\/tasks-sidebar\/(?:issues\/\d+|pull\/\d+|commit\/|tree\/[a-f0-9]{40})/i]
];
function assert(ok, why) { if (!ok) throw Error(why); }
function transform(name, text) {
  if (name === 'package.json') {
    const json = JSON.parse(text);
    assert(json.name === 'tasks-sidebar', 'Invalid extension identity');
    json.repository = {type:'git', url:toUrl + '.git'};
    json.homepage = toUrl + '#readme';
    json.bugs = {url:toUrl + '/issues'};
    delete json.scripts['audit:public'];
    return JSON.stringify(json, null, 2) + '\n';
  }
  if (name === 'README.md') {
    const oldInstall = text.split('\n').find(x => x.includes('Download the [latest published Tasks Sidebar VSIX'));
    assert(oldInstall, 'Installation paragraph changed');
    text = text.replace(oldInstall,
      'A public VSIX is not yet available. When approved, download it from ' +
      '[GitHub Releases](' + toUrl + '/releases) and use the VS Code command ' +
      'Extensions: Install from VSIX.');
    const oldSupport = text.split('\n').find(x => x.includes('is currently available only to repository users'));
    assert(oldSupport, 'Support paragraph changed');
    text = text.replace(oldSupport,
      'Report issues on the public [GitHub issue tracker](' + toUrl + '/issues). ' +
      'Never post secrets, confidential logs, or security exploit details.');
    text = text.replaceAll('CI runs source-based', 'The development process runs source-based');
    text = text.replaceAll('The CI Linux jobs run', 'The development Linux tests run');
    text = text.replaceAll('CI runs it on', 'The development test matrix runs it on');
    text = text.replaceAll('CI records the actual', 'The development test process records the actual');
  }
  if (name === 'SUPPORT.md') {
    const oldSupport = text.split('\n').find(x => x.startsWith('The GitHub repository and issue tracker are private'));
    assert(oldSupport, 'Support text changed');
    text = text.replace(oldSupport,
      'The public [GitHub issue tracker](' + toUrl + '/issues) accepts general bug reports. ' +
      'A Marketplace listing is not yet available.');
    text = text.replace(
      'No private security contact is published, so do not include sensitive information in an issue.',
      'Do not post sensitive findings publicly. GitHub private vulnerability reporting requires separate activation.');
  }
  return text.split(fromUrl).join(toUrl);
}
function exportSnapshot(dest) {
  assert(path.isAbsolute(dest), '--dest must be an absolute path');
  dest = path.resolve(dest);
  assert(dest !== root && !dest.startsWith(root + path.sep), 'Destination inside source tree');
  assert(!fs.existsSync(dest) || fs.readdirSync(dest).length === 0, 'Destination not empty');
  const paths = cp.execFileSync('git', ['ls-files','-z'], {cwd:root,encoding:'utf8'})
    .split('\0').filter(Boolean).filter(allow);
  for (const p of ['README.md','SUPPORT.md','LICENSE','package.json',
    'package-lock.json','src/extension.ts','src/runtime.ts',
    'resources/marketplace-icon.png','resources/tasks.svg']) {
    assert(paths.includes(p), 'Required source missing: ' + p);
  }
  const copies = [];
  for (const name of paths) {
    assert(!name.includes('..') && !name.includes('\\') && !name.startsWith('/'), 'Unsafe path: ' + name);
    const sourcePath = path.join(root,name);
    const stat = fs.lstatSync(sourcePath);
    assert(stat.isFile() && stat.size < 5e6, 'Unsafe file: ' + name);
    const bytes = fs.readFileSync(sourcePath);
    if (name === 'resources/marketplace-icon.png') {
      assert(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])), 'Invalid PNG');
      copies.push([name,bytes]);
      continue;
    }
    const original = bytes.toString('utf8');
    assert(Buffer.from(original,'utf8').equals(bytes) && !original.includes('\0'), 'Invalid text: ' + name);
    for (const [label,re] of checks.slice(0,-1)) {
      assert(!re.test(original), name + ': ' + label);
    }
    const content = transform(name, original);
    for (const [label,re] of checks) assert(!re.test(content), name + ': ' + label);
    assert(!content.includes(fromUrl), 'Old private link remains in ' + name);
    copies.push([name,Buffer.from(content,'utf8')]);
  }
  fs.mkdirSync(dest,{recursive:true});
  for (const [name,bytes] of copies) {
    const output = path.join(dest,name);
    fs.mkdirSync(path.dirname(output),{recursive:true});
    fs.writeFileSync(output,bytes,{flag:'wx'});
  }
  fs.writeFileSync(path.join(dest,'SECURITY.md'),
    '# Security\n\nDo not share credentials or exploit details in public issues. ' +
    'Private vulnerability reporting must be enabled by the repository owner.\n');
  fs.writeFileSync(path.join(dest,'PUBLICATION.md'),
    '# Public source snapshot\n\nThis repository begins with an independent ' +
    'Git history and a source-only snapshot, not a fork or historical mirror. ' +
    'No old commits, branches, issues, screenshots or release assets were copied.\n\n' +
    'A public VSIX, Marketplace listing, rights approval and independent review ' +
    'are separate release prerequisites.\n');
  console.log('Prepared ' + (copies.length+2) + ' files for ' + toUrl);
  console.log('No .git, old history, CI workflow, build, release or publishing.');
}
try {
  const args = process.argv.slice(2);
  assert(args.length === 2 && args[0] === '--dest',
    'Usage: node scripts/export-public-snapshot.js --dest /absolute/empty/dir');
  exportSnapshot(args[1]);
} catch (error) {
  console.error('Public snapshot rejected: ' + error.message);
  process.exitCode = 1;
}
