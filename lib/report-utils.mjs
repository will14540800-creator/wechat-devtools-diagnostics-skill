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
  const isWindowsBatch = platform === 'win32' && /\.(cmd|bat)$/iu.test(String(command));

  if (!isWindowsBatch) {
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
