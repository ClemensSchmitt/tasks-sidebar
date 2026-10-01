# Compatibility, local/remote hosts, reload and reconnect

This chapter separates **support level** from **validation status**. A documented code path is not the same as a manually certified remote environment.

## Minimum VS Code version

Tasks Sidebar requires **Visual Studio Code 1.85.0 or newer**.

Two layers enforce this:

1. `package.json` declares `engines.vscode: ^1.85.0`;
2. activation compares the running VS Code version with `1.85.0`.

If the runtime version is older or cannot be parsed as a supported semantic version, activation reports an actionable error and stops.

## Workspace extension-host model

The package declares:

```json
{
  "extensionKind": ["workspace"]
}
```

Tasks Sidebar is intended to run with the workspace extension host.

The board header reports:

- `Local extension host` when `vscode.env.remoteName` is absent;
- `Remote · <name>` when VS Code reports a remote name.

That host label is also used in many file/provider error messages.

## Support and validation table

| Host class | Support level | Current validation |
| --- | --- | --- |
| Local Windows | Supported | Automated source Extension Host + packaged VSIX probe on VS Code 1.85.0 and Stable |
| Local macOS | Supported | Automated source Extension Host + packaged VSIX probe on VS Code 1.85.0 and Stable |
| Local Linux | Supported | Automated source Extension Host + packaged VSIX probe on VS Code 1.85.0 and Stable |
| WSL | Best effort; not certified | Manual remote smoke: Not run |
| Dev Containers | Best effort; not certified | Manual remote smoke: Not run |
| Remote SSH | Best effort; not certified | Manual remote smoke: Not run |

A local Linux CI job is **not** a WSL, Dev Container or Remote SSH test.

## What CI validates

For pull requests that are not draft and for pushes to `main`, the compatibility matrix includes:

- Ubuntu latest + VS Code 1.85.0;
- Ubuntu latest + VS Code Stable;
- macOS latest + VS Code 1.85.0;
- macOS latest + VS Code Stable;
- Windows latest + VS Code 1.85.0;
- Windows latest + VS Code Stable.

Each matrix entry performs:

1. npm install via `npm ci`;
2. TypeScript check;
3. runtime/release tests;
4. real VS Code Extension Host tests;
5. VSIX packaging;
6. isolated VSIX installation/probe;
7. probe artifact upload.

Draft pull requests intentionally skip the compatibility job.

## What CI does not certify

The matrix does not prove:

- WSL behavior;
- Dev Container behavior;
- Remote SSH behavior;
- real network reconnect behavior;
- actual screen-reader behavior;
- manual theme/contrast behavior;
- every third-party task provider.

Remote host classes require their own smoke records.

## Installed-VSIX automated probe

The packaged probe:

- audits VSIX contents;
- installs the VSIX using the VS Code CLI;
- uses fresh extension and user-data directories;
- confirms the expected extension id/version;
- confirms the extension loaded from the isolated install, not the development checkout;
- opens the Tasks Activity Bar view;
- waits for activation;
- confirms the Refresh command;
- records requested/actual VS Code version, platform, architecture and package files.

This is stronger than a source-only unit test, but it is still automated and does not replace the manual GUI release procedure.

## URI-based workspace file access

Tasks Sidebar does not construct local filesystem paths for task-file operations.

It uses:

- `vscode.Uri.joinPath`;
- `vscode.workspace.fs.stat`;
- `readFile`;
- `createDirectory`;
- `writeFile`;
- `openTextDocument`.

In WSL/Dev Container/SSH, these operations therefore target the active workspace filesystem as supplied by VS Code.

## WSL

Status: **Best effort; not certified.**

Expected architecture:

- extension installed/running in the WSL workspace extension host;
- board label reports `Remote · <name>`;
- task discovery uses VS Code's remote task API;
- task-file editing uses remote workspace URI APIs.

Required evidence before calling WSL validated:

- complete WSL row in `test/remote-smoke/README.md`;
- candidate version + VSIX SHA-256;
- local VS Code + remote host versions;
- remote OS/distribution;
- passed/not-run case record;
- tester/date/evidence.

Current row is Pending/Not run.

## Dev Containers

Status: **Best effort; not certified.**

Expected behavior is the same workspace-host/URI model, but a local Linux CI run is not equivalent to a container extension host.

Validation must be performed inside an actual Dev Container and recorded independently.

Current row is Pending/Not run.

## Remote SSH

Status: **Best effort; not certified.**

The extension must be installed in the active SSH workspace host. Task commands and files exist in the remote environment.

Validation must be performed against a real SSH target and recorded independently.

Current row is Pending/Not run.

## Remote smoke procedure

The repository's `test/remote-smoke` fixture contains:

- Remote smoke: quick success;
- Remote smoke: expected failure;
- Remote smoke: long runner.

The procedure requires, per host class:

1. install the exact candidate VSIX in the remote host;
2. open `test/remote-smoke` remotely;
3. confirm `Remote · <name>` and task discovery;
4. run success and verify `REMOTE_SMOKE_OK`;
5. run failure and verify failed outcome;
6. run/stop long runner and verify cancellation or conservatively record unknown/stale if end is unconfirmed;
7. run success again, reload and verify completed history remains;
8. edit tasks.json through the remote editor and verify refresh;
9. perform a real connection interruption/reconnect when safe;
10. optionally test a provider installed only remotely.

A Developer: Reload Window operation does **not** count as a real disconnect test.

## Active observation persistence

Before reload, live observations are stored in `workspaceState` with:

- logical task id;
- legacy/history identifiers;
- workspace-folder URI;
- name/source;
- observation timestamp.

Concrete session-local `execution-N` ids are not the durable reconciliation key.

## Rehydration after reload

At activation, the extension first inspects `vscode.tasks.taskExecutions`.

Executions VS Code still reports are reconstructed as recovered active tasks.

They are shown with timing based **since reload**, because the extension cannot reconstruct a continuous monotonic start clock from before the host restart.

Recovered success does not retrain the plan.

## Persisted observation matching

Persisted observations are matched one-for-one against currently live executions using logical id + workspace URI.

This supports parallel multiplicity.

Unmatched observations remain pending until the observation timeout. If still missing afterward, they are recorded as **Unknown**.

## Reconnect scenario: execution still reported

```text
long task running
connection/reload occurs
VS Code reports execution after host returns
→ recovered Running
→ duplicate Start blocked
```

## Reconnect scenario: execution disappears

```text
long task running
connection lost
VS Code no longer reports it
→ persisted observation pending
→ timeout expires
→ Unknown
```

Connection loss is not proof that the process succeeded, failed or was cancelled.

## Previously stale execution becomes active again

An in-memory tracked execution can become Stale if it disappears from VS Code's current execution list long enough.

If that same `TaskExecution` object is reported again before terminal task-end:

- stale is cleared;
- if process end was **not** seen, old unconfirmed stop intent is cleared and state becomes Running;
- if process end **was** seen, stop intent is preserved and state becomes Waiting for task end.

This distinction prevents an old Stop request from permanently poisoning a live run while still preserving cancellation semantics after process end.

## Start blocking after recovery

Before Run, Tasks Sidebar reconciles current VS Code executions.

Therefore:

1. stale execution may reappear;
2. it is restored to active state;
3. `hasActiveLogicalTask` becomes true;
4. a second Start is rejected.

This protects against duplicate execution immediately after a transient task-list/connection gap.

## Stop intent across reconnect

### No process-end evidence

An old unconfirmed Stop request is cleared when the execution is observed live again.

The user can request Stop again.

### Process-end evidence already exists

Stop intent is preserved because it can still determine cancellation once task-end arrives.

State becomes Waiting for task end rather than normal Running.

## Workspace changes

When workspace folders change, refresh runs.

Tasks tied to a removed workspace-folder URI are hidden from the current board without forcing another root's tasks to disappear.

Task identity/history remain scope-aware.

## Host-specific diagnostics

When reporting a remote problem, include:

- Tasks Sidebar version;
- desktop VS Code version;
- remote extension-host version;
- host class;
- remote OS/distribution;
- board host label;
- workspace folder/provider;
- exact warning;
- candidate VSIX hash if testing a release;
- whether the case was reload or real disconnect.

Do not publish private hostnames, credentials or sensitive paths.

## Related chapters

- [Installation](01-installation-first-run.md)
- [Discovery and identities](02-discovery-providers-identities.md)
- [Lifecycle](03-execution-lifecycle.md)
- [History/persistence](06-history-progress-persistence.md)
- [Troubleshooting](09-troubleshooting.md)
