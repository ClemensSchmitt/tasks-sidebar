# Creating a release

The extension uses stable `X.Y.Z` versions. The default version increment is
patch; pass `--type minor` or `--type major` to choose a different increment.
The GitHub Actions `Release` workflow publishes an already-created version
tag. It checks that the requested `vX.Y.Z` tag and generated VSIX match the
versions in both `package.json` and `package-lock.json` before it creates the
GitHub Release. The workflow only publishes an already-pushed tag and never
creates or moves tags. A tag must not be force-updated or reused. If a GitHub
Release already exists for that tag, publishing stops without replacing it.

To preview the next patch version locally without changing files:

```sh
npm run release:version -- bump --dry-run
```

To update both version manifests for a patch release:

```sh
npm run release:version -- bump
```

For a different increment, pass `--type minor` or `--type major`. Check that
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
npm run release:version -- verify --tag v0.0.6 --vsix ./tasks-sidebar-0.0.6.vsix
```

Use the version calculated from the current `package.json`; `0.0.6` is only an
example. Do not reuse or force-update a published tag.

## CI and release gates

Pull requests and pushes to `main` run the validation matrix in `.github/workflows/ci.yml`. To enforce checks before merging, configure these six job names as required status checks:

- `CI / ubuntu-latest · VS Code 1.85.0`
- `CI / ubuntu-latest · VS Code stable`
- `CI / macos-latest · VS Code 1.85.0`
- `CI / macos-latest · VS Code stable`
- `CI / windows-latest · VS Code 1.85.0`
- `CI / windows-latest · VS Code stable`

The repository currently reports `main` as unprotected, so GitHub does not enforce these checks for merges. Once the workflow is merged, configure the six required checks in the `main` branch protection rules.

A push of a `vX.Y.Z` tag starts the `Release` workflow and runs all six release validation jobs, then packages and verifies one VSIX. It does not publish a GitHub Release. For a safe dry run, dispatch the `Release` workflow with that tag and leave `publish_release` false. To publish, dispatch it again for the same tag with `publish_release` set to true.

The publishing job runs only after every validation job and VSIX verification succeed. It uses the artifact built by that same workflow run, checks that the tag still points to the tested commit, rejects an existing GitHub Release, and has the only `contents: write` permission. Its gate consists of the six `Release validation / <runner> · VS Code <version>` checks and `Package and verify VSIX`. The workflow never creates or moves tags.
