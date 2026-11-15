# SwitchPilot

<img src="app/build/icon.png" width="96" align="right" alt="">

A Windows tray app that manages several Claude subscription accounts for Claude Code. It shows the 5-hour and 7-day usage of every account. When the current account reaches its limit, it switches to another account, and Claude Code sessions that are already running continue on the new account.

It can also manage Antigravity CLI (`agy`) accounts and route development-workflow stages to Claude or agy models.

The interface is available in English and Traditional Chinese. The app uses the system language by default; you can change it in **Settings → General**.

| Version | Location | Status |
|---|---|---|
| Electron app (recommended) | `app/` | Current version |
| Python app | `switcher/` | Legacy tkinter version, kept as a fallback |

The two versions share the same data files. Run only one of them at a time. The Python app still reads `%USERPROFILE%\.claude-switcher`, which is a junction to the new folder after an upgrade (see below).

## Features

- **Usage overview**: 5-hour and 7-day usage, reset times, and data source for every account. Usage refreshes every 2 minutes.
- **Automatic switching**: when the current account reaches the 5-hour or weekly threshold (each adjustable, default 95%) or Claude Code reports a `rate_limit` error, the app switches to the next available account.
- **Live switching (default)**: the app replaces `~/.claude/.credentials.json`. Claude Code reloads the file before its next request, so running sessions do not restart. A session that stopped on a rate limit receives a "continue" prompt.
- **Restart switching (optional)**: the app closes each running `claude`, switches the account, and resumes the session with `claude --resume`.
- **Claude CLI list**: shows every running `claude` process and its session, including processes that this app did not start.
- **Auto compact**: when a session's context passes a threshold, the app sends `/compact` (or `/clear`) after the turn ends. After a compact, it can also clear the screen (Ctrl+L).
- **agy accounts**: saves, switches, and shows the quota of Antigravity CLI accounts.
- **Model routing and dispatch**: see [Model routing](#model-routing).
- **Tray and autostart**: optional close-to-tray and launch at sign-in.

## Requirements

- Windows 10 or 11
- Node.js 22 or later on `PATH`. The statusline, hook, runner, and dispatch scripts run with the system `node`.
- Claude Code with a Claude Pro or Max subscription
- Windows Terminal (`wt.exe`), optional. If it is not installed, the app opens a console window.
- Antigravity CLI (`agy`), optional, only for agy features

## Install

- **Portable exe**: run `SwitchPilot <version>.exe`. No installation is necessary.
- **From source**:
  ```powershell
  cd app
  npm install
  npm run dev        # run in development mode
  npm run package    # build dist\SwitchPilot <version>.exe
  ```

## Upgrading from Claude Account Switcher

SwitchPilot is the new name of Claude Account Switcher. Your accounts and settings carry over.

1. **Close the old version first** (quit it from the tray). If the old app is still running, it holds files in the data folder, the move fails, and SwitchPilot keeps using the old folder until the next start.
2. **Data folder move.** On the first start, SwitchPilot moves `%USERPROFILE%\.claude-switcher` to `%USERPROFILE%\.switchpilot` and leaves a junction (a folder link) at the old path. Old commands, the installed skill, and the old Python app keep working through the junction. If the move fails, the app logs an event, keeps using the old folder, and tries again on the next start. If the move succeeds but the junction cannot be created, the app logs an event; the Python app then needs `CLAUDE_SWITCHER_HOME` set to `%USERPROFILE%\.switchpilot`.
3. **Claude Code integration.** If the statusline and hooks are installed, the app rewrites their paths in `~/.claude/settings.json` to `~/.switchpilot/bin/...` (with a backup).
4. **Launch at sign-in.** The app removes the old registry entry, so it does not start twice.
5. **Automatic update.** The old app updates to the new version in place. The exe keeps its old file name (for example `Claude-Account-Switcher-1.1.2.exe`) after the update. You can rename it. Downloads of new versions are named `SwitchPilot-<version>.exe`.
6. **Environment variables** use the `SWITCHPILOT_` prefix. The old `CLAUDE_SWITCHER_` names still work.

## First-time setup

1. Open **Accounts** and click **Browser login**. The app opens a Chrome incognito window (you can select Edge InPrivate or the default browser in settings). Sign in, then type a name for the account. This does not change the account that Claude Code currently uses.
2. Repeat step 1 for each account.
3. Open **Settings → Claude Code integration** and click **Install integration**. This adds the `statusLine` command and the `Stop`, `StopFailure`, and `UserPromptSubmit` hooks to `~/.claude/settings.json`. The app makes a backup before it changes the file. Restart Claude Code sessions that were already open.

Alternative: run `/login` in Claude Code, then click **Save current login** in the app.

## How it works

1. **Usage API**: the app reads usage with the token stored for each account. It refreshes the tokens of inactive accounts only. Claude Code refreshes the token of the active account, and the app does not touch it.
2. **Statusline**: the integrated statusline script writes the `rate_limits` and context size that Claude Code reports. The app reads these files every 3 seconds.
3. **Turn end**: the `Stop` hook tells the app that a turn ended. The app switches at the end of a turn, so it does not interrupt work.
4. **Rate-limit fallback**: when the `StopFailure` hook reports `rate_limit`, the app switches immediately.
5. **Before each switch**, the app saves the current credentials back to the slot of the current account, because Claude Code can refresh the token.

## Model routing

`~/.switchpilot/routing.json` lists, for each workflow role, an ordered fallback list of providers and models. You can edit it in **Settings → Model routing**.

Roles: `requirements`, `spec`, `spec_review`, `implement`, `impl_review`, `research`, `docs`.

Example: `implement` uses agy `gemini-3.8-flash-high` first. If agy has no quota, it uses Claude Sonnet. If Claude has no quota on any account, it uses agy `claude-sonnet-4-6`.

The app installs the dispatcher at `~/.switchpilot/bin/switcher-run.cjs`:

```
node ~/.switchpilot/bin/switcher-run.cjs --role <role> --prompt <prompt file> --out <result file> --cwd <project dir> [--allow "<exact command>"]...
```

| Exit code | Meaning |
|---|---|
| `0` | agy completed the task. The answer is in the result file. |
| `10` | Delegate: the next entry is a Claude model, or model routing is turned off. The last JSON line names the model. Run the task with that model. |
| `1` | Failed. Read `message` in the last JSON line and `<result file>.agy.log`. |
| `2` | Invalid arguments |

The **Dispatch** page shows running and recent dispatches.

**Claude Code does not use the routing by itself.** The dispatcher is a command-line tool. Claude Code calls it only when a skill tells it to. This repository includes that skill: [`skills/model-routing/SKILL.md`](skills/model-routing/SKILL.md). The app contains a copy of it and can install it for you.

### Set up model routing (step by step)

Open **Settings → Model routing**. The **Setup guide** card at the top shows each step with its status. Click **Check again** after you complete a step.

1. **Node.js 22 or later.** Install it from [nodejs.org](https://nodejs.org) and make sure `node` is on `PATH`. Restart the app.
2. **Dispatcher.** The app installs `~/.switchpilot/bin/switcher-run.cjs` when it starts. If the step shows as missing, click **Check again** to install it again.
3. **Antigravity CLI (optional).** Only necessary if your routing contains `agy` entries. Install `agy`, then click **Check again**.
4. **agy accounts (optional).** In **Accounts → Google**, save at least one agy account. The dispatcher picks an account with quota.
5. **Install the skill.** Click **Install skill**. The app writes `~/.claude/skills/model-routing/SKILL.md`. If a different version is already there, the app asks first and keeps the old file as `SKILL.md.bak`.
6. **Start using it.** Open a **new** Claude Code session (skills load when a session starts) and ask, for example:
   - `Use the model routing to implement T-1 in docs/spec.md`
   - `依模型分工派工：實作 docs/spec.md 的 T-1`

   Claude Code reads `routing.json`, runs agy entries through the dispatcher, and starts Claude subagents for Claude entries. The **Dispatch** page shows the progress.

To install the skill manually instead, run this in the repository folder:

```powershell
New-Item -ItemType Directory -Force "$HOME\.claude\skills\model-routing" | Out-Null
Copy-Item skills\model-routing\SKILL.md "$HOME\.claude\skills\model-routing\"
```

To use it in one project only, copy the `skills/model-routing` folder to `.claude/skills/` in that project.

### Turn model routing off

If you do not need this feature, turn off **Enable model routing** in **Settings → Model routing**. The app hides the Dispatch page and the routing settings, and asks whether to remove the skill. While it is off, the dispatcher sends every task to Claude (exit code 10).

Account switching, usage display, and auto compact do not need a skill.

## Data locations

- App data: `%USERPROFILE%\.switchpilot\` (`slots\`, `usage_api\`, `usage\`, `events\`, `agy\`, `dispatch\`, `bin\`, `backups\`, `routing.json`). Set `SWITCHPILOT_HOME` to use a different folder. All environment variables use the `SWITCHPILOT_` prefix; the old `CLAUDE_SWITCHER_` names still work, and the new name wins when both are set.
- Claude files that the app changes: `%USERPROFILE%\.claude\.credentials.json`, `%USERPROFILE%\.claude.json` (only `oauthAccount`), and `%USERPROFILE%\.claude\settings.json` (only when you install or remove the integration).
- agy login: Windows Credential Manager entry `gemini:antigravity`.

## Uninstall

1. In **Settings → Claude Code integration**, click **Remove integration**. This restores `settings.json`. The backups are in `%USERPROFILE%\.switchpilot\backups\`.
2. Quit the app from the tray. Delete the `%USERPROFILE%\.switchpilot` folder and the exe.

## Known limitations

- The usage API and token refresh are undocumented interfaces of Claude Code. A Claude Code update can break them. If they fail, the app uses the statusline data, and switching still works.
- After a live switch, the statusline of a running session can report the previous account's limits until its next request. The app ignores statusline data whose reset time does not match the API data.
- The app does not refresh agy tokens. Close all `agy` processes before you switch or add an agy account.
- Windows only. The Claude desktop app and claude.ai are not supported.

## Security

`slots\*.json` and `agy\slots\*.json` contain login tokens. Treat them as passwords. Do not commit them, sync them to cloud storage, or share them. The files are not encrypted; only the permissions of your user folder protect them. Claude tokens are sent only to `api.anthropic.com` and `platform.claude.com`.

## Terms of service

Using several accounts to avoid usage limits can violate the Anthropic and Google terms of service. Check the terms yourself. You use this app at your own risk.

## Python app (legacy)

Run `python -m switcher` or double-click `啟動切換器.bat`. Requires Python 3.13. It has a subset of the features: it shows usage of the active account only, and it supports Edge InPrivate login only.
