import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCommandInvocation,
  detectCliPort,
  determineDevtoolsOpenAction,
  pickLatestExistingPath,
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
