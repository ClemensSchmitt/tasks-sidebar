# Support

For symptom-based recovery guidance, see the [Tasks Sidebar troubleshooting chapter](docs/manual/09-troubleshooting.md).

## Report a bug

Open an issue in the [Tasks Sidebar issue tracker](https://github.com/ClemensSchmitt/tasks-sidebar/issues/new) and describe one problem per issue. Include:

- Tasks Sidebar version and Visual Studio Code version.
- Operating system and workspace host: local, WSL, Dev Container, or Remote SSH.
- Steps to reproduce, expected behavior, and what happened instead.
- The smallest relevant `.vscode/tasks.json` task definition and any exact error message or relevant task-output excerpt.

Remove credentials, tokens, environment-variable values, private file paths, customer data, and other sensitive information before posting. A minimal example is more useful than a full workspace or log dump.

## Support availability

Use the public [GitHub issue tracker](https://github.com/ClemensSchmitt/tasks-sidebar/issues) for bug reports.

The current code documents WSL, Dev Containers, and Remote SSH as best effort, not certified support. Local Windows, macOS, and Linux are covered by the automated CI matrix on VS Code 1.85.0 and stable. See [Compatibility and remote behavior](README.md#compatibility-and-remote-behavior).

For security-sensitive reports, do not post exploit details or credentials in the issue tracker. No private security contact is published, so do not include sensitive information in an issue.
