const duplicateLabel = 'Tasks Sidebar integration task';

const fixture = {
  version: '2.0.0',
  tasks: [
    {
      label: duplicateLabel, type: 'process', command: 'node',
      args: ['-e', 'setTimeout(() => {}, 60000)'], tags: ['Shared']
    },
    {
      label: 'Global shell integration task', type: 'shell',
      command: 'echo tasks-sidebar-global-shell', problemMatcher: []
    },
    {
      label: 'Global cwd integration task', type: 'process', command: 'node',
      args: ['-e', 'if (process.cwd() !== process.argv[1]) process.exit(42)', '${userHome}']
    }
  ]
};
fixture.tasks.push(fixture.tasks[0]);

module.exports = { duplicateLabel, fixture };
