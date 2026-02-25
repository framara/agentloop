# 🔁 AgentLooper

**Two AI agents. One builds. One reviews. Loop until it's right.**

Claude Code writes the code. Codex reviews it. If there are issues, Claude Code fixes them. Repeat until approved. Zero config.

```
agentlooper "Add Stripe billing with usage-based pricing"
```

```
   ╭─────────────────────╮
   │   🔁 AgentLooper    │
   │   Multi-Agent CLI   │
   ╰─────────────────────╯

▶ Build (iteration 1)
  ⠼ Writing services/billing.ts (32s)
  ✔ Done

▶ Review (iteration 1)
  ⠧ Codex is reviewing... (18s)
  ⚠ Issues found
  │ Missing error handling in webhook endpoint
  │ No idempotency key on charge creation

▶ Fix (iteration 2)
  ⠹ Editing services/billing.ts (14s)
  ✔ Done

▶ Review (iteration 2)
  ✔ APPROVED

─────────────────────────────────────────────
  Status:     APPROVED
  Duration:   124.3s
  Est. cost:  $0.28
─────────────────────────────────────────────
```

---

## Why?

You've done this manually:

1. **Claude Code** builds a feature
2. You review it, find issues
3. You paste the feedback back
4. Repeat 3 more times

AgentLooper automates the entire loop. Two agents iterate until the code is right — you just walk away.

## Quick Start

```bash
# Install
npm install -g agentlooper

# Go to your project
cd your-project

# Run it
agentlooper "Add user authentication with JWT tokens"
```

That's it. No config files. No YAML. No setup.

## Prerequisites

You need both:

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) — `npm install -g @anthropic-ai/claude-code`
- [Codex CLI](https://github.com/openai/codex) — `npm install -g @openai/codex`

## How It Works

```
┌─────────────┐     ┌─────────────┐
│ Claude Code  │────▶│   Codex     │
│  (builder)   │     │ (reviewer)  │
│              │◀────│             │
│ Writes code  │     │ Reviews diff│
└─────────────┘     └─────────────┘
       │                    │
       └──── Loop until ────┘
              APPROVED
```

1. **Build** — Claude Code implements your request (reads your codebase, writes files)
2. **Review** — Codex reviews uncommitted changes with `codex exec review --uncommitted --full-auto`
3. If a review line is exactly **APPROVED** → done
4. If issues are found → **Fix** — Claude Code fixes them → back to Review
5. Max 5 iterations

The builder has full edit permissions. The reviewer is read-only and only reviews the current diff.

## Runtime Rules

- Fail-fast: if Build, Review, or Fix exits non-zero, AgentLooper stops immediately with an error.
- Strict approval: only a standalone review line equal to `APPROVED` is treated as approval.
- Relevance gate: suggestion-only / nit-style feedback is treated as non-blocking and does not trigger another fix loop.
- Review output filtering: Codex session metadata and MCP chatter are stripped from displayed findings to keep feedback focused.
- Timeout: each agent command has a 20-minute timeout.
- Loop outcome: if no approval after 5 iterations, AgentLooper exits with a non-zero status.

## What It Looks Like

The spinner shows what the agent is doing in real-time:

```
  ⠼ Reading Models/Item.swift (8s)
  ⠦ Writing Services/TagService.swift (24s)
  ⠧ Editing ContentView.swift (31s)
  ⠇ Running: xcodebuild -scheme App build (45s)
  ⠏ Searching files... (52s)
```

Works with any tech stack — iOS, web, backend, CLI tools. The agents figure out what to do.

## License

MIT
