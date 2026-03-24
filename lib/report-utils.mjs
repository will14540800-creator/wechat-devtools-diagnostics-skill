export function detectCliPort(rawValue) {
  const normalized = String(rawValue ?? '').trim();
  if (!/^\d+$/.test(normalized)) {
    return null;
  }

  const port = Number.parseInt(normalized, 10);
  if (port < 1 || port > 65535) {
    return null;
  }

  return port;
}

function quoteWindowsArg(value) {
  const text = String(value ?? '');
  if (text.length === 0) {
    return '""';
  }

  return `"${text.replace(/"/gu, '\\"')}"`;
}

export function buildCommandInvocation(platform, command, args = []) {
  const normalizedArgs = Array.isArray(args) ? args.map((item) => String(item)) : [];
  const commandName = String(command ?? '').split(/[\\/]/u).pop()?.toLowerCase() ?? '';
  const isWindowsBatch = platform === 'win32' && /\.(cmd|bat)$/iu.test(String(command));
  const isNpmLikeBatch = /^(npm|npx)(\.cmd|\.bat)?$/iu.test(commandName);

  if (!isWindowsBatch || isNpmLikeBatch) {
    return {
      command,
      args: normalizedArgs,
      options: {},
    };
  }

  const fullCommand = `call ${[quoteWindowsArg(command), ...normalizedArgs.map(quoteWindowsArg)].join(' ')}`;
  return {
    command: 'cmd.exe',
    args: ['/d', '/s', '/c', fullCommand],
    options: {
      windowsVerbatimArguments: true,
    },
  };
}

export function determineDevtoolsOpenAction({ projectPath, windows = [] }) {
  const normalizedProjectName = String(projectPath ?? '')
    .split(/[\\/]/u)
    .filter(Boolean)
    .pop()
    ?.toLowerCase() ?? '';

  if (!Array.isArray(windows) || windows.length === 0) {
    return 'launch-target-project';
  }

  const hasTargetWindow = windows.some((item) =>
    String(item?.title ?? '').toLowerCase().includes(normalizedProjectName),
  );

  if (hasTargetWindow) {
    return 'refresh-existing-project';
  }

  return 'switch-to-target-project';
}

export function buildDevtoolsCliPlan({ action, projectPath }) {
  if (action === 'refresh-existing-project') {
    return [];
  }

  if (action === 'switch-to-target-project') {
    return [
      ['open-other', '--project', projectPath, '--debug'],
    ];
  }

  return [
    ['open', '--project', projectPath, '--debug'],
  ];
}

export function pickLatestExistingPath(candidates) {
  const existing = candidates.filter((item) => item?.exists);
  if (existing.length === 0) {
    return null;
  }

  existing.sort((left, right) => right.mtimeMs - left.mtimeMs);
  return existing[0].path;
}

export function trimEntries(entries, maxCount = 50) {
  if (!Array.isArray(entries) || maxCount <= 0) {
    return [];
  }

  return entries.slice(-maxCount);
}

export function summarizeTextBlock(value, lineLimit = 80) {
  const lines = String(value ?? '')
    .split(/\r?\n/u)
    .map((line) => line.trimEnd())
    .filter(Boolean);

  if (lines.length === 0) {
    return '';
  }

  return lines.slice(-lineLimit).join('\n');
}

export function resolvePreferredBuildCommand({ projectPath, rootScripts = {}, mobileScripts = {}, platform = process.platform }) {
  if (mobileScripts['build:weapp']) {
    return {
      packageJsonPath: joinPath(projectPath, 'taro-mobile/package.json', platform),
      scriptName: 'build:weapp',
      command: 'node',
      args: ['./node_modules/@tarojs/cli/bin/taro', 'build', '--type', 'weapp'],
      cwd: joinPath(projectPath, 'taro-mobile', platform),
      mode: 'direct-weapp-build',
    };
  }

  const preferredScripts = ['mobile:build', 'build:weapp', 'weapp:build', 'build'];
  for (const scriptName of preferredScripts) {
    if (rootScripts[scriptName]) {
      return {
        packageJsonPath: joinPath(projectPath, 'package.json', platform),
        scriptName,
        command: platform === 'win32' ? 'npm.cmd' : 'npm',
        args: ['run', scriptName],
        cwd: projectPath,
        mode: 'npm-script',
      };
    }
  }

  return null;
}

function pathSep(platform) {
  return platform === 'win32' ? '\\' : '/';
}

function joinPath(basePath, childPath, platform) {
  const separator = pathSep(platform);
  const normalizedBase = String(basePath ?? '').replace(/[\\/]+$/u, '');
  return `${normalizedBase}${separator}${String(childPath).replace(/[\\/]/gu, separator)}`;
}

function parseLauncherTimestamp(line) {
  const match = String(line ?? '').match(
    /^\[LAUNCHER\](\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})/u,
  );

  if (!match) {
    return null;
  }

  const [, year, month, day, hour, minute, second] = match;
  return new Date(
    Number.parseInt(year, 10),
    Number.parseInt(month, 10) - 1,
    Number.parseInt(day, 10),
    Number.parseInt(hour, 10),
    Number.parseInt(minute, 10),
    Number.parseInt(second, 10),
  );
}

export function filterLauncherLogSince(value, startedAt, lineLimit = 120) {
  if (!(startedAt instanceof Date) || Number.isNaN(startedAt.valueOf())) {
    return summarizeTextBlock(value, lineLimit);
  }

  const lines = String(value ?? '')
    .split(/\r?\n/u)
    .map((line) => line.trimEnd())
    .filter(Boolean);

  if (lines.length === 0) {
    return '';
  }

  const filtered = lines.filter((line) => {
    const timestamp = parseLauncherTimestamp(line);
    return timestamp && timestamp >= startedAt;
  });

  if (filtered.length === 0) {
    return '';
  }

  return filtered.slice(-lineLimit).join('\n');
}
