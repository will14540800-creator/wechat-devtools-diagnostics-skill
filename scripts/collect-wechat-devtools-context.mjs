import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import {
  buildCommandInvocation,
  buildDevtoolsCliPlan,
  detectCliPort,
  determineDevtoolsOpenAction,
  filterLauncherLogSince,
  pickLatestExistingPath,
  resolvePreferredBuildCommand,
  summarizeTextBlock,
  trimEntries,
} from '../lib/report-utils.mjs';

const require = createRequire(import.meta.url);
const CONNECTION_CLOSED_PATTERN = /Connection closed, check if wechat web devTools is still running/u;

process.on('unhandledRejection', (error) => {
  if (CONNECTION_CLOSED_PATTERN.test(String(error?.message ?? error))) {
    return;
  }

  throw error;
});

process.on('uncaughtException', (error) => {
  if (CONNECTION_CLOSED_PATTERN.test(String(error?.message ?? error))) {
    process.exit(0);
  }

  throw error;
});

function parseArgs(argv) {
  const parsed = {
    project: process.cwd(),
    outputDir: path.join(process.cwd(), '.codex-artifacts', 'wechat-devtools'),
    autoPort: 9420,
    settleMs: 2500,
    withPreview: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--project') {
      parsed.project = argv[index + 1];
      index += 1;
    } else if (token === '--output-dir') {
      parsed.outputDir = argv[index + 1];
      index += 1;
    } else if (token === '--auto-port') {
      parsed.autoPort = Number.parseInt(argv[index + 1], 10);
      index += 1;
    } else if (token === '--settle-ms') {
      parsed.settleMs = Number.parseInt(argv[index + 1], 10);
      index += 1;
    } else if (token === '--with-preview') {
      parsed.withPreview = true;
    }
  }

  return parsed;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout(label, task, timeoutMs = 15000) {
  let timer;
  try {
    return await Promise.race([
      task(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readUtf8Safe(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function listDirectories(dirPath) {
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(dirPath, entry.name));
  } catch {
    return [];
  }
}

function findDevToolsRoot() {
  const candidates = [
    process.env.WX_DEVTOOLS_DIR,
    'C:\\Program Files (x86)\\Tencent\\微信web开发者工具',
    'C:\\Program Files\\Tencent\\微信web开发者工具',
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'cli.bat'))) {
      return candidate;
    }
  }

  throw new Error('WeChat DevTools install path not found.');
}

function resolveUserDataRoot() {
  const localAppData = process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');
  return path.join(localAppData, '微信开发者工具', 'User Data');
}

function resolveHashedProfiles(userDataRoot) {
  return listDirectories(userDataRoot).filter((dirPath) => /^[0-9a-f]{32}$/iu.test(path.basename(dirPath)));
}

function detectPortFromProfiles(profileDirs) {
  const candidates = profileDirs.map((profileDir) => {
    const cliPath = path.join(profileDir, 'Default', '.cli');
    return {
      path: cliPath,
      exists: fs.existsSync(cliPath),
      mtimeMs: fs.existsSync(cliPath) ? fs.statSync(cliPath).mtimeMs : 0,
    };
  });

  const latestCliFile = pickLatestExistingPath(candidates);
  if (!latestCliFile) {
    return null;
  }

  return detectCliPort(readUtf8Safe(latestCliFile));
}

function runCli(cliPath, args, options = {}) {
  const invocation = buildCommandInvocation(process.platform, cliPath, args);
  const result = spawnSync(invocation.command, invocation.args, {
    encoding: 'utf8',
    cwd: options.cwd ?? process.cwd(),
    timeout: options.timeout ?? 120000,
    ...invocation.options,
  });

  return {
    args,
    spawnedCommand: invocation.command,
    spawnedArgs: invocation.args,
    status: result.status,
    stdout: summarizeTextBlock(result.stdout, 120),
    stderr: summarizeTextBlock(result.stderr, 120),
    error: result.error ? String(result.error.message ?? result.error) : null,
  };
}

async function runDevtoolsCliPlan(cliPath, plan, options = {}) {
  if (!Array.isArray(plan) || plan.length === 0) {
    return {
      status: 0,
      args: [],
      stdout: 'skipped project-open CLI because target project is already open; using external rebuild only',
      stderr: '',
      error: null,
      steps: [],
    };
  }

  const steps = [];

  for (const args of plan) {
    const result = runCli(cliPath, args, options);
    steps.push(result);

    if (result.status !== 0) {
      return {
        status: result.status,
        args: plan.flat(),
        stdout: steps.map((item) => item.stdout).filter(Boolean).join('\n'),
        stderr: steps.map((item) => item.stderr).filter(Boolean).join('\n'),
        error: steps.map((item) => item.error).filter(Boolean).join('\n') || null,
        steps,
      };
    }

    await sleep(options.stepDelayMs ?? 1500);
  }

  return {
    status: 0,
    args: plan.flat(),
    stdout: steps.map((item) => item.stdout).filter(Boolean).join('\n'),
    stderr: steps.map((item) => item.stderr).filter(Boolean).join('\n'),
    error: steps.map((item) => item.error).filter(Boolean).join('\n') || null,
    steps,
  };
}

function runBuildCommand(buildCommand, options = {}) {
  if (!buildCommand) {
    return null;
  }

  const commandName = String(buildCommand.command ?? '').split(/[\\/]/u).pop()?.toLowerCase() ?? '';
  if (process.platform === 'win32' && /^(npm|npx)(\.cmd|\.bat)?$/iu.test(commandName)) {
    const escapedArgs = (buildCommand.args ?? [])
      .map((item) => String(item).replace(/'/gu, "''"))
      .map((item) => `'${item}'`)
      .join(' ');

    return runCli(
      'powershell',
      ['-NoProfile', '-Command', `& ${commandName} ${escapedArgs}`],
      options,
    );
  }

  return runCli(buildCommand.command, buildCommand.args, options);
}

function collectLaunchLog(profileDirs, startedAt) {
  const candidates = profileDirs.map((profileDir) => {
    const launchPath = path.join(profileDir, 'WeappLog', 'launch.log');
    return {
      path: launchPath,
      exists: fs.existsSync(launchPath),
      mtimeMs: fs.existsSync(launchPath) ? fs.statSync(launchPath).mtimeMs : 0,
    };
  });

  const latestPath = pickLatestExistingPath(candidates);
  return latestPath ? filterLauncherLogSince(readUtf8Safe(latestPath), startedAt, 120) : '';
}

function collectEditorLogs(profileDirs) {
  const candidates = [];

  for (const profileDir of profileDirs) {
    const logsRoot = path.join(profileDir, 'Default', 'Editor', 'logs');
    for (const logDir of listDirectories(logsRoot)) {
      const files = fs.readdirSync(logDir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && /\.(log|txt)$/iu.test(entry.name))
        .map((entry) => path.join(logDir, entry.name));

      for (const filePath of files) {
        candidates.push({
          path: filePath,
          exists: true,
          mtimeMs: fs.statSync(filePath).mtimeMs,
        });
      }
    }
  }

  const latestPath = pickLatestExistingPath(candidates);
  return latestPath ? summarizeTextBlock(readUtf8Safe(latestPath), 120) : '';
}

function normalizeEvent(value) {
  if (value instanceof Error) {
    return {
      message: value.message,
      stack: value.stack,
    };
  }

  if (typeof value === 'string') {
    return { message: value };
  }

  return value;
}

function captureIdeWindow(scriptPath, outputPath) {
  const result = spawnSync(
    'powershell',
    [
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      scriptPath,
      '-OutputPath',
      outputPath,
    ],
    {
      encoding: 'utf8',
      timeout: 30000,
    },
  );

  return {
    status: result.status,
    stdout: summarizeTextBlock(result.stdout, 20),
    stderr: summarizeTextBlock(result.stderr, 20),
  };
}

function readDevtoolsWindows() {
  const script = [
    'Get-Process',
    "| Where-Object { ($_.ProcessName -eq 'wechatdevtools' -or $_.ProcessName -eq '微信开发者工具') -and $_.MainWindowHandle -ne 0 }",
    '| Select-Object ProcessName,Id,MainWindowTitle,Path',
    '| ConvertTo-Json -Compress',
  ].join(' ');

  const result = spawnSync('powershell', ['-NoProfile', '-Command', script], {
    encoding: 'utf8',
    timeout: 10000,
  });

  if (result.status !== 0 || !result.stdout.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(result.stdout);
    const items = Array.isArray(parsed) ? parsed : [parsed];
    return items.map((item) => ({
      processName: item.ProcessName,
      id: item.Id,
      title: item.MainWindowTitle,
      path: item.Path,
    }));
  } catch {
    return [];
  }
}

function collectProjectHints(projectPath) {
  const projectConfigPath = path.join(projectPath, 'project.config.json');
  const hints = {
    projectConfigPath,
    miniprogramRoot: null,
    miniprogramRootExists: null,
    miniprogramAppJsonPath: null,
    miniprogramAppJsonExists: null,
    discoveredAppJson: [],
    warnings: [],
  };

  if (!fs.existsSync(projectConfigPath)) {
    hints.warnings.push('project.config.json not found');
    return hints;
  }

  try {
    const projectConfig = JSON.parse(readUtf8Safe(projectConfigPath));
    const miniprogramRoot = projectConfig.miniprogramRoot ?? '';
    hints.miniprogramRoot = miniprogramRoot;

    if (miniprogramRoot) {
      const resolvedRoot = path.resolve(projectPath, miniprogramRoot);
      hints.miniprogramRootExists = fs.existsSync(resolvedRoot);
      hints.miniprogramAppJsonPath = path.join(resolvedRoot, 'app.json');
      hints.miniprogramAppJsonExists = fs.existsSync(hints.miniprogramAppJsonPath);
      if (!hints.miniprogramRootExists) {
        hints.warnings.push(`miniprogramRoot does not exist: ${resolvedRoot}`);
      } else if (!hints.miniprogramAppJsonExists) {
        hints.warnings.push(`app.json not found under miniprogramRoot: ${hints.miniprogramAppJsonPath}`);
      }
    }
  } catch (error) {
    hints.warnings.push(`failed to parse project.config.json: ${error.message}`);
  }

  const appJsonCandidates = [
    path.join(projectPath, 'app.json'),
    path.join(projectPath, 'miniprogram', 'app.json'),
    path.join(projectPath, 'src', 'app.json'),
  ].filter((candidate, index, all) => all.indexOf(candidate) === index);

  hints.discoveredAppJson = appJsonCandidates.filter((candidate) => fs.existsSync(candidate));
  if (hints.discoveredAppJson.length === 0) {
    hints.warnings.push('no app.json discovered in common Mini Program locations');
  }

  return hints;
}

function detectBuildCommand(projectPath) {
  const rootPackageJsonPath = path.join(projectPath, 'package.json');
  const mobilePackageJsonPath = path.join(projectPath, 'taro-mobile', 'package.json');

  try {
    const rootScripts = fs.existsSync(rootPackageJsonPath)
      ? JSON.parse(readUtf8Safe(rootPackageJsonPath)).scripts ?? {}
      : {};
    const mobileScripts = fs.existsSync(mobilePackageJsonPath)
      ? JSON.parse(readUtf8Safe(mobilePackageJsonPath)).scripts ?? {}
      : {};

    return resolvePreferredBuildCommand({
      projectPath,
      rootScripts,
      mobileScripts,
      platform: process.platform,
    });
  } catch {
    return null;
  }
}

function buildDiagnosis({ projectHints, cli, miniProgram, logs, buildFallback, preflightReload }) {
  const findings = [];
  const recommendations = [];

  if (projectHints?.miniprogramRoot && projectHints?.miniprogramAppJsonExists === false) {
    findings.push({
      severity: 'high',
      code: 'MINIPROGRAM_ROOT_APP_JSON_MISSING',
      message: `project.config.json points miniprogramRoot to "${projectHints.miniprogramRoot}", but app.json is missing under that directory.`,
      evidence: projectHints.miniprogramAppJsonPath,
    });
    recommendations.push(
      `Fix project.config.json miniprogramRoot or ensure ${projectHints.miniprogramAppJsonPath} exists.`,
    );
  }

  if (miniProgram?.warning) {
    findings.push({
      severity: 'medium',
      code: 'AUTOMATION_CONNECT_FAILED',
      message: miniProgram.warning,
      evidence: `autoPort=${miniProgram.warning.includes('ws://') ? miniProgram.warning.match(/ws:\/\/127\.0\.0\.1:\d+/u)?.[0] ?? 'unknown' : 'unknown'}`,
    });
    recommendations.push('Re-run DevTools automation enablement before relying on currentPage or screenshot collection.');
  }

  if ((miniProgram?.pageStack?.length ?? 0) === 0 && !miniProgram?.currentPage) {
    findings.push({
      severity: 'medium',
      code: 'NO_RUNNING_PAGE_CONTEXT',
      message: 'Automation connected, but no Mini Program page context was available.',
      evidence: 'pageStack=[] and currentPage=null',
    });
  }

  const textBlobs = [
    cli?.open?.stdout,
    cli?.open?.stderr,
    cli?.auto?.stdout,
    cli?.auto?.stderr,
    cli?.preview?.stdout,
    cli?.preview?.stderr,
    logs?.launch,
    logs?.editor,
    buildFallback?.stdout,
    buildFallback?.stderr,
  ]
    .filter(Boolean)
    .join('\n');

  if (/app\.json/i.test(textBlobs) && /miniprogramRoot/i.test(textBlobs)) {
    findings.push({
      severity: 'high',
      code: 'DEVTOOLS_REPORTED_PROJECT_CONFIG_ERROR',
      message: 'WeChat DevTools logs indicate a project.config.json and app.json mismatch.',
      evidence: 'Detected app.json + miniprogramRoot error markers in collected output',
    });
  }

  if (findings.length === 0) {
    findings.push({
      severity: 'info',
      code: 'NO_EXPLICIT_ROOT_CAUSE',
      message: 'No explicit root cause was extracted from project hints, CLI output, or logs.',
      evidence: 'Fallback diagnosis only',
    });
  }

  if (buildFallback?.status && buildFallback.status !== 0) {
    findings.unshift({
      severity: 'high',
      code: 'BUILD_COMMAND_FAILED',
      message: `Fallback build command failed: ${buildFallback.args.join(' ')}`,
      evidence: buildFallback.stderr || buildFallback.stdout || `exit status ${buildFallback.status}`,
    });
    recommendations.unshift('Fix the build failure before expecting DevTools automation to expose currentPage.');
  }

  if (buildFallback?.status === 0) {
    findings.push({
      severity: 'info',
      code: 'BUILD_SUCCEEDED',
      message: 'Fallback Mini Program build completed successfully.',
      evidence: buildFallback.stdout || 'build command exited with status 0',
    });
    recommendations.push('Treat compile failure as unlikely; inspect DevTools runtime state, simulator state, or automation exposure next.');
  }

  if (preflightReload?.status === 0) {
    findings.push({
      severity: 'info',
      code: 'PREFLIGHT_RELOAD_SUCCEEDED',
      message: 'A preflight rebuild completed before diagnostics collection.',
      evidence: preflightReload.stdout || 'preflight reload exited with status 0',
    });
  }

  if (recommendations.length === 0 && findings.some((item) => item.code === 'NO_RUNNING_PAGE_CONTEXT')) {
    recommendations.push('Inspect compile output and DevTools console before treating this as a rendering-only issue.');
  }

  const primaryFinding = findings.find((item) => item.severity === 'high') ?? findings[0];
  return {
    summary: primaryFinding.message,
    findings,
    recommendations,
  };
}

async function collectMiniProgramSnapshot({ autoPort, outputDir, settleMs }) {
  let automator;
  try {
    automator = require('miniprogram-automator');
  } catch (error) {
    return {
      warning: `miniprogram-automator not available: ${error.message}`,
    };
  }

  const logs = [];
  const exceptions = [];

  let miniProgram;
  try {
    miniProgram = await withTimeout(
      'automator.connect',
      () => automator.connect({ wsEndpoint: `ws://127.0.0.1:${autoPort}` }),
      15000,
    );
  } catch (error) {
    return {
      warning: `automation connect failed: ${error.message}`,
      pageStack: [],
      currentPage: null,
      systemInfo: null,
      screenshotPath: null,
      logs: [],
      exceptions: [],
    };
  }

  const pushLog = (...items) => {
    logs.push({
      ts: Date.now(),
      payload: items.map(normalizeEvent),
    });
  };

  const pushException = (...items) => {
    exceptions.push({
      ts: Date.now(),
      payload: items.map(normalizeEvent),
    });
  };

  miniProgram.on('log', pushLog);
  miniProgram.on('exception', pushException);
  miniProgram.on('console', pushLog);
  miniProgram.on('error', pushException);

  await sleep(settleMs);

  const pageStack = await withTimeout('miniProgram.pageStack', () => miniProgram.pageStack(), 10000)
    .catch(() => []);
  const currentPage = await withTimeout('miniProgram.currentPage', () => miniProgram.currentPage(), 10000)
    .catch(() => null);
  const screenshotPath = path.join(outputDir, 'miniprogram-preview.png');

  const snapshot = {
    pageStack: pageStack.map((page) => ({ path: page.path, query: page.query })),
    currentPage: null,
    systemInfo: null,
    screenshotPath: null,
    logs: trimEntries(logs, 50),
    exceptions: trimEntries(exceptions, 20),
  };

  try {
    snapshot.systemInfo = await withTimeout('miniProgram.systemInfo', () => miniProgram.systemInfo(), 10000);
  } catch {
    snapshot.systemInfo = null;
  }

  if (currentPage) {
    const pageData = await withTimeout('currentPage.data', () => currentPage.data(), 10000).catch(() => null);
    const pageSize = await withTimeout('currentPage.size', () => currentPage.size(), 10000).catch(() => null);
    snapshot.currentPage = {
      path: currentPage.path,
      query: currentPage.query,
      data: pageData,
      size: pageSize,
    };
  }

  try {
    await withTimeout('miniProgram.screenshot', () => miniProgram.screenshot({ path: screenshotPath }), 15000);
    snapshot.screenshotPath = screenshotPath;
  } catch {
    snapshot.screenshotPath = null;
  }

  try {
    miniProgram.disconnect();
  } catch {
    // ignore disconnect failures
  }
  return snapshot;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sessionStartedAt = new Date();
  const projectPath = path.resolve(args.project);
  const outputDir = path.resolve(args.outputDir);
  ensureDir(outputDir);

  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const devToolsRoot = findDevToolsRoot();
  const cliPath = path.join(devToolsRoot, 'cli.bat');
  const userDataRoot = resolveUserDataRoot();
  const profileDirs = resolveHashedProfiles(userDataRoot);
  const autoPort = args.autoPort || 9420;
  const buildCommand = detectBuildCommand(projectPath);
  const devtoolsWindows = readDevtoolsWindows();
  const devtoolsOpenAction = determineDevtoolsOpenAction({
    projectPath,
    windows: devtoolsWindows,
  });
  const devtoolsCliPlan = buildDevtoolsCliPlan({
    action: devtoolsOpenAction,
    projectPath,
  });
  const reuseOpenProject = devtoolsOpenAction === 'refresh-existing-project';

  // Hot-reload surrogate: rebuild first so diagnostics read the latest generated output
  // instead of stale DevTools cache state.
  const preflightReload = buildCommand
    ? runBuildCommand(buildCommand, {
        cwd: buildCommand.cwd ?? projectPath,
        timeout: 180000,
      })
    : null;

  if (preflightReload?.status === 0) {
    await sleep(1500);
  }

  const cliOpen = await runDevtoolsCliPlan(
    cliPath,
    devtoolsCliPlan,
    { cwd: projectPath, stepDelayMs: 2000 },
  );

  const cliAuto = reuseOpenProject
    ? null
    : runCli(
        cliPath,
        ['auto', '--project', projectPath, '--auto-port', String(autoPort), '--debug', '--trust-project'],
        { cwd: projectPath },
      );

  const cliPreview = args.withPreview && !reuseOpenProject
    ? runCli(
        cliPath,
        ['preview', '--project', projectPath, '--debug', '--info-output', path.join(outputDir, 'preview-info.json')],
        { cwd: projectPath },
      )
    : null;

  const miniProgram = await collectMiniProgramSnapshot({
    autoPort,
    outputDir,
    settleMs: args.settleMs,
  });

  const buildFallback =
    !miniProgram.currentPage && buildCommand
      ? runBuildCommand(buildCommand, {
          cwd: buildCommand.cwd ?? projectPath,
          timeout: 180000,
        })
      : null;

  const ideScreenshotPath = path.join(outputDir, 'devtools-window.png');
  const ideScreenshot = captureIdeWindow(
    path.join(scriptDir, 'capture-wechat-devtools-window.ps1'),
    ideScreenshotPath,
  );

  const report = {
    sessionStartedAt: sessionStartedAt.toISOString(),
    createdAt: new Date().toISOString(),
    projectPath,
    autoPort,
    devToolsRoot,
    devtoolsState: {
      action: devtoolsOpenAction,
      cliPlan: devtoolsCliPlan,
      windows: devtoolsWindows,
    },
    projectHints: collectProjectHints(projectPath),
    buildCommand,
    preflightReload,
    cli: {
      open: cliOpen,
      auto: cliAuto,
      preview: cliPreview,
    },
    buildFallback,
    artifacts: {
      outputDir,
      ideScreenshotPath: ideScreenshot.status === 0 ? ideScreenshotPath : null,
      miniProgramScreenshotPath: miniProgram.screenshotPath ?? null,
    },
    miniProgram,
    logs: {
      launch: collectLaunchLog(profileDirs, sessionStartedAt),
      editor: collectEditorLogs(profileDirs),
      ideScreenshot,
    },
  };

  report.diagnosis = buildDiagnosis(report);

  const reportPath = path.join(outputDir, 'devtools-diagnostic-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  process.stdout.write(`${reportPath}\n`);
}

main().catch((error) => {
  console.error(error?.stack ?? error);
  process.exitCode = 1;
});
