# idd — Intent → Work → Outcome

Boilerplate repo for the **intent stage** of Devstroop's work-driven development
pipeline. Human intent lands in issues/PRs/comments, and a coordinated
workforce (opencode for now, Devstroop Agent SDK later) turns it into work.

```
Intent            →   Work                 →   Outcome
issue / PR /      →   formatter, triage,   →   formatted intent,
comment /         →   builder agents       →   plan, review, PR
manual dispatch       (opencode CLI)           (via GITHUB_TOKEN)
```

**Zero secrets required.** opencode runs free public models via
`devstroop/setup-opencode` — no API keys, no GitHub App install. The model
is configured in **one place**: `.config/opencode/config.json` (default
`opencode/big-pickle`), overridable per-repo with the `OPENCODE_MODEL`
repo variable (e.g. a paid `anthropic/claude-sonnet-4-20250514`).

## What wakes up

| Workflow | Trigger | Does |
|----------|---------|------|
| `issue-opened.yml` | issue opened | Reformat title + body into the IDD intent format, post the 🤖 panel. **Formatting only.** |
| `pr-opened.yml` | PR opened | Reformat PR title + body, append the approve checklist, post the 🤖 panel. |
| `comment.yml` | comment created/edited | Interactive feedback on every human comment; dispatches panel ticks + slash commands. |
| `pr-approve.yml` | PR body edited | Ticking **Approve & merge** merges the PR (OWNER/COLLABORATOR/MEMBER). |
| `dispatch.yml` | `Run workflow` button in Actions | Turn a typed intent into a branch + PR. |

## Interactive components

No typing required for the common path — GitHub markdown gives us real
click-to-trigger controls:

- **🤖 Actions panel** — every issue/PR gets a bot comment with tickable
  checkboxes (`/plan`, `/review`, `/implement`, `/close`). Tick one; the
  bot marks it running, replies, and resets the panel. On PRs the panel
  adds `/approve` — tick it to merge.
- **Slash commands** — `/plan`, `/review`, `/implement`, `/close` still work
  typed, as a fallback.
- **Approve & merge checklist** — PR bodies carry a tickable
  `- [ ] Approve & merge` box (renders in the merge widget too); ticking it
  merges. For PRs opened by the bot itself (`/implement`), GitHub suppresses
  `pull_request: edited` events, so those merge via the panel's `/approve`
  box instead — same rule, same guard.
- **Reactions** — 👀 ack on start, ✅ on finish (status also lands in the
  panel's `Last run:` line).

Panel and checklist templates live in `.config/opencode/`; the panel
controller is `scripts/idd-panel.sh`.

## Setup

1. Push this repo to GitHub.
2. (Optional) Set repo variable `OPENCODE_MODEL` for a paid model, e.g.
   `anthropic/claude-sonnet-4-20250514`.
3. Open an issue. That's it.

## Swap opencode → Devstroop Agent SDK

All agent behavior lives in `.config/opencode/` — metadata in
`config.json`, prompts as plain markdown in `agent/<name>.md`. The
workflows only invoke `opencode run --agent <name>` with an env-context
contract (`IDD_*`). Replacing the worker later means changing a single
`run` step per workflow to call the SDK with the same contract — the
triggers, guards, and formats stay.

## Repository layout

```
.github/workflows/       trigger wiring (thin — no prompts inline)
.github/ISSUE_TEMPLATE/  intent form (buttons, no free text required)
.config/opencode/        agent metadata + prompts + panel/checklist templates
scripts/idd-panel.sh     panel controller (the control plane)
AGENTS.md                behavior contract for agents + components
note.txt                 what IDD means here
```