---
name: model-routing
description: Delegate development-workflow work (requirements, spec, spec review, implementation, implementation review, research, docs drafts) to Claude or Antigravity CLI (agy) models according to the SwitchPilot routing file ~/.switchpilot/routing.json, falling back to the next model when quota runs out. Use before you start a subagent or hand a task to another model, when the user asks to "use the routing", "dispatch", "send it to agy", or names a workflow role, or when another skill says to delegate a role.
---

# Model routing with SwitchPilot

SwitchPilot stores, for each workflow role, an ordered fallback list of models in `~/.switchpilot/routing.json`. The user edits it in the app (**Settings → Model routing**). The app installs a dispatcher, `~/.switchpilot/bin/switcher-run.cjs`, that runs agy entries and tells you when the task must go to Claude.

Follow this skill every time you delegate a task to another model.

## Prerequisites

- SwitchPilot is installed and has started at least once, so `~/.switchpilot/bin/switcher-run.cjs` exists.
- Node.js 22 or later is on `PATH`.
- For agy entries: Antigravity CLI (`agy`) is installed, and at least one agy account is saved in the app.

If `switcher-run.cjs` does not exist, tell the user and use a Claude subagent for every role.

## Roles

| Role | Use for |
|---|---|
| `requirements` | Requirements definition |
| `spec` | Specification and task breakdown |
| `spec_review` | Review of a requirements or spec document |
| `implement` | Code changes for a spec task |
| `impl_review` | Review of an implementation diff, verification |
| `research` | Looking up documentation or facts |
| `docs` | Drafts of documents |

## Procedure

1. Read `~/.switchpilot/routing.json`. If it does not exist, use a Claude subagent for the task and say so.
2. Find the list for the role. Take the entries in order.
3. **First entry is `provider: "claude"`:**
   - For `requirements` and `spec`, do the work in the main conversation. If the main conversation's model differs from the entry's model, tell the user they can switch with `/model`. Do not force it.
   - For other roles, start a subagent with the entry's `model` (`opus`, `sonnet` or `haiku`).
   - `accounts` has no effect for Claude entries. A subagent always uses the current Claude account.
4. **First entry is `provider: "agy"`:** run the dispatcher. It walks the list for you:
   1. Write a self-contained prompt to a file (see [Prompt rules](#prompt-rules-for-agy)).
   2. Run:
      ```
      node ~/.switchpilot/bin/switcher-run.cjs --role <role> --prompt <prompt file> --out <result file> --cwd <project dir> [--allow "<exact command>"]...
      ```
      Run it in the background when the task is long.
   3. Read the exit code and the last line of stdout, which is JSON: `{status, provider, model, agy_account_email, attempts, message}`.

| Exit code | `status` | Action |
|---|---|---|
| `0` | `ok` | Read the result file. Check the work yourself (see [Check agy output](#check-agy-output)). |
| `10` | `delegate` | All agy entries before the next Claude entry failed or had no quota, or the user turned model routing off in the app. Start a Claude subagent with the JSON `model` and give it the same prompt. |
| `1` | `failed` | Read `message` and `attempts`, and the log `<result file>.agy.log`. See [Failures](#failures). |
| `2` | — | Invalid arguments. Fix the command. |

5. Each time you delegate, tell the user the provider, model and account that ran the task.

### What the dispatcher does

- It skips Claude entries when no Claude account in the app has quota left, and records `claude_exhausted`.
- It picks an agy account with quota from the app's quota cache. It switches the agy login when necessary. Switching requires that no `agy` process is running.
- When an agy account runs out of quota, it tries the next account, then the next entry.
- It does not refresh tokens and does not use the network for quota. If the cache is stale, ask the user to refresh agy quota in the app.

## Prompt rules for agy

agy has no conversation memory and runs headless. A prompt that breaks these rules usually ends with no output.

- **Self-contained**: state the task ID and the completion criteria. List the files to read and to change, the project rules (language, lint, "do not commit"), and what to report.
- **Commands**: agy can run only commands that you pass with `--allow`, and only as the exact same string. Wildcards do not work. In the prompt, write: "Run only these commands, exactly as written: no `cd`, no extra arguments, no pipes, no `2>&1`, no chaining. The working directory is already correct." Then list the commands.
- **Files outside the project**: agy can read only its workspace. Set `AGY_ADD_DIRS` to a `;`-separated list of directories before you run the dispatcher. **Put the project directory first.** agy runs commands in the first added directory, and the command fails with "not a directory" if that entry is a file.
- **Scope**: tell it which files it may change, and "do not create files anywhere else".

Example (PowerShell):

```powershell
$env:AGY_ADD_DIRS = 'C:\work\myapp;C:\work\myapp-docs'
node "$HOME\.switchpilot\bin\switcher-run.cjs" --role implement --prompt docs\prompt-T-1.md --out docs\result-T-1.md --cwd C:\work\myapp --allow "npm test" --allow "npm run typecheck"
```

## Check agy output

Treat agy output as unverified, especially from Gemini Flash models:

- Run the build, type check and tests yourself. agy can report success when checks fail.
- Check that the files it claims to have changed really changed.
- Look for files it created outside the allowed scope, and delete them.
- Have a fresh Claude subagent review the diff for non-trivial changes.

## Failures

| Symptom | Action |
|---|---|
| `outcome: permission_denied` or `soft-denying` in the log | The prompt asked for a command that is not in `--allow`. Fix the prompt or the allow list, then run again. |
| `no output produced` after many steps, no files changed | Run again once. If it fails twice, use a Claude subagent with the next Claude model in the list and tell the user. |
| `RESOURCE_EXHAUSTED (code 429)` | The dispatcher already tried the other accounts and entries. Do not retry; use the delegate or a Claude subagent. |
| `skipped_agy_running`, `agy_busy` | Another `agy` process is running. Wait for it to finish, or ask the user to close it. |
| `no_account` | No agy account is saved. Ask the user to add one in the app, or use Claude. |

## Notes

- Using several accounts to avoid usage limits can violate the Anthropic and Google terms of service. The user decides whether to use this.
- Do not put tokens or credentials in prompts, result files or logs.
