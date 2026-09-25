# Tasks Sidebar Accessibility Runbook

Use this checklist against an installed candidate VSIX. Automated extension-host assertions cover the generated theme hooks, focus-restoration contract, ARIA markup, language declaration, and reduced-motion hooks. They do not render the VS Code webview, calculate actual theme contrast, or exercise an assistive technology.

Keep the manual cases below **Pending** until a person observes them in VS Code. Record failures with the candidate version and a screenshot or short description; do not mark issue #12 complete based only on the automated tests.

## Test setup

- Install the candidate VSIX into a clean VS Code profile and open `test/manual-release/fixtures/valid`.
- Record the VS Code version, operating system/build, extension version and VSIX SHA-256, theme, display language, reduced-motion setting, screen reader/version, tester, and date.
- Use the fixture tasks **Quick success**, **Expected failure**, **Long runner A**, and **Background watcher**. A real cancelled run is produced by stopping a long runner.
- For long-name coverage, temporarily add a workspace task with a long label and a long `group`/source if the provider permits it. Remove the temporary task after the check.

## Manual cases

| ID | Procedure | Expected result | Status |
| --- | --- | --- | --- |
| A01 | Open the Tasks view using the Command Palette, then navigate with Tab and Shift+Tab without using the mouse. Focus each board control and task action. | Every action is reachable in a predictable order, has a visible focus indicator, and activates with Enter or Space. Focus does not get trapped. |
| A02 | Focus Run, Stop, Restart, or Edit on a task card. Leave the view open through several one-second refreshes; then start/stop a task while its action has focus. | Routine refreshes keep keyboard focus on the same action without moving it to the page. If a lifecycle change removes/disables that action, focus moves to the same task card; if that card disappears, focus moves to the board. |
| A03 | Run **Long runner A** and let the periodic refresh update it; stop it, restart it, and run **Quick success** and **Expected failure**. Listen with Narrator or NVDA. | The screen reader identifies the task name, provider/source, state, duration, and currently available actions. Running, stopping, cancelled, successful, and failed transitions are announced once per transition, without a repeated announcement every second. |
| A04 | Open a workspace with no tasks, then a workspace with tasks. Repeat after filtering to no matches. | The empty state has a useful heading and its Create task, Open tasks.json, and Refresh buttons have clear names. The filtered-empty message is announced as a status. |
| A05 | Use the long-name task. Tab to its Run/Edit actions and inspect its task card with the screen reader. | Visually truncated task/source text remains available in the complete accessible name; action names still identify the task. |
| A06 | Check **Dark+**, **Light+**, **High Contrast**, and **High Contrast Light** from the Color Theme picker. On Windows, also enable an OS Contrast theme for the Forced Colors pass. | Text, status labels, controls, boundaries, progress, and focus remain distinguishable in every mode. States remain understandable from text and shape even when colors are unavailable. Record theme-specific failures. If reporting WCAG contrast compliance, measure the rendered foreground/background pairs and record the ratios; visual inspection alone is not a contrast measurement. |
| A07 | With the Tasks view open, disable animation effects in the OS accessibility settings and run **Long runner A** or **Background watcher**. Toggle the preference while the task is active if the OS allows it. | Decorative orbit, pulse, transition, and progress-bar motion stop when reduced motion is enabled, including when the preference changes during an animation. Task state and elapsed-time text continue to update. |
| A08 | Change VS Code's display language to German through **Configure Display Language**, reload the window, and reopen Tasks. | The sidebar remains English-only and the document declares `lang="en"`; there is no mixed-language or falsely translated UI. |

## Run record

Fill one row per observed environment. Keep unrun cases pending.

| VS Code / OS | Candidate VSIX / SHA-256 | Theme / display language | Reduced motion | Assistive technology | Cases / result / evidence | Tester / date |
| --- | --- | --- | --- | --- | --- | --- |
| Pending | Pending | Pending | Pending | Pending | Pending | Pending |

## Current verification boundary

The automated tests are regression checks for generated HTML and CSS/JavaScript contracts. They are not a browser-based visual test, an actual contrast calculation, or a screen-reader test. The manual cases above have not been run by this change; issue #12 must remain open until the run record contains real observations.
