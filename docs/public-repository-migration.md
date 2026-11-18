# Decision: private development repository + fresh public release repository

**Approved model (18 November 2026):** keep `ClemensSchmitt/tasks-sidebar`
private. The public-facing source, documentation, bug reports and future
Marketplace release references will belong to a **separate repository**:

`https://github.com/ClemensSchmitt/tasks-sidebar-vscode`

The public repository must be **created empty and initialized with one new root
commit** from a reviewed source snapshot. It must NOT be created through GitHub
forking, mirroring, copying `.git`, pushing an existing branch, cherry-picking
old commits, transferring old issues, or migrating historic GitHub Releases.
That is how we avoid exposing private development history, including material
in commits that was later deleted.

## Repository roles

| Location | Visibility / role |
| --- | --- |
| `ClemensSchmitt/tasks-sidebar` | **Private**, authoritative engineering workspace; preserve its history, PRs, issues and releases. Never change its visibility as part of publication. |
| `ClemensSchmitt/tasks-sidebar-vscode` | **Public after explicitly created**, clean source snapshot, MIT/license, README/handbook, public support issues and future release artifacts. Entirely separate history. |
| VS Code Marketplace | After release approval, point `ClemboMembo.tasks-sidebar` metadata and OIDC Trusted Publishing at the **new public repository**, not the old private repository. |

The name `tasks-sidebar-vscode` is the implemented canonical target for
the export manifest/documentation; it must be available before creation.

## What is prepared in PR #102

1. `scripts/export-public-snapshot.js` reads only tracked, **explicitly
   allowlisted** source, tests, manuals, licenses, package metadata and icons
   from its checked-out working tree. It refuses suspicious paths, binary content
   in text files, personal-user-home paths and common credential markers.
2. Private Git URLs in `package.json`, `README.md`, `SUPPORT.md` and
   applicable public text are rewritten to the future public destination.
   Support instructions no longer direct external users to a private issue
   tracker. The installation page does not falsely claim an already released
   public VSIX.
3. The snapshot intentionally omits `.git`, GitHub Actions workflows,
   handoff/audit notes, internal release procedures, private issues/PRs and
   their attachments, historical tags/commits, and old release artifacts.
   The public repository starts with **no CI, build or publish triggers**.
4. The no-build GitHub workflow
   `.github/workflows/public-source-snapshot.yml` verifies the staging
   files and uploads a short-lived, **private** source-only ZIP.
   Reproduction without builds:
   `node scripts/export-public-snapshot.js --dest /absolute/empty/directory`.

**Scope and caveat:** This is a deliberately limited public source export.
The previous closed-source development history remains private; the public
repository will not duplicate internal project management or release logs.
Any subsequently imported changes must also pass a fresh snapshot review.

## Final setup — authorized owner of the GitHub account

The currently connected GitHub integration supports reading/writing files,
branches and PRs in existing repositories, but **not creating a new repository**
under the account. This administrative step must be performed by someone with
appropriate GitHub repository creation permissions. Do not interpret PR #102
or the ZIP artifact as an already-created public repository.

After confirming rights to publish and an independent review of the *exported
snapshot*, create the new **empty** GitHub repository, with no GitHub-generated
README, .gitignore or LICENSE:

```sh
gh repo create ClemensSchmitt/tasks-sidebar-vscode --public \
  --description "A visual task board for VS Code workspace tasks" \
  --disable-wiki
```

Download/extract the exported source snapshot to a **new** folder that does
not contain a `.git` directory, and make the **first-ever** commit there:

```sh
cd /path/to/extracted-public-source-snapshot
git init -b main
git add -A
git commit -m "Initial public source snapshot"
git remote add origin https://github.com/ClemensSchmitt/tasks-sidebar-vscode.git
git push -u origin main
```

Never run those commands from the old private clone; never use
`git push --mirror`, `git push --all`, `git push --tags`, `git bundle`,
`git filter-repo` or an existing development-history commit as the root
of the public repo.

For future releases, use new snapshot commits on the new public repository
instead of reusing old branch/tags/history. Keep the extension's
`publisher: ClemboMembo` and `name: tasks-sidebar` stable in the manifest.
GitHub source history and Marketplace publisher identity are separate.

## Mandatory verification before publication or Marketplace release

- [x] Decision recorded: development stays private; public history will be separate.
- [x] Build-free source snapshot exporter and ZIP workflow added to draft PR #102.
- [x] Public manifest, README, support links and generated security note prepared.
- [ ] Verify source ZIP (exact files/content and icon ownership), independent security/legal review.
- [ ] Owner creates the empty public repository, as above.
- [ ] Push **only** the reviewed ZIP contents as a fresh root commit; confirm
      `git rev-list --all --count` is 1 at the beginning and no old tags or
      old commits/refs exist.
- [ ] Confirm repository visibility is public and that README, SUPPORT.md,
      GitHub issue creation and the URL in the package manifest work for
      users **without authentication**.
- [ ] Set up private vulnerability reporting/contact and repository security
      controls as appropriate; do not request credentials through public Issues.
- [ ] Verify actual public release candidate and library notices. Future CI
      or Marketplace publishing must be deliberately enabled in the **public**
      repository only, after separate approval.
- [ ] Document GO with scope and independent/human sign-off in #101; then
      unblock step 1 of #24.

**No-build condition:** Preparing the snapshot and its initial empty public
repository does not require VSIX builds or a release. No GitHub or Marketplace
publication is automatically initiated by PR #102.
