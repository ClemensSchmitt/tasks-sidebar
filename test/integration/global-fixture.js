const testHomeVariable = 'TASKS_SIDEBAR_TEST_PROFILE';
const testCwdVariable = 'TASKS_SIDEBAR_TEST_CWD';
const configHome = '${env:' + testHomeVariable + '}';
const explicitCwd = '${env:' + testCwdVariable + '}';
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
      command: 'node',
      args: [configHome + '/shell-fixture.js'],
      linux: { options: { shell: { executable: '/bin/sh', args: ['-c'] } } },
      osx: { options: { shell: { executable: '/bin/sh', args: ['-c'] } } },
      windows: { options: { shell: { executable: '${env:ComSpec}', args: ['/d', '/c'] } } },
      problemMatcher: []
    },
    {
      label: 'Global cwd integration task', type: 'process', command: 'node',
      args: [configHome + '/cwd-fixture.js', explicitCwd],
      options: { cwd: explicitCwd }
    }
  ]
};
fixture.tasks.push(fixture.tasks[0]);

module.exports = { duplicateLabel, fixture, testHomeVariable, testCwdVariable };
