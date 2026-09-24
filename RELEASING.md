# Creating a release

The extension uses stable `X.Y.Z` versions. The default version increment is
patch; pass `--type minor` or `--type major` to choose a different increment.
The GitHub Actions `Release` workflow publishes an already-created version
tag. It checks that the requested `vX.Y.Z` tag and generated VSIX match the
versions in both `package.json` and `package-lock.json` before it creates the
GitHub Release. It must stop if that tag or a release for that tag already
exists.

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
create and push its matching `vX.Y.Z` tag. Run the `Release` workflow for that
tag to package the VSIX, verify tag/manifest/VSIX consistency, create the
release, and upload `tasks-sidebar-X.Y.Z.vsix`. For a local verification of a
packaged artifact:

```sh
npm run release:version -- verify --tag v0.0.6 --vsix ./tasks-sidebar-0.0.6.vsix
```

Use the version calculated from the current `package.json`; `0.0.6` is only an
example. Do not reuse or force-update a published tag.
