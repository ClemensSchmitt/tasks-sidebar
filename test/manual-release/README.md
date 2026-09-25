# Release candidate manual smoke test

This procedure exercises an installed Tasks Sidebar VSIX in a clean VS Code profile. It is separate from the source-based extension-host tests. Keep the run record below pending until a person has completed the GUI steps against the exact candidate VSIX.

## Preconditions

- Release candidate VSIX produced and verified under [issue #21](https://github.com/ClemensSchmitt/tasks-sidebar/issues/21). Record its version and SHA-256.
- Use the VS Code 1.85.0 CLI for the minimum-version pass and the current Stable CLI for the current-version pass. Use the executable belonging to the version under test and record its full `--version` output.
- Record OS and build, candidate VSIX version/hash, date, tester, and fixture workspace for each pass.
- Node.js must be available on PATH for the process and npm fixture tasks. No `npm install` is needed.
- Trust the fixture workspace before starting tasks. Run in a clean profile so an older extension copy or persisted task history cannot affect the result.

## Isolated install (PowerShell example)

Run once for each VS Code version, with a distinct profile directory for each one. Substitute the actual VSIX path and target VS Code executable if the CLI is not named `code`.

```powershell
$vsix = (Resolve-Path '.\tasks-sidebar-<version>.vsix').Path
$runId = [guid]::NewGuid().ToString('N')
$profile = Join-Path $env:TEMP ("tasks-sidebar-smoke-stable-" + $runId)
if (Test-Path $profile) { throw "Smoke profile already exists: $profile" }
$data = Join-Path $profile 'user-data'
$extensions = Join-Path $profile 'extensions'
$fixture = (Resolve-Path '.\test\manual-release\fixtures\valid').Path

code --user-data-dir $data --extensions-dir $extensions --install-extension $vsix --force
code --user-data-dir $data --extensions-dir $extensions --new-window $fixture
```

For VS Code 1.85.0, use a separate unique profile (change the prefix to `tasks-sidebar-smoke-1.85-`) and the 1.85.0 CLI. The GUID makes each run start with a new user-data and extensions directory; do not reuse a profile from an earlier run. In each window, open the **Tasks** Activity Bar view and confirm its header shows the candidate version. The candidate installation, version label, and opened view must all refer to the same isolated profile.

## Fixture workspaces

- `fixtures/no-tasks`: workspace folder with no `.vscode/tasks.json`.
- `fixtures/empty`: valid `tasks.json` with an empty task list.
- `fixtures/valid`: workspace process tasks for success, failure, long-running processes, background behavior, and sequential/parallel dependencies; `package.json` also exposes npm-provider tasks.
- `fixtures/invalid`: deliberately malformed `tasks.json`.
- `fixtures/multi-root-smoke.code-workspace`: two task folders for folder sorting and workspace-folder search.

All task commands use Node directly. Fixture tasks never access the network or modify files.

## Manual cases

Run these cases against the installed VSIX at both versions recorded above. Mark a case only after observing it in the GUI.

| ID | Fixture / action | Expected result | Status |
| --- | --- | --- | --- |
| M01 | Install candidate in the clean profile; open Tasks view. | VS Code reports the target version; Tasks Sidebar appears in Activity Bar, activates, and the card header shows the candidate version. | Pending |
| M02 | Open `fixtures/no-tasks` (no `.vscode/tasks.json`); repeat with `fixtures/empty` (`tasks: []`). | The empty-state card appears for both a missing task file and an empty task list. Create, Open tasks.json, and Refresh respond; no task is reported as successful. | Pending |
| M03 | Open `fixtures/valid` with defaults. Then run `Tasks: Toggle external task providers` and refresh the view. | Workspace tasks appear, while npm tasks are absent by default. After enabling the provider, npm tasks appear; the External providers filter isolates them and `npm: sidebar-smoke` runs and prints `EXTERNAL_NPM_OK`. Toggling the provider back off hides them. Labels, provider/group metadata, and workspace name are readable. | Pending |
| M04 | Run **Quick success** and **Expected failure**. | Quick success completes successfully and its task output contains `SMOKE_OK`; Expected failure is failed (exit code 7), never successful. | Pending |
| M05 | Start **Long runner A**, stop it, then start it again and use Restart while it is running. | Stop reaches a confirmed cancelled/ended state. Restart performs stop-then-start; the new execution is running and the old one is not left live. | Pending |
| M06 | Start **Long runner A** and **Long runner B** together; stop only A. | Two distinct live cards/execution IDs are visible. Stopping A leaves B running; B can then be stopped independently. | Pending |
| M07 | Start **Background watcher** and wait at least 20 seconds; then stop it. | It remains running during the wait (does not become stale merely from elapsed time). A confirmed stop ends it as cancelled. | Pending |
| M08 | Run **Sequential dependency parent**, then **Parallel dependency parent**. | Sequential children start in declared order. Parallel children overlap. The child executions are visible, and the parent dependency state reaches success only after its dependencies complete. | Pending |
| M09 | Use the output and terminal toolbar actions while a task is running or after it prints `SMOKE_OK`. | Open VS Code task output displays the expected marker; Focus active task terminal focuses the VS Code-owned active task terminal when one exists. | Pending |
| M10 | Search by task name, provider, group, and folder. Exercise All, Running, Failed, Completed, Unknown/stale, and External providers filters; reset the view. Exercise name, status, elapsed, and folder sort (use the multi-root fixture for folder sort). | Each search/filter narrows the visible cards correctly; reset restores them. Use an Unknown/stale card if M11 produces one; if none is produced, record that case as unavailable and verify the filter's no-match state without claiming unknown-card coverage. Sort order changes deterministically. | Pending |
| M11 | While **Long runner A** is running, run **Developer: Reload Window**. | If VS Code still reports the execution, it returns as running with elapsed time since reload. If VS Code no longer reports it, the outcome is unknown/stale after the grace period, never success. Do not infer that reload stopped the process. | Pending |
| M12 | Open `fixtures/invalid`. | The malformed task is not offered as runnable and is never shown as successful. Record the actual VS Code/parser warning or empty/retry state; reopen `fixtures/valid` and Refresh to confirm recovery. | Pending |
| M13 | In the isolated profile, close the VS Code window, run `code --user-data-dir $data --extensions-dir $extensions --uninstall-extension local.tasks-sidebar`, then `code --user-data-dir $data --extensions-dir $extensions --install-extension $vsix --force`; reopen `fixtures/valid` and activate the view again. | Install and activation succeed after reinstall, and the header still shows the expected candidate version. | Pending |

The extension does not allow starting a second workspace execution of the same logical task from its own card while that task is already live. M06 therefore starts two different long-running definitions and checks that concrete executions remain independent.

### Missing exit information

A normal `tasks.json` process task reports a process-end event, so it cannot reliably produce the missing-exit-code condition by itself. The existing automated runtime assertion `missing exit code is unknown, never success` in `test/runtime.test.js` checks this conservative rule. Record the corresponding automated CI result separately; do not mark M04 or M11 as proof of that case.

## Run record

Complete one row per VS Code/OS combination. Attach concise screenshots or logs for failures and unexpected states. Do not include personal workspace paths or secrets.

| VS Code version | OS / build | VSIX version | VSIX SHA-256 | Fixture workspace | Tester / date | Result / evidence |
| --- | --- | --- | --- | --- | --- | --- |
| 1.85.0 | Pending | Pending | Pending | Pending | Pending | Pending |
| Stable | Pending | Pending | Pending | Pending | Pending | Pending |

### Execution status for this change

- Fixture and procedure: added; local strict-JSON parsing passed for all valid JSON/workspace fixtures, and the deliberately malformed task file was rejected as intended.
- Manual GUI run against an installed candidate VSIX: **not run here**. This worker has no VS Code GUI or candidate VSIX. Leave issue #22 open until the run record and manual case results are filled from an actual installed-candidate run.
- Automated missing-exit-code runtime assertion: already present in `test/runtime.test.js`; record CI status from the candidate workflow before treating automated coverage as verified.
