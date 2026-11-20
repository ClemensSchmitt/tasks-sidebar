# Creating a release

The extension uses stable `X.Y.Z` versions. The default version increment is
patch; pass `--type minor` or `--type major` to choose a different increment.
The GitHub Actions `Release` workflow validates and packages an already-created
version tag. Publishing requires an explicit workflow dispatch. It checks that the requested `vX.Y.Z` tag and generated VSIX match the
versions in both `package.json` and `package-lock.json` before it creates the
GitHub Release. The workflow only publishes an already-pushed tag and never
creates or moves tags. A tag must not be force-updated or reused. If a GitHub
Release already exists for that tag, publishing stops without replacing it.

To preview the next patch version locally without changing files:

```sh
node scripts/release.js bump --dry-run
```

To update both version manifests for a patch release:

```sh
npm run release:version -- bump
```

For a different increment, run `node scripts/release.js bump --type minor`
or replace `minor` with `major`. Check that
both files are clean and run the normal test suite before committing. The
version command refuses to continue if the manifests disagree. It changes
only the version fields and does not publish, create a tag, or create a
release.

After the version bump, run tests, commit and push the version change, then
create and push its matching `vX.Y.Z` tag. If the tag already exists, stop;
do not force-update it. The tag push runs validation and packaging without
publishing. To publish, dispatch the `Release` workflow for that same tag and
set `publish_release` to true. Leave it false for a validation/package dry run.
The workflow rejects an existing release and never overwrites one. For a local
verification of a packaged artifact:

```sh
node scripts/release.js verify --tag v0.0.6 --vsix ./tasks-sidebar-0.0.6.vsix
```

Use the version calculated from the current `package.json`; `0.0.6` is only an
example. Do not reuse or force-update a published tag.

## Installed VSIX verification

For a local release-candidate check, run:

```sh
npm run package
npm run test:vsix
```

The package audit checks the VSIX version and identity, manifest entry point, compiled runtime files, extension icons, Activity Bar view contribution, and required documentation. It rejects source, test fixtures, development scripts, repository metadata, local settings, credential files, source maps, and lockfiles. The test then installs that exact VSIX using the VS Code CLI in newly created extension and user-data directories. A separate Extension Host test confirms the installed extension identity and version, opens the contributed Tasks Activity Bar view, waits for activation, and runs the refresh command.

The CI and release matrices run this probe on VS Code 1.85.0 and the then-current stable version on Ubuntu, macOS, and Windows. Type checking, compilation and packaging happen once on Linux. Every matrix job downloads the same compiled extension and exact VSIX from its own workflow run, then runs runtime tests, development Extension Host tests and the installed-package probe on its target OS/version. This extension contains platform-neutral JavaScript and no native runtime dependencies. Each successful matrix job uploads `vsix-install-probe.json`, which records the actual VS Code version, OS/architecture, VSIX filename and version, package file list, isolated-install check, view command, and activation result. This is an automated Extension Host/API probe; it does not claim a manual visual or assistive-technology review.

New commits cancel superseded CI runs on the same PR or branch. Draft PRs skip validation. Jobs have fixed timeouts; shared candidates expire after one day and installation reports after three days. Release runs for the same version are serialized without cancelling validation/publication.

## CI and release gates

Pull requests ready for review and pushes to `main` run the validation matrix in `.github/workflows/ci.yml`. Require the aggregate `CI checks` status to cover both the shared build and all six compatibility jobs. The existing matrix job names are retained:

- `CI / ubuntu-latest · VS Code 1.85.0`
- `CI / ubuntu-latest · VS Code stable`
- `CI / macos-latest · VS Code 1.85.0`
- `CI / macos-latest · VS Code stable`
- `CI / windows-latest · VS Code 1.85.0`
- `CI / windows-latest · VS Code stable`

The repository currently reports `main` as unprotected, so GitHub does not enforce these checks for merges. Once the workflow is merged, configure `CI checks` in the `main` branch protection rules.

A push of a `vX.Y.Z` tag starts the `Release` workflow, packages and verifies one VSIX, then runs all six release validation jobs against that exact candidate. It does not publish a GitHub Release. For a safe dry run, dispatch the `Release` workflow with that tag and leave `publish_release` false. To publish, dispatch it again for the same tag with `publish_release` set to true.

The publishing job runs only after every validation job and VSIX verification succeed. It uses the artifact built by that same workflow run, checks that the tag still points to the tested commit, rejects an existing GitHub Release, and has the only `contents: write` permission. Its gate consists of the six `Release validation / <runner> · VS Code <version>` checks and `Package and verify VSIX`. The workflow never creates or moves tags.

## Publish the verified VSIX to the Marketplace

Configure Trusted Publishing under the ClemboMembo publisher for
`ClemensSchmitt/tasks-sidebar` and `marketplace.yml`. Leave the environment
field empty. After testing the GitHub Release VSIX in VS Code Stable, record
its SHA-256. Run **Publish to VS Code Marketplace** from `main` with the
release tag and that checksum. The workflow downloads the existing release
asset and publishes it only if its checksum matches.
