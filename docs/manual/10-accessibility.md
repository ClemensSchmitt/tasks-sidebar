# Accessibility, keyboard, themes and reduced motion

Tasks Sidebar includes explicit accessibility contracts in its webview, but automated HTML/CSS/JavaScript checks are not a substitute for manual assistive-technology and visual verification.

## Keyboard operation

The Task Board uses standard focusable controls:

- toolbar buttons;
- search input;
- Reset button;
- Filter select;
- Sort select;
- task-card Run/Stop/Restart/Edit buttons;
- empty-state Create/Open/Refresh buttons;
- Retry button.

Use Tab and Shift+Tab to move through controls. Standard browser/VS Code webview behavior applies for Enter/Space activation and native select interaction.

## Focus visibility

Focusable controls use `:focus-visible` outlines based on the VS Code focus-border token.

In forced-colors mode the focus outline is explicitly set to the system `Highlight` color.

The list and task cards can also receive fallback focus so a rerender does not leave keyboard focus nowhere meaningful.

## Focus restoration after updates

Task snapshots can refresh every second while a task is running. Rebuilding the card DOM on every tick would make keyboard use unstable, so the webview distinguishes structural/state changes from time-only updates.

When a full rerender is necessary, Tasks Sidebar records a focus bookmark containing:

- element id;
- action type;
- action id;
- logical task id;
- execution id.

It tries to restore focus in progressively broader steps:

1. same element id;
2. same action + same action id;
3. same action on the same task/execution;
4. same execution card;
5. same logical task card;
6. board container.

This matters when a lifecycle change removes an action. For example, after Run becomes Stop, the previous button may no longer exist; focus falls back rather than being lost.

## Warning/Retry focus

The warning region avoids recreating an identical warning.

If Retry currently has focus and the warning is replaced, focus is restored to the new Retry button. If the warning clears while Retry was focused, focus moves to the task board.

## Screen-reader labels

### Board controls

Toolbar buttons and view controls have explicit `aria-label` values.

Examples:

- Refresh tasks
- Create task
- Open tasks.json
- Reset search and filters
- Filter tasks
- Sort tasks

### Task cards

Each task card receives an accessible label assembled from available information:

- task name;
- provider/source;
- group;
- workspace folder;
- runtime/dependency status;
- plan/progress text;
- currently available actions.

This means a visually truncated long task name/source can still be available to assistive technology.

### Task actions

Action labels include the task name where relevant, such as:

- Run <task>
- Stop <task>
- Restart <task>
- Edit <task>

Stopping/waiting disabled controls also have explicit labels such as **Task is stopping** or **Waiting for task end**.

## State announcements

The page contains a visually hidden polite live region.

After the initial snapshot, lifecycle/outcome changes can be announced as:

- Running;
- Stopping;
- Finishing;
- Completed successfully;
- Failed;
- Cancelled;
- No longer observable;
- Outcome unknown;
- Ready.

The list itself uses `aria-live="off"` so the one-second runtime refresh does not repeatedly announce the whole board.

The state map only announces when the lifecycle/outcome signature changes, not on every elapsed-time tick.

## Progress semantics

Every task progress element is a `role="progressbar"` with:

- `aria-valuemin="0"`;
- `aria-valuemax="100"`;
- `aria-valuetext` describing task status.

### Determinate progress

When a running task has a learned plan, `aria-valuenow` is present and updated with the current percentage.

The visual percentage caps at 100%, while status text can report overtime.

### Indeterminate progress

When a running task has no learned plan, progress is indeterminate.

In that state:

- the bar does not expose `aria-valuenow`;
- `aria-valuetext` still reports meaningful state;
- the visual flow animation is decorative rather than the only source of information.

This prevents “100% width” of the indeterminate visual treatment from being interpreted as actual completion.

## Reduced motion

The webview responds to `prefers-reduced-motion: reduce`.

CSS disables:

- animations;
- transitions;
- smooth scrolling;
- hover translation.

The JavaScript progress animation also listens for preference changes:

- if reduced motion becomes active, an existing animation frame is cancelled;
- if reduced motion becomes inactive and an indeterminate bar exists, animation can restart.

Task status and elapsed text continue to update. Reduced motion therefore removes non-essential motion without hiding state.

## Themes and VS Code color tokens

The webview uses VS Code semantic tokens such as:

- `--vscode-foreground`;
- `--vscode-descriptionForeground`;
- `--vscode-sideBar-background`;
- `--vscode-editorWidget-background`;
- `--vscode-errorForeground`;
- `--vscode-editorWarning-foreground`;
- `--vscode-focusBorder`;
- `--vscode-testing-iconPassed`.

Fallbacks are provided so content remains legible if a specific token is unavailable.

States are communicated with text/glyphs as well as color.

## Forced colors

A `forced-colors: active` media query replaces decorative styling with system-oriented values:

- Canvas / CanvasText;
- Highlight focus/progress;
- explicit borders.

The intent is to keep controls, card boundaries, focus and progress distinguishable when author colors are overridden.

## English-only UI

The document declares:

```html
<html lang="en">
```

The current UI strings are English-only. Changing VS Code's display language does not localize the extension.

This is a current limitation, not a localization claim.

## Empty and filtered states

The no-task state uses a semantic heading and real buttons for Create/Open/Refresh.

The filtered-empty state uses `role="status"` and states that no matching tasks exist.

The warning surface uses `role="alert"`.

## Automated coverage

The Extension Host integration suite checks generated UI contracts including:

- VS Code theme variables;
- focus-visible rules;
- reduced-motion media query;
- forced-colors media query;
- polite/off live regions;
- search label;
- ARIA progress value text;
- document language;
- semantic headings;
- task ids;
- focus bookmark/restore code;
- Retry control;
- task action availability;
- reduced-motion animation cancellation;
- HTML escaping of version/host values.

These are regression checks for generated markup/code.

They are **not**:

- a real screen-reader session;
- a browser visual test;
- a WCAG contrast measurement;
- proof of keyboard behavior in every VS Code/OS combination.

## Manual verification matrix

The repository contains `test/manual-accessibility/README.md` with cases A01-A08.

Current run record: **Pending**. No manual case should be described as passed until a tester records evidence.

### A01 — keyboard-only navigation

Verify every toolbar/control/task action is reachable with Tab/Shift+Tab, visibly focused, activatable and not trapped.

### A02 — focus stability

Keep focus on a task action through periodic refreshes and lifecycle transitions. Confirm focus remains on the logical action/card or falls back predictably.

### A03 — screen-reader state changes

Use Narrator or NVDA with success, failure, long-run and cancellation scenarios. Confirm task name/source/state/duration/actions are available and transitions are not repeated every second.

### A04 — empty states

Test no-task and filtered-empty states, including button names and status announcement.

### A05 — long names

Verify visually clipped names/sources remain complete in accessible names and actions still identify the task.

### A06 — themes and contrast

Check Dark+, Light+, High Contrast and High Contrast Light. On Windows, also test OS Forced Colors.

Visual inspection alone is not a WCAG contrast calculation. If contrast compliance is claimed, measure rendered foreground/background pairs and record ratios.

### A07 — reduced motion

Enable OS reduced-motion/animation preferences while a task runs. Confirm decorative motion stops while status/time remain available.

### A08 — display language

Switch VS Code to German and verify the webview remains consistently English with `lang="en"`.

## Current validation boundary

What is currently justified:

- automated contracts exist for accessible labels, focus logic, ARIA progress, theme hooks, reduced motion and forced colors;
- manual procedure exists.

What is **not** yet justified:

- screen-reader certification;
- measured contrast conformance;
- manual keyboard pass across representative OS/theme combinations.

Keep those claims pending until the manual run record contains actual observations.

## Practical keyboard workflow

A keyboard-only user can:

1. open the Tasks view through VS Code;
2. Tab to search/filter/sort;
3. type/search or choose a filter;
4. Tab to a task card action;
5. Run/Stop/Restart/Edit;
6. continue using the view while refreshes occur;
7. use Retry if a warning appears.

For exact search/filter behavior see [Search, filters and sorting](05-search-filter-sort.md).

## Related chapters

- [Task Board walkthrough](01-installation-first-run.md)
- [Search/filter/sort](05-search-filter-sort.md)
- [Lifecycle](03-execution-lifecycle.md)
- [Troubleshooting](09-troubleshooting.md)
