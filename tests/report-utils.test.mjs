import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCommandInvocation,
  buildDevtoolsCliPlan,
  detectDevtoolsCompileCycle,
  detectCliPort,
  determineDevtoolsOpenAction,
  filterLauncherLogSince,
  filterWeappLogSince,
  pickLatestExistingPath,
  resolvePreferredBuildCommand,
  trimEntries,
  summarizeTextBlock,
} from '../lib/report-utils.mjs';

test('detectCliPort returns integer port from .cli content', () => {
  assert.equal(detectCliPort('55976\n'), 55976);
  assert.equal(detectCliPort('  49152  '), 49152);
});

test('detectCliPort rejects invalid port payloads', () => {
  assert.equal(detectCliPort(''), null);
  assert.equal(detectCliPort('abc'), null);
  assert.equal(detectCliPort('70000'), null);
});

test('pickLatestExistingPath prefers newest timestamped entry', () => {
  const selected = pickLatestExistingPath([
    { path: 'a', exists: true, mtimeMs: 1 },
    { path: 'b', exists: true, mtimeMs: 3 },
    { path: 'c', exists: true, mtimeMs: 2 },
  ]);

  assert.equal(selected, 'b');
});

test('pickLatestExistingPath returns null when nothing exists', () => {
  assert.equal(
    pickLatestExistingPath([
      { path: 'a', exists: false, mtimeMs: 1 },
      { path: 'b', exists: false, mtimeMs: 3 },
    ]),
    null,
  );
});

test('trimEntries keeps newest entries within limit', () => {
  const result = trimEntries(
    [
      { ts: 1, text: 'first' },
      { ts: 2, text: 'second' },
      { ts: 3, text: 'third' },
    ],
    2,
  );

  assert.deepEqual(result.map((item) => item.text), ['second', 'third']);
});

test('summarizeTextBlock keeps tail lines and drops empties', () => {
  const result = summarizeTextBlock('\nline-1\n\nline-2\nline-3\n', 2);
  assert.equal(result, 'line-2\nline-3');
});

test('filterLauncherLogSince keeps only current-run launcher lines', () => {
  const startedAt = new Date(2026, 2, 24, 17, 20, 0);
  const result = filterLauncherLogSince(
    [
      '[LAUNCHER]2026/03/24 17:19:59 daemon.go:1: old',
      '[LAUNCHER]2026/03/24 17:20:15 daemon.go:2: current',
      '[LAUNCHER]2026/03/24 17:20:16 daemon.go:3: current-2',
    ].join('\n'),
    startedAt,
    20,
  );

  assert.equal(
    result,
    [
      '[LAUNCHER]2026/03/24 17:20:15 daemon.go:2: current',
      '[LAUNCHER]2026/03/24 17:20:16 daemon.go:3: current-2',
    ].join('\n'),
  );
});

test('filterLauncherLogSince returns empty text when launcher did not restart this run', () => {
  const startedAt = new Date(2026, 2, 24, 17, 20, 0);
  const result = filterLauncherLogSince(
    '[LAUNCHER]2026/03/24 17:19:59 daemon.go:1: old',
    startedAt,
    20,
  );

  assert.equal(result, '');
});

test('filterWeappLogSince keeps only current-run weapp log lines', () => {
  const startedAt = new Date(2026, 2, 24, 18, 34, 58);
  const result = filterWeappLogSince(
    [
      '[2026-03-24 18:34:57.999][INFO] old',
      '[2026-03-24 18:34:58.501][INFO] restart appservice compile',
      '[2026-03-24 18:35:02.085][INFO] webview page ready',
    ].join('\n'),
    startedAt,
    20,
  );

  assert.equal(
    result,
    [
      '[2026-03-24 18:34:58.501][INFO] restart appservice compile',
      '[2026-03-24 18:35:02.085][INFO] webview page ready',
    ].join('\n'),
  );
});

test('detectDevtoolsCompileCycle recognizes a complete devtools-native refresh', () => {
  const signature = detectDevtoolsCompileCycle(
    [
      '[2026-03-24 18:34:58.501][INFO] restart appservice compile',
      '[2026-03-24 18:34:59.293][INFO] appservice reload',
      '[2026-03-24 18:35:02.085][INFO] webview page ready',
    ].join('\n'),
  );

  assert.deepEqual(signature, {
    completed: true,
    hasRestartCompile: true,
    hasAppserviceReload: true,
    hasPageReady: true,
  });
});

test('detectDevtoolsCompileCycle rejects incomplete refresh logs', () => {
  const signature = detectDevtoolsCompileCycle(
    '[2026-03-24 18:34:59.293][INFO] appservice reload',
  );

  assert.deepEqual(signature, {
    completed: false,
    hasRestartCompile: false,
    hasAppserviceReload: true,
    hasPageReady: false,
  });
});

test('buildCommandInvocation wraps Windows bat paths with spaces via cmd.exe', () => {
  const invocation = buildCommandInvocation(
    'win32',
    'C:\\Program Files (x86)\\Tencent\\微信web开发者工具\\cli.bat',
    ['open', '--project', 'D:\\My Program\\HGsh1.0'],
  );

  assert.equal(invocation.command, 'cmd.exe');
  assert.deepEqual(invocation.args.slice(0, 3), ['/d', '/s', '/c']);
  assert.match(invocation.args[3], /^call ".*cli\.bat".*"--project".*"D:\\My Program\\HGsh1\.0"$/u);
  assert.equal(invocation.options.windowsVerbatimArguments, true);
});

test('determineDevtoolsOpenAction refreshes when target project window is already open', () => {
  const action = determineDevtoolsOpenAction({
    projectPath: 'D:\\My Program\\HGsh1.0',
    windows: [
      { title: 'HGsh1.0 - 微信开发者工具 Stable v2.01.2510260' },
    ],
  });

  assert.equal(action, 'refresh-existing-project');
});

test('determineDevtoolsOpenAction switches when devtools is open on another screen', () => {
  const action = determineDevtoolsOpenAction({
    projectPath: 'D:\\My Program\\HGsh1.0',
    windows: [
      { title: '项目选择 - 微信开发者工具' },
    ],
  });

  assert.equal(action, 'switch-to-target-project');
});

test('determineDevtoolsOpenAction launches when devtools is not open', () => {
  const action = determineDevtoolsOpenAction({
    projectPath: 'D:\\My Program\\HGsh1.0',
    windows: [],
  });

  assert.equal(action, 'launch-target-project');
});

test('buildDevtoolsCliPlan leaves already-open project untouched', () => {
  const plan = buildDevtoolsCliPlan({
    action: 'refresh-existing-project',
    projectPath: 'D:\\My Program\\HGsh1.0',
  });

  assert.deepEqual(plan, []);
});

test('buildDevtoolsCliPlan switches other project via open-other only', () => {
  const plan = buildDevtoolsCliPlan({
    action: 'switch-to-target-project',
    projectPath: 'D:\\My Program\\HGsh1.0',
  });

  assert.deepEqual(plan, [
    ['open-other', '--project', 'D:\\My Program\\HGsh1.0', '--debug'],
  ]);
});

test('buildDevtoolsCliPlan launches closed devtools via open only', () => {
  const plan = buildDevtoolsCliPlan({
    action: 'launch-target-project',
    projectPath: 'D:\\My Program\\HGsh1.0',
  });

  assert.deepEqual(plan, [
    ['open', '--project', 'D:\\My Program\\HGsh1.0', '--debug'],
  ]);
});

test('resolvePreferredBuildCommand prefers direct taro weapp build over npm wrapper scripts', () => {
  const command = resolvePreferredBuildCommand({
    projectPath: 'D:\\My Program\\HGsh1.0',
    rootScripts: { 'mobile:build': 'npm run build:weapp --prefix taro-mobile' },
    mobileScripts: { 'build:weapp': 'node ./node_modules/@tarojs/cli/bin/taro build --type weapp' },
    platform: 'win32',
  });

  assert.deepEqual(command, {
    packageJsonPath: 'D:\\My Program\\HGsh1.0\\taro-mobile\\package.json',
    scriptName: 'build:weapp',
    command: 'node',
    args: ['./node_modules/@tarojs/cli/bin/taro', 'build', '--type', 'weapp'],
    cwd: 'D:\\My Program\\HGsh1.0\\taro-mobile',
    mode: 'direct-weapp-build',
  });
});

test('resolvePreferredBuildCommand falls back to npm script when direct weapp build is unavailable', () => {
  const command = resolvePreferredBuildCommand({
    projectPath: 'D:\\My Program\\HGsh1.0',
    rootScripts: { build: 'vite build' },
    mobileScripts: {},
    platform: 'win32',
  });

  assert.deepEqual(command, {
    packageJsonPath: 'D:\\My Program\\HGsh1.0\\package.json',
    scriptName: 'build',
    command: 'npm.cmd',
    args: ['run', 'build'],
    cwd: 'D:\\My Program\\HGsh1.0',
    mode: 'npm-script',
  });
});
