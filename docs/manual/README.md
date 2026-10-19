# Tasks Sidebar handbook

This handbook is the detailed user guide and reference for Tasks Sidebar. It is organized so you can either read from installation through advanced workflows or jump directly to a precise behavior.

## Start here

1. [Installation, first run and Task Board walkthrough](01-installation-first-run.md)
2. [Task discovery, providers and identities](02-discovery-providers-identities.md)
3. [Execution lifecycle, stop and safe restart](03-execution-lifecycle.md)
4. [Compound tasks and dependencies](04-compound-tasks-dependencies.md)
5. [Search, filters and sorting](05-search-filter-sort.md)
6. [Runtime history, progress and persistence](06-history-progress-persistence.md)
7. [Commands, settings and tasks.json workflows](07-commands-settings-tasks-json.md)
8. [Task output and terminals](08-output-terminal.md)
9. [Troubleshooting and recovery](09-troubleshooting.md)
10. [Accessibility, keyboard and themes](10-accessibility.md)
11. [Compatibility, remote hosts and reconnects](11-compatibility-remote.md)
12. [Reference tables, recipes and edge-case audit](12-reference-recipes-audit.md)

The [documentation coverage matrix](coverage-matrix.md) is the completeness checklist used to keep this handbook aligned with implementation and tests.

## Scope and source of truth

The handbook describes observable behavior of the current extension. Where README text, older release notes, implementation and tests differ, implementation and tests are authoritative and the discrepancy is called out rather than silently resolved.

Tasks Sidebar currently requires Visual Studio Code 1.85.0 or newer and declares itself as a workspace extension. Local Windows, macOS and Linux are covered by the automated compatibility matrix. WSL, Dev Containers and Remote SSH remain best-effort until their separate manual smoke records are completed.

## Common destinations

- New user: start with [installation and first run](01-installation-first-run.md).
- A task is missing or duplicated: see [discovery and identities](02-discovery-providers-identities.md).
- A task is stopping, stale or unknown: see [execution lifecycle](03-execution-lifecycle.md) and [troubleshooting](09-troubleshooting.md).
- Progress changed unexpectedly: see [history and progress](06-history-progress-persistence.md).
- You use multiple workspace folders: see [discovery](02-discovery-providers-identities.md), [commands/tasks.json](07-commands-settings-tasks-json.md) and [search/sort](05-search-filter-sort.md).
- You use WSL, Dev Containers or SSH: see [compatibility and remote hosts](11-compatibility-remote.md).
