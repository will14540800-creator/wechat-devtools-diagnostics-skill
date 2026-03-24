# WeChat DevTools Diagnostics Skill

A portable Windows-focused skill for unattended WeChat Mini Program diagnostics.

It is designed for Codex, Claude Code, Cursor-style agents, custom IDE assistants, and any local model runner that can read a prompt file and execute local scripts.

## Current Behavior
- Reuses an already-open WeChat DevTools window instead of relaunching it.
- Reproduces native compile with `Ctrl+B` when the target project is already open.
- Waits for the DevTools log signature `restart appservice compile -> webview page ready`.
- Connects to the real Mini Program automation port and captures current route, page data, and page size.
- Captures the full DevTools window.
- Uses a low-noise default mode: skips `systemInfo()` and Mini Program in-app screenshots unless explicitly requested, because those runtime probes can add duplicate deprecation warnings to the DevTools Console.

## Main Files
- `SKILL.md`
  Primary instructions for skill-aware agents.
- `scripts/collect-wechat-devtools-context.mjs`
  Main diagnostics entrypoint for any IDE or model runner.
- `scripts/trigger-wechat-devtools-refresh.ps1`
  Sends the native DevTools compile shortcut to the already-open target window.
- `scripts/capture-wechat-devtools-window.ps1`
  Captures the full DevTools window as a PNG.

## Install
```powershell
npm install
```

## Standard Usage
```powershell
node .\scripts\collect-wechat-devtools-context.mjs --project "D:\My Program\HGsh1.0" --with-preview
```

## Optional High-Noise Probes
Only enable these when you explicitly need them:

```powershell
node .\scripts\collect-wechat-devtools-context.mjs --project "D:\My Program\HGsh1.0" --include-system-info --include-miniprogram-screenshot
```

## Output
By default, diagnostics are written outside the project tree:

`%USERPROFILE%\.codex-artifacts\wechat-devtools\<project-name>-<hash>\`

Important files:
- `devtools-diagnostic-report.json`
- `devtools-window.png`
- `miniprogram-preview.png` only when `--include-miniprogram-screenshot` is enabled and succeeds

## IDE Integration
For skill-aware agents:
- Point the agent to `SKILL.md`
- Ask it to use `wechat-devtools-diagnostics` on a target project path

For IDEs or models without native skill loading:
- Read `SKILL.md` as the operational prompt
- Execute `scripts/collect-wechat-devtools-context.mjs`
- Read `devtools-diagnostic-report.json` as the primary machine-readable output

Recommended generic prompt:

`Use the instructions in SKILL.md for this repository, run the diagnostics script against "<project-path>", then summarize the root cause from devtools-diagnostic-report.json.`

## Intended Consumers
- Codex-style skill runners
- Claude Code / Cursor / custom agent shells
- Local automation scripts
- Any model that can be pointed at `SKILL.md` and run local commands
