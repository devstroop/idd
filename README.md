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
| `issue-opened.yml` | issue opened | Reformat title + body into the IDD intent format. **Formatting only, no implementation.** |
| `pr-opened.yml` | PR opened | Reformat PR title + body. **Formatting only.** |
| `comment.yml` | comment on issue/PR | Interactive feedback on every human comment + slash-command dispatch (see below). |
| `dispatch.yml` | `Run workflow` button in Actions | Turn a typed intent into a branch + PR. |

## Commands (reply in any comment)

| Command | Action |
|---------|--------|
| `/help` | Print the command menu |
| `/plan` | Produce a work plan comment (no code) |
| `/review` | Review the issue context or PR diff, post findings |
| `/implement` | Implement into a branch and open a PR (OWNER / COLLABORATOR / MEMBER only) |
| `/close` | Summarize and close |

The bot replies with this menu as checkboxes — checking one and replying with
its command is all that's needed. Every run is acknowledged instantly with a
👀 reaction and finished with ✔️.

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
.config/opencode/        agent metadata + prompts (the workforce)
AGENTS.md                behavior contract for agents
note.txt                 what IDD means here
```