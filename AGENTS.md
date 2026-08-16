# AGENTS.md — idd behavior contract

This repo is the intent stage of a work-driven development pipeline:
**Intent → Work → Outcome**. Human intent (issues, PRs, comments) is the
source of truth. Agents translate intent into specs, plans, and code — never
the other way around.

## Rules for every agent

1. **Formatting is free; implementation is earned.** On issue/PR creation,
   only reformat title + description. Never implement, never branch, never
   comment beyond the formatted output.
2. **Preserve intent.** Never add, drop, or reorder the author's
   requirements. Reformatting = clarity, not editorializing.
3. **Friction reduction.** Reply in the language of the thread. Acknowledge
   work immediately. End every comment with the command menu so the next
   step is one reply away.
4. **Context via `IDD_*` env vars.** Workflows pass `IDD_NUMBER`, `IDD_REPO`,
   `IDD_KIND` (`issue` | `pr`), `IDD_COMMENT`, `IDD_AUTHOR`,
   `IDD_COMMAND`, `IDD_ALLOWED`. Read these; never guess context.
5. **Outcomes are files or comments.** Formatters write
   `.idd/result.json`; everything else replies as a comment via `gh`.
6. **No secret leakage.** Logs may be public. Never echo tokens or keys.

## Interactive components (standard set)

Everything in a thread is driven by four standard components. Keep this set;
do not invent new trigger formats.

| Component | Where | Interaction | Event |
|-----------|-------|-------------|-------|
| **🤖 Actions panel** | bot comment (`.config/opencode/panel.md`) | tick a checkbox → command | `issue_comment: [edited]` |
| **Slash commands** | any comment (`/plan`, `/review`, `/implement`, `/close`) | typed | `issue_comment: [created]` |
| **Approve & merge checklist** | PR body (`.config/opencode/checklist.md`) | tick box → merge | `pull_request: [edited]` |
| **Reactions** | 👀 on start, ✅ on finish | ack only — never a trigger | — (no webhook) |

Rules:

1. **Sender, not author.** Dispatch filters on `github.event.sender.type != 'Bot'` — a
   human ticking a bot's panel comment produces `sender = human`. Bot resets
   are filtered by the same rule, so no loops.
2. **Tick detection.** A command dispatches only when a box transitions
   `[ ] → [x]` between `changes.body.from` and `changes.body.to`.
3. **Panels reset after every run.** `scripts/idd-panel.sh` owns the panel
   comment (marker `<!-- IDD-PANEL -->`): `post` on open, `check <cmd>` while
   running, `reset` when done. The status line reports the last run.
4. **Formatter never touches checklists.** Checkbox state is machine-read;
   the formatter preserves `## Approve & merge` and any task list verbatim.
5. **Guards apply to every path.** `/implement` (typed or ticked) requires
   OWNER/COLLABORATOR/MEMBER — enforced in the workflow, not by the agent.
6. **No menus in agent replies.** The panel replaces pasted menus; replies
   end with `_Tick an action in the 🤖 panel above._`

## Command reference (panel + slash)

| Command | Behavior |
|---------|----------|
| `/help` | Explain the panel only |
| `/plan` | Analyze thread, post a plan with steps + acceptance criteria. No code. |
| `/review` | Read the diff (PRs) or the thread (issues), post findings. No code. |
| `/implement` | Only when `IDD_ALLOWED=true` and `IDD_KIND=pr` or a clear issue intent exists. Create branch `idd/<slug>`, implement, run tests if any, push, `gh pr create`. Otherwise explain why not. |
| `/close` | Summarize intent + outcome, then close the thread. |
| anything else | Treat as feedback: answer, then reference the panel. |

## Format contract (`formatter` agent — `.config/opencode/agent/formatter.md`)

- Title: imperative, ≤ 72 chars, no type prefixes (`[feat]`, `IDD-`).
- Body normalized to:

```markdown
## Intent
What + why, in the author's own meaning.

## Constraints
Anything that must not change, break, or be touched.

## Acceptance Criteria
Verifiable outcomes, as a checklist.
```

- Output MUST be written to `.idd/result.json` as
  `{"title": "...", "body": "..."}` (build with `jq -nc`).
- Do not create any other files. Do not use bash beyond `jq`.

## SDK swap note

Workflows call agents through `opencode run --agent <name>` only. Agent
metadata (model, temperature, permissions) is in
`.config/opencode/config.json`; each agent's prompt lives in
`.config/opencode/agent/<name>.md`. When the Devstroop Agent SDK takes over,
the same agent names and `IDD_*` contract move behind
`devstroop.sdk().agent("triage").run(...)` — no trigger or format changes.