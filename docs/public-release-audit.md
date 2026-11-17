# Public-release security and rights audit (Issue #101)

**Status: NO-GO as of 2026-11-17.** The repository is private. This document is
a reproducible technical checklist, **not a declaration that publication is safe**.
The authoritative issue is [#101](https://github.com/ClemensSchmitt/tasks-sidebar/issues/101);
the public-marketplace rollout is blocked by [#24](https://github.com/ClemensSchmitt/tasks-sidebar/issues/24).

## Current evidence

- Baseline reviewed: `main` at `5bcfe126a149bc875dff8f60bd5b987e9846de7e`.
- A limited manual-pattern check covered 60 UTF-8 files in the baseline source
  tree, including scripts, implementation, examples, workflow YAML and manuals;
  no high-confidence key signatures were detected in those **current files**.
  This is **not** a substitute for full-history scanning.
- Inventory: 52 pre-existing branch heads, six release tags from `v0.0.5`
  through `v0.1.0`, six GitHub Releases with VSIX assets.
- `CLOUD_PROJECT_HANDOFF.md` contained a machine-specific user-home path and
  internal handoff text. The current-tree copy is removed in PR #102. The file
  remains part of reachable Git history and older branches/tags; deletion from
  `main` or a new `.gitignore` **does not remove the historical content**.
- The 101 available issue/PR issue-text records, 44 PR descriptions, 38 issue
  comments and 14 inline PR comments were checked for a few text signatures.
  At least issues #69, #70, #71, #95 and #100 reference attachments **not
  inspected** as binary data. Review submissions and all historic logs were
  not exhaustively inspected.
- `package.json` and `LICENSE` specify MIT. The lockfile lists
  `jsonc-parser@3.3.1` (MIT) as the only production dependency; the package
  verifier expects its `LICENSE.md` in the VSIX. Development-only packages
  show MIT, ISC, Apache-2.0 and compound SPDX expressions in the lockfile.
  Package metadata does **not** prove ownership of first-party code, manuals
  or graphics.
- Existing `.vscodeignore` and `scripts/release.js` enforce expected
  package paths and exclusions on newly verified VSIX files, but the **actual**
  ZIP contents of existing releases have not been retrieved and inspected.
- Both the Marketplace manifest's issue URL and the support instructions
  currently point to this private repository, so they are not usable by
  ordinary Marketplace customers.

## Read-only local inspection, without a build

From an authorized full clone, with all branches and tags available:

```sh
git fetch --all --tags --prune
# Install an approved copy of gitleaks separately; do not store reports in Git.
npm run audit:public
```

The `audit:public` script requires `gitleaks` in PATH; it must return
**NOT_CHECKED**, not success, when the scanner is missing. It inspects all
locally reachable Git blobs (`git rev-list --objects --all`) for high-risk
text/file patterns. It runs Gitleaks with `--log-opts=--all` and `--redact`,
writes its temporary report outside the repository, and deletes the report
afterward. Results report rule names and Git object hashes, never extracted
credentials.

To audit **existing** (already built) VSIX artifacts without building new ones,
download the GitHub Release assets to a private local directory and pass each
artifact to the same command. For example:

```sh
gh release download v0.1.0 --repo ClemensSchmitt/tasks-sidebar \
  --pattern '*.vsix' --dir /path/to/audit-assets
npm run audit:public -- --vsix /path/to/audit-assets/tasks-sidebar-0.1.0.vsix
```

For release-wide coverage repeat this for **all six existing VSIX assets**
(`v0.0.5` through `v0.1.0`) and supply each using an additional
`--vsix` flag. The script uses the existing static VSIX inspector and checks
package entries, SHA-256, patterns in text files and PNG metadata chunks.
**No package/build/release commands are invoked.** Older artifacts can fail
modern structure checks; these are findings requiring manual review, not proof
of secrets.

A completed technical scan only means **technical checks passed**. It is **not**
a legal/privacy approval, and must not be interpreted as permission to publish.

## Remaining release blockers and how to resolve them

| Priority | Item | Owner / completion evidence |
| --- | --- | --- |
| **Blocker for public repository** | Analyze sensitive historical handoff blob and all old branches/tags with complete authorized Gitleaks + file review; decide whether history rewrite is needed. | Maintainer/security reviewer: scanner output summarized **without secrets**, documented disposition. Any history rewrite, tag move, release deletion or force-push requires **separate explicit authorization** and impact analysis. |
| **Blocker** | Inspect the actual six historical VSIX ZIPs and metadata of icon/attachments, including issues #69, #70, #71, #95, #100. | Technical reviewer: artifact hashes, archive lists, findings; redact before commenting. |
| **Blocker** | Decide the distribution model. **A:** after safe history/legal audit, make the repository public and verify all referenced links. **B:** keep the repository private and provide independently public, working docs and bug-report intake; replace private `homepage`, `bugs.url` and relevant README/SUPPORT links with verified public URLs. | Owner: explicit A/B decision and live verification of links from an unauthenticated browser session. |
| **Blocker** | Establish rights to all code/documentation and SVG/PNG assets. The PNG was introduced as an icon based on the existing task-list visual in PR #29, which does **not** independently prove rights. | Owner/authorized employer or rights holder: positive permission/ownership decision recorded. |
| **Blocker** | Check GitHub Secret Scanning/Push Protection and alerts, PR review submissions, historic logs, issues/PRs and binary screenshots for sensitive data. | Repo administrator/security reviewer: evidence for each checked surface; treat missing access as **NOT CHECKED**. |
| **Blocker** | Independent adversarial review of audit evidence, residual risks and chosen publication route. | Independent reviewer and human approver: identity/date/scope/GO in #101; only then unblock #24 step 1. |
| Before release | Confirm VSIX carries the third-party MIT license and required project documentation. | Reviewer: file listing and hash of the **exact** candidate, not a theoretical ignore-list result. |
| After publication | Keep support links and documentation accessible; periodically rerun scans for releases. | Maintainer after an initial authorized GO. |

**Do not place secrets, sensitive image contents, private file paths or raw
scanner reports into GitHub Issues, PR comments or logs.** Revoke/rotate actual
credentials first if exposed. Removing a tracked file does not remove a secret
from the repository history.

### Technical audit boundaries

`audit:public` does not contact GitHub or download assets. It cannot inspect
unfetched refs or third-party/remote artifacts, and it cannot guarantee
detection of arbitrary credentials or rights violations. Invalid UTF-8/binary
Git blobs are counted but not content-scanned; oversized blobs are flagged as
unchecked. Public and private distribution models have different disclosure
surfaces and both require an explicit final sign-off.
