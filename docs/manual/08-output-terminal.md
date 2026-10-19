# Task output and terminals

Tasks Sidebar does not provide toolbar actions for opening task output or focusing a
terminal. Use VS Code's Output and Terminal panels directly.

The public VS Code task API exposes a task and its termination, but no task-specific
terminal or output handle. Tasks Sidebar therefore cannot associate a task card with a
particular terminal or output channel, including child tasks from a compound task.

Task history stores outcome and timing metadata; it does not persist stdout or stderr.
Whether VS Code retains a task's output depends on VS Code's own task and output state.

In remote workspaces, task execution, output and terminals belong to the active VS Code
workspace/remote extension-host environment. Tasks Sidebar does not copy remote output
locally or map remote process ids.

For lifecycle uncertainty, see [Execution lifecycle](03-execution-lifecycle.md) and
[Troubleshooting](09-troubleshooting.md).
