# Remote workspace smoke test

This is a manual smoke procedure for the remote workspace extension host. It is separate from the automated local-host CI matrix. The run table starts as **Not run**: do not change a row to passed without completing the steps in that host class against the recorded VSIX.

## Host support status

| Host class | Support statement | Run status for this change |
| --- | --- | --- |
| WSL | Best effort; not certified | Not run |
| Dev Containers | Best effort; not certified | Not run |
| Remote SSH | Best effort; not certified | Not run |

A local Linux CI job is not a WSL or Dev Container run. Record evidence for each remote class independently.

## Preconditions

- Build the candidate package from the commit under test with `npm ci` and `npm run package`. Record the extension version, VSIX SHA-256, and both the local VS Code version and remote extension host version.
- Install that candidate VSIX into the remote workspace extension host. In the Extensions view, verify the extension is installed for the active WSL, Dev Container or SSH target, rather than only in the local host.
- Node.js must be available as `node` in the remote workspace environment. The fixture needs no npm install, network access or shell-specific commands.
- Open the `test/remote-smoke` folder itself as the remote workspace and trust it.
- Run one host class at a time in VS Code Stable. To check the minimum supported version, repeat with VS Code 1.85.0 and record it separately.

## Procedure

1. Connect to one target: **WSL**, **Dev Containers**, or **Remote SSH**. Open the remote extension's **Installed** list and confirm the candidate version is installed there.
2. Open this folder in the remote window: `test/remote-smoke`. Open the **Tasks** Activity Bar view and run **Tasks: Refresh**. Confirm the board header displays `Remote · <name>`, and that **Remote smoke: quick success**, **Remote smoke: expected failure**, and **Remote smoke: long runner** are listed as Workspace tasks.
3. Run **Remote smoke: quick success**. Confirm its output contains `REMOTE_SMOKE_OK`, its outcome becomes successful, and its completed-run count/history is updated.
4. Run **Remote smoke: expected failure**. Confirm its output contains `REMOTE_SMOKE_EXPECTED_FAILURE` and the outcome is failed, not successful.
5. Start **Remote smoke: long runner**. Confirm it stays running and emits `REMOTE_SMOKE_TICK`. Stop it from the board. Confirm VS Code reports the end and the board records cancellation; if VS Code does not confirm the end, record the actual unknown/stale result instead of calling it stopped.
6. Run quick success again, then use **Developer: Reload Window**. Reopen the board and confirm the last completed result/history remains available.
7. Run **Tasks: Open tasks.json**. In the remote editor, change the quick-success task label to `Remote smoke: edited success` and save. Confirm the task list refreshes and the edited task is visible. This checks access through the remote workspace file system.
8. For reconnect behavior, start the long runner and interrupt the actual remote connection or remote target, then reconnect to the same workspace. Do not count **Developer: Reload Window** as a disconnect test. If a real connection loss cannot be produced safely, mark this case **Not run**. After reconnect, an execution still reported by VS Code should appear running. If the same extension host had marked that execution stale during a temporary task-list gap, Refresh reconciles it back to running before accepting a new Start request. If VS Code no longer reports it, the extension may record unknown/stale after its observation grace period; the connection loss must not be reported as a successful completion or confirmed cancellation. Confirm Refresh works and a new quick-success run can start.
9. Optional provider check: if the target has a task provider installed only in the remote host, enable **Tasks: Toggle external task providers**, refresh, and verify its task appears and can be run. If no remote-only provider is available, mark this check **N/A**. A deliberate provider failure is not part of this fixture; do not record provider-error coverage unless it was actually induced and observed.

If any case fails, record the displayed host label, VS Code versions, fixture path, VSIX hash and relevant output. Avoid personal workspace paths, hostnames, credentials and other secrets.

## Fixture

`.vscode/tasks.json` contains three process tasks:

- **Remote smoke: quick success** prints `REMOTE_SMOKE_OK` and exits with code 0.
- **Remote smoke: expected failure** prints `REMOTE_SMOKE_EXPECTED_FAILURE` and exits with code 7.
- **Remote smoke: long runner** prints `REMOTE_SMOKE_STARTED`, then a tick each second until stopped.

All commands use Node.js directly so the fixture does not depend on Bash, PowerShell, npm packages or an internet connection.

## Run record

Fill one row per host class and candidate. Attach a concise screenshot or output log for unexpected behavior. A pending or N/A cell is not a passing result.

| Host class | VS Code desktop version | Remote extension host version | Remote OS / distribution | Extension version + VSIX SHA-256 | Cases passed / not run | Tester + date | Evidence / result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| WSL | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| Dev Containers | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| Remote SSH | Pending | Pending | Pending | Pending | Pending | Pending | Pending |

## Scope and limits

This procedure documents a repeatable way to check remote behavior; adding the procedure does not certify a host that has not been run. The automated test suite exercises local Extension Hosts. The source currently retries workspace-declared provider types after aggregate task discovery fails and displays a host-labelled warning when it recovers tasks, but this fixture does not inject a failing task provider. Provider failure behavior remains unverified by this manual run unless the optional provider scenario is actually performed.
