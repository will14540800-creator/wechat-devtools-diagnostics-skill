---
name: wechat-devtools-diagnostics
description: Use when developing or debugging WeChat Mini Programs on Windows with WeChat DevTools installed, and you need unattended collection of preview screenshots, compile failures, console output, page state, or IDE logs without relying on manual screenshots.
---

# WeChat DevTools Diagnostics

## Overview
This skill turns WeChat DevTools into a machine-readable debug source.

When the target project is already open, it triggers the same in-IDE compile path as manual `Ctrl+B`, waits for the DevTools log signature `restart appservice compile -> webview page ready`, then collects DevTools feedback, logs, and screenshots into one structured report.

## Agent Invocation
Use the skill name explicitly so the agent follows the full workflow.

Recommended prompt:
`Use wechat-devtools-diagnostics to diagnose the WeChat Mini Program at "<project-path>". If the project is already open in DevTools, reproduce the native refresh, then collect DevTools state, logs, compile feedback, screenshots, and produce the structured report.`

Short form:
`Use wechat-devtools-diagnostics on "<project-path>".`

Example for this workspace:
`Use wechat-devtools-diagnostics on "D:\My Program\HGsh1.0".`

## Default Behavior
Agents should assume the helper does all of this automatically:
- If WeChat DevTools is not open, open the target project automatically.
- If the target project is already open, do not relaunch DevTools; trigger the native DevTools refresh path and wait for the matching WeappLog signature.
- If DevTools is open on the project selector or another project, switch to the target project instead of restarting the IDE.
- Record the WeappLog slice produced by that refresh so later agents can read the actual DevTools feedback instead of guessing.
- Try automation collection first, then fall back to logs and whole-window capture.
- Keep runtime probes conservative by default: capture current page route/data/size, but skip `systemInfo()` and Mini Program in-app screenshots unless they are explicitly requested, because they can add deprecation warnings to the DevTools Console.
- Write artifacts outside the project tree by default, under the user's `.codex-artifacts/wechat-devtools/`, so DevTools file watching does not trigger extra recompiles.

## When to Use
- Mini Program preview is blank, broken, or stuck loading.
- Codex needs current page route, `data`, screenshot, or recent console output.
- Compilation fails in WeChat DevTools but terminal output alone is not enough.
- You want unattended diagnosis during iterative development on Windows.

Do not use this skill when WeChat DevTools is not installed locally, or when the project is not a WeChat Mini Program.

## Quick Start
1. Install the helper dependency once:
   `cd C:\Users\xiaox\.codex\skills\wechat-devtools-diagnostics && npm install`
2. Generate a diagnostic bundle for the current project:
   `node C:\Users\xiaox\.codex\skills\wechat-devtools-diagnostics\scripts\collect-wechat-devtools-context.mjs --project "<project-path>" --with-preview`
3. Read the generated JSON report and the image artifacts under the generated output directory.

## What Agents Should Say
Prefer direct requests, not vague debugging prompts.

Good:
- `Use wechat-devtools-diagnostics on "D:\My Program\HGsh1.0" and tell me the root cause from the generated report.`
- `Use wechat-devtools-diagnostics, reproduce the native DevTools refresh, then inspect DevTools errors for "D:\My Program\HGsh1.0".`

Bad:
- `Look into the mini program.`
- `Maybe check DevTools.`
- `See if there are errors somewhere.`

## What It Collects
- CLI results from `open`, `auto`, and optional `preview`
- Native refresh attempts and the matched WeappLog signature under `refreshAction`
- Recent WeappLog lines for the current refresh under `logs.weapp`
- Current Mini Program page stack and current route when automation is available
- Current page `data()` and page size when available
- Mini Program screenshot via `miniprogram-automator` when available
- Full IDE window screenshot via PowerShell screen capture
- Recent `launch.log`
- Latest editor log under `Default\Editor\logs`
- Runtime `log` and `exception` events emitted by `miniprogram-automator`
- DevTools state summary describing whether the helper launched, switched, or refreshed the target project

## Workflow
1. Run the helper script before guessing at the root cause.
2. Read `diagnosis.summary` and `diagnosis.findings` first.
3. If needed, correlate:
   `refreshAction` and `logs.weapp`
   CLI output for project open / automation state
   Mini Program `exceptions` or `logs`
   `launch.log` and editor log tail
4. Use screenshots last, as confirmation rather than as the primary data source.

## Commands
Install dependency:

```bash
cd C:\Users\xiaox\.codex\skills\wechat-devtools-diagnostics
npm install
```

Collect diagnostics:

```bash
node C:\Users\xiaox\.codex\skills\wechat-devtools-diagnostics\scripts\collect-wechat-devtools-context.mjs --project "D:\My Program\HGsh1.0" --with-preview
```

Optional runtime probes that may add DevTools Console noise:

```bash
node C:\Users\xiaox\.codex\skills\wechat-devtools-diagnostics\scripts\collect-wechat-devtools-context.mjs --project "D:\My Program\HGsh1.0" --include-system-info --include-miniprogram-screenshot
```

Run tests:

```bash
cd C:\Users\xiaox\.codex\skills\wechat-devtools-diagnostics
npm test
```

## Expected Outputs
- `devtools-diagnostic-report.json`
- `miniprogram-preview.png`
- `devtools-window.png`
- Optional `preview-info.json`

Default output directory:
`%USERPROFILE%\\.codex-artifacts\\wechat-devtools\\<project-name>-<hash>`

Read these report fields first:
- `diagnosis.summary`
- `diagnosis.findings`
- `refreshAction`
- `logs.weapp`
- `projectHints`
- `devtoolsState`

## Common Mistakes
| Mistake | Fix |
|--------|-----|
| Reading screenshots first | Start with the JSON report and logs, then confirm visually |
| Assuming terminal errors equal DevTools errors | Correlate CLI output with `launch.log`, automation state, and build results |
| Skipping `auto` mode | Run `cli auto` so the tool exposes automation hooks |
| Treating a blank preview as purely UI | Check `currentPage`, `pageStack`, `diagnosis`, and build results before changing layout code |
| Reopening DevTools every time | If the target project is already open, refresh it instead of relaunching the IDE |
| Reporting only `currentPage=null` | Read `diagnosis`, `projectHints`, `preflightReload`, and `buildFallback` before summarizing the root cause |

## Red Flags
- `miniprogram-automator not available`
- `WeChat DevTools install path not found`
- `WeChat DevTools window not found`
- `AUTOMATION_CONNECT_FAILED`
- `BUILD_COMMAND_FAILED`

These mean the report is incomplete or blocked by environment issues. Fix the environment gap before trusting the diagnosis.
