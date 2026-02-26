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
  Steps run:  4
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

## Install

```bash
npm install -g agentlooper
```

### Prerequisites

You need both of these AI coding CLIs installed:

| Tool | Install | Role |
|---|---|---|
| [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | `npm install -g @anthropic-ai/claude-code` | Builder — reads your codebase, writes and edits files |
| [Codex CLI](https://github.com/openai/codex) | `npm install -g @openai/codex` | Reviewer — reviews the diff, finds bugs and issues |

## Usage

```bash
cd your-project

agentlooper "Add user authentication with JWT tokens"
```

That's it. No config files. No YAML. No setup. Works with any tech stack — iOS, web, backend, CLI tools. The agents figure out what to do.

You can also pass the prompt without quotes:

```bash
agentlooper add a settings screen with dark mode toggle
```

### More examples

```bash
# Build a feature
agentlooper "Add a /health endpoint that returns system status"

# Fix a bug
agentlooper "Fix the login bug where users get logged out after 5 minutes"

# Refactor
agentlooper "Refactor the database layer to use connection pooling"

# iOS
agentlooper "Add hidden contextual tags to items using Apple Intelligence"
```

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

1. **Build** — Claude Code implements your request. It reads your codebase, writes files, runs commands — whatever is needed.
2. **Review** — Codex reviews all uncommitted changes (`codex exec review --uncommitted --full-auto`). It only reads the diff, never edits files.
3. If **APPROVED** → done.
4. If blocking issues found → **Fix** — Claude Code gets the feedback and fixes them → back to step 2.
5. Max **5 iterations**, then exits with an error.

### Approval logic

AgentLooper uses a three-tier system to decide whether the review passes:

| Signal | Action |
|---|---|
| A review line is exactly `APPROVED` | Approved immediately |
| Only non-blocking feedback (nits, suggestions, style, docs, formatting) | Treated as approved — no fix loop |
| Blocking issues (bugs, crashes, security, failing builds, data loss) | Triggers a fix iteration |

This prevents wasting iterations on cosmetic feedback while catching real issues.

### Fail-fast

If any step (Build, Review, or Fix) exits with a non-zero code, AgentLooper stops immediately with an error. No silent failures.

### Review output filtering

Codex prints session metadata (version, model, session ID, etc.) alongside its review. AgentLooper strips this noise so you only see the actual findings.

### Cost tracking

Claude Code reports its API cost. AgentLooper accumulates the total across all iterations and shows it in the summary. Codex costs are not currently tracked.

## What the spinner shows

While the agents work, the spinner shows real-time activity with an elapsed timer:

```
  ⠼ Reading Models/Item.swift (8s)
  ⠦ Writing Services/TagService.swift (24s)
  ⠧ Editing ContentView.swift (31s)
  ⠇ Running: xcodebuild -scheme App build (45s)
  ⠏ Searching files... (1m 12s)
  ⠙ Thinking... (1m 30s)
```

This is parsed from Claude Code's streaming JSON output — you see file reads, writes, edits, shell commands, searches, and thinking in real-time.

## Configuration

None. AgentLooper is zero-config by design.

Under the hood, it runs:

- **Claude Code**: `claude --print --dangerously-skip-permissions --verbose --output-format stream-json`
- **Codex**: `codex exec review --uncommitted --full-auto`

Each command has a 20-minute timeout.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Review approved (explicitly or no blocking issues) |
| `1` | Build/Review/Fix failed, max iterations reached, or execution error |

## Contributing

Contributions are welcome:

1. **Report bugs** — Open an issue with the error output
2. **Improve review logic** — Better blocking/non-blocking classification
3. **Add features** — PRs welcome

## License

MIT
