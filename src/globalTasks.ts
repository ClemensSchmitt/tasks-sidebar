import { createHash } from 'node:crypto';
import { posix, win32 } from 'node:path';
import { parseTaskDocument, parseTaskTags } from './runtime';

export const GLOBAL_TASK_SOURCE = 'Global · Tasks Sidebar';
export const GLOBAL_TASK_TYPE = 'tasksSidebarGlobal';
export const EMPTY_TASK_FILE = '{\n  "version": "2.0.0",\n  "tasks": []\n}\n';

type Platform = NodeJS.Platform;
type TaskObject = Record<string, unknown>;
type Quoted = { value: string; quoting: 'escape' | 'strong' | 'weak' };
type Argument = string | Quoted;

export type GlobalTask = {
  label: string;
  index: number;
  fingerprint: string;
  type: 'shell' | 'process';
  command: Argument;
  args?: Argument[];
  cwd?: string;
  env?: Record<string, string>;
  shell?: { executable?: string; args?: string[] };
  problemMatchers: string[];
  presentation: TaskObject;
  group?: string;
  detail?: string;
  isBackground: boolean;
  tags: string[];
};

export function globalTaskPath(home: string, platform: Platform): string {
  return (platform === 'win32' ? win32 : posix).join(home, '.vscode', 'extensions', 'tasksidebar', 'tasks.json');
}

function record(value: unknown): TaskObject {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object.');
  return value as TaskObject;
}

function stringOption(value: unknown, field: string): string | undefined {
  if (value === undefined || typeof value === 'string') return value;
  throw new Error(`${field} must be a string.`);
}

function argument(value: unknown, type: GlobalTask['type']): Argument {
  if (typeof value === 'string') return value;
  if (type === 'shell') {
    const { value: text, quoting } = record(value);
    if (typeof text === 'string' && (quoting === 'strong' || quoting === 'weak' || quoting === 'escape')) {
      return { value: text, quoting };
    }
  }
  throw new Error('Use strings for command and args, or VS Code quoting objects for shell tasks.');
}

function list<T>(value: unknown, field: string, convert: (entry: unknown) => T): T[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error(`${field} must be an array.`);
  return value.map(convert);
}

function strings(value: unknown, field: string): string[] | undefined {
  return list(value, field, entry => {
    if (typeof entry === 'string') return entry;
    throw new Error(`${field} must contain strings.`);
  });
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, entry]) => [key, canonical(entry)]));
  }
  return value;
}

function parseEntry(raw: TaskObject, platform: Platform, index: number): GlobalTask {
  const os = platform === 'win32' ? 'windows' : platform === 'darwin' ? 'osx' : platform === 'linux' ? 'linux' : undefined;
  const override = os ? record(raw[os]) : {};
  const entry = { ...raw, ...override };
  const label = stringOption(raw.label, 'label');
  if (!label?.trim()) throw new Error('A non-empty label is required.');
  const { type } = entry;
  if (type !== 'shell' && type !== 'process') throw new Error('Use a shell or process task.');
  if (entry.dependsOn !== undefined) throw new Error('Dependencies are unavailable for Global Tasks Sidebar tasks.');
  const command = argument(entry.command, type);
  if (!(typeof command === 'string' ? command : command.value).trim()) throw new Error('A non-empty command is required.');
  const args = list(entry.args, 'args', value => argument(value, type));
  const baseOptions = record(raw.options);
  const osOptions = record(override.options);
  const options = { ...baseOptions, ...osOptions };
  const environment = { ...record(baseOptions.env), ...record(osOptions.env) };
  const env = Object.fromEntries(Object.entries(environment).map(([key, value]) => [key, stringOption(value, `options.env.${key}`)!]));
  const shellOptions = options.shell === undefined ? undefined : { ...record(baseOptions.shell), ...record(osOptions.shell) };
  const execution: Pick<GlobalTask, 'type' | 'command' | 'args' | 'cwd' | 'env' | 'shell' | 'isBackground'> = {
    type, command, args,
    cwd: stringOption(options.cwd, 'options.cwd'),
    env,
    shell: shellOptions && {
      executable: stringOption(shellOptions.executable, 'options.shell.executable'),
      args: strings(shellOptions.args, 'options.shell.args')
    },
    isBackground: entry.isBackground === true
  };
  const matchers = entry.problemMatcher;
  const problemMatchers = typeof matchers === 'string' ? [matchers] : strings(matchers, 'problemMatcher') ?? [];
  const group = typeof entry.group === 'string' ? entry.group : stringOption(record(entry.group).kind, 'group.kind');
  const presentation = { ...record(raw.presentation), ...record(override.presentation) };
  const fingerprint = createHash('sha256').update(JSON.stringify(canonical({ ...execution, problemMatchers }))).digest('hex');
  return {
    label, index, fingerprint, ...execution, problemMatchers, group, presentation,
    detail: stringOption(entry.detail, 'detail'),
    tags: parseTaskTags({ tasks: [raw] })[label] ?? []
  };
}

export function parseGlobalTasks(text: string, platform: Platform): { tasks: GlobalTask[]; problems: string[] } {
  const file = record(parseTaskDocument(text));
  if (file.version !== '2.0.0' || !Array.isArray(file.tasks)) {
    throw new Error('Set version to "2.0.0" and provide a tasks array.');
  }
  const tasks = new Map<string, GlobalTask>();
  const ambiguous = new Set<string>();
  const problems: string[] = [];
  for (const [index, value] of file.tasks.entries()) {
    try {
      const task = parseEntry(record(value), platform, index);
      const earlier = tasks.get(task.label);
      if (earlier && earlier.fingerprint !== task.fingerprint) {
        ambiguous.add(task.label);
        throw new Error(`Conflicting definitions use the label "${task.label}". Give them distinct labels.`);
      }
      if (!earlier) tasks.set(task.label, task);
    } catch (error) {
      problems.push(`Task ${index + 1}: ${(error as Error).message}`);
    }
  }
  return { tasks: [...tasks.values()].filter(task => !ambiguous.has(task.label)), problems };
}

export type GlobalTaskContext = {
  home: string;
  platform: Platform;
  folders: readonly { name: string; path?: string }[];
  env: NodeJS.ProcessEnv;
};

export function resolveGlobalExecution(task: GlobalTask, context: GlobalTaskContext) {
  const path = context.platform === 'win32' ? win32 : posix;
  if (task.problemMatchers.length && (context.folders.length !== 1 || !context.folders[0].path)) {
    throw new Error('Named problem matchers may resolve paths against a workspace folder. Open a single local folder or remove problemMatcher.');
  }
  const substitute = (match: string, variable: string): string => {
    const [name, argument] = variable.split(/:(.*)/s);
    switch (name) {
      case 'workspaceFolder':
      case 'workspaceRoot':
      case 'workspaceFolderBasename':
      case 'workspaceRootFolderName': {
        const folders = argument === undefined ? context.folders : context.folders.filter(folder => folder.name === argument);
        if (folders.length !== 1 || !folders[0].path) {
          throw new Error(`${match} needs exactly one matching workspace folder. Open that folder or use \${workspaceFolder:FolderName} with a unique name.`);
        }
        return name === 'workspaceFolderBasename' || name === 'workspaceRootFolderName'
          ? path.basename(folders[0].path) : folders[0].path;
      }
      case 'userHome': return context.home;
      case 'pathSeparator':
      case '/': return path.sep;
      case 'env': return argument && Object.hasOwn(context.env, argument) ? context.env[argument] ?? '' : '';
      default:
        // Simple shell variables such as ${HOME} still belong to the shell.
        if (/^[A-Z_][A-Z_0-9]*$/.test(variable)) return match;
        throw new Error(`Unsupported variable ${match}. Use workspaceFolder, workspaceFolderBasename, userHome, pathSeparator or env.`);
    }
  };
  const resolve = (text: string): string => {
    const resolved = text.replace(/\$\{([^{}]+)\}/g, substitute);
    if (/\$\{(?![A-Z_][A-Z_0-9]*\})/.test(resolved)) {
      throw new Error('A variable expanded to another VS Code variable. Use a value that resolves in one step.');
    }
    return resolved;
  };
  const resolveArgument = (argument: Argument): Argument => typeof argument === 'string'
    ? resolve(argument)
    : { ...argument, value: resolve(argument.value) };
  // Without any folders, VS Code uses its own home for an omitted cwd.
  const cwd = task.cwd ? resolve(task.cwd) : context.folders.length ? context.home : undefined;
  if (cwd !== undefined && (!cwd || cwd.includes('${'))) {
    throw new Error('Set options.cwd to a path that resolves before the task starts.');
  }
  if (cwd && context.platform === 'win32' && /^[a-z]:($|[^\\/])/i.test(cwd)) {
    throw new Error('Use an absolute path or a path relative to your home directory for options.cwd.');
  }
  return {
    command: resolveArgument(task.command),
    args: task.args?.map(resolveArgument),
    cwd: cwd === undefined ? undefined : path.resolve(context.home, cwd),
    env: Object.fromEntries(Object.entries(task.env ?? {}).map(([key, value]) => [key, resolve(value)])),
    executable: task.shell?.executable === undefined ? undefined : resolve(task.shell.executable),
    shellArgs: task.shell?.args?.map(resolve)
  };
}
