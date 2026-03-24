# WeChat DevTools Diagnostics Skill

A portable Windows-focused skill for unattended WeChat Mini Program diagnostics.

It is designed for agentic IDEs and models that need a repeatable workflow for:
- hot-reload before diagnostics
- opening or switching WeChat DevTools to the target project
- enabling DevTools automation
- collecting compile output, runtime state, logs, and screenshots
- generating one structured diagnostic report

## Main Files
- `SKILL.md`
  The instruction document for skill-aware agents.
- `scripts/collect-wechat-devtools-context.mjs`
  Main diagnostics entrypoint.
- `scripts/capture-wechat-devtools-window.ps1`
  Whole-window screenshot helper.

## Install
```powershell
npm install
```

## Usage
```powershell
node .\scripts\collect-wechat-devtools-context.mjs --project "D:\My Program\HGsh1.0" --with-preview
```

## Output
By default, diagnostics are written to:

`<project>/.codex-artifacts/wechat-devtools/`

Important files:
- `devtools-diagnostic-report.json`
- `devtools-window.png`
- `miniprogram-preview.png` when automation screenshot succeeds

## Intended Consumers
- Codex-style skill runners
- Custom IDE agents
- Local automation scripts
- Any model that can be pointed at `SKILL.md`
