const testHomeVariable = 'TASKS_SIDEBAR_TEST_PROFILE';
const testCwdVariable = 'TASKS_SIDEBAR_TEST_CWD';
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
      args: ['${env:' + testHomeVariable + '}/shell-fixture.js'],
      linux: { options: { shell: { executable: '/bin/sh', args: ['-c'] } } },
      osx: { options: { shell: { executable: '/bin/sh', args: ['-c'] } } },
      windows: { options: { shell: { executable: '${env:ComSpec}', args: ['/d', '/c'] } } },
      problemMatcher: []
    },
    {
      label: 'Global cwd integration task', type: 'process', command: 'node',
      args: ['-e', 'const real = require("node:fs").realpathSync; if (real(process.cwd()) !== real(process.argv[1])) process.exit(42)', explicitCwd],
      options: { cwd: explicitCwd }
    }
  ]
};
fixture.tasks.push(fixture.tasks[0]);

module.exports = { duplicateLabel, fixture, testHomeVariable, testCwdVariable };
