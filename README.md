# 🔁 AgentLoop

**Multi-agent orchestration for AI coding CLIs.**

Chain Claude Code, Codex, and other AI coding agents into automated build → audit → fix loops. Like CI/CD, but for AI-generated code.

```
agentloop run --spec "Add Stripe billing with usage-based pricing"
```

```
   ╭─────────────────────╮
   │   🔁  AgentLoop     │
   │   Multi-Agent CLI   │
   ╰─────────────────────╯

  ℹ Workflow: build-and-audit
  ℹ Steps: build → audit → fix
  ✔ All CLIs available: claude-code, codex

▶ build (iteration 1)
  → claude --print --output-format text...
  ✔ Done in 45.2s

▶ audit (iteration 1)
  → codex --quiet --approval-mode full-auto...
  ✔ Done in 32.1s
  ⚠ Condition not met — looping (1/5)

▶ fix (iteration 2)
  → claude --print --output-format text...
  ✔ Done in 28.7s

▶ audit (iteration 2)
  → codex --quiet --approval-mode full-auto...
  ✔ Done in 18.3s
  ✔ Loop condition met — workflow complete!

─────────────────────────────────────────────
  Status:     APPROVED
  Iterations: 4
  Duration:   124.3s
─────────────────────────────────────────────
  ℹ Report saved to: agentloop-report-1740512345678.md
```

---

## Why?

If you've used AI coding agents, you've probably discovered this workflow:

1. **Agent A** builds a feature
2. **Agent B** audits the code
3. You paste Agent B's feedback back to Agent A
4. Repeat until it's good

This works great — but it's manual, tedious, and doesn't scale. **AgentLoop automates the entire loop.**

## Quick Start

```bash
# Install
npm install -g agentloop

# Create a config in your project
cd your-project
agentloop init

# Run it
agentloop run --spec "Add user authentication with JWT tokens"
```

## Prerequisites

You need at least one AI coding CLI installed:

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) — `npm install -g @anthropic-ai/claude-code`
- [Codex CLI](https://github.com/openai/codex) — `npm install -g @openai/codex`

## How It Works

AgentLoop reads a simple YAML config that defines **agents** and **steps**:

```yaml
# agentloop.yml
name: build-and-audit

agents:
  builder:
    cli: claude-code
    system: |
      You are a senior full-stack engineer.
      Write clean, tested, production-ready code.

  auditor:
    cli: codex
    system: |
      You are a strict code auditor.
      If everything passes, respond with exactly: APPROVED
      Otherwise, list specific issues to fix.

steps:
  - name: build
    agent: builder
    prompt: |
      Implement the following feature:
      {{ feature_spec }}

  - name: audit
    agent: auditor
    prompt: |
      Audit all recent code changes carefully.
    context:
      - git:diff

  - name: fix
    agent: builder
    prompt: |
      Address the following audit feedback:
      {{ steps.audit.output }}
    loop:
      until: steps.audit.output contains APPROVED
      max: 5
      on_max: fail
```

Then run:

```bash
agentloop run --spec "Add a /health endpoint that returns system status"
```

AgentLoop will:
1. Send the spec to Claude Code to build the feature
2. Capture the git diff and send it to Codex for auditing
3. If the auditor finds issues, send them back to Claude Code to fix
4. Loop until the auditor responds with "APPROVED" (or max iterations hit)

## CLI Commands

| Command | Description |
|---|---|
| `agentloop run` | Execute a workflow |
| `agentloop init` | Create a starter `agentloop.yml` |
| `agentloop validate` | Check if your config is valid |
| `agentloop cleanup` | Remove agentloop worktrees and branches |

### `agentloop run` flags

| Flag | Default | Description |
|---|---|---|
| `-c, --config <path>` | `agentloop.yml` | Path to workflow config |
| `-s, --spec <text\|file>` | — | Feature spec (inline text or path to .md file) |
| `-d, --cwd <dir>` | `.` | Working directory |
| `--dry-run` | — | Preview plan without executing |
| `--worktree` | — | Run in an isolated git worktree |

## Config Reference

### Agents

```yaml
agents:
  my_agent:
    cli: claude-code    # claude-code | codex | gemini | aider | custom
    model: claude-sonnet-4-20250514 # optional model override
    system: |           # optional system prompt
      Your role description...

  # Custom agent — use any CLI
  my_custom_agent:
    cli: custom
    command: "aider --yes-always --message {{prompt}}"
```

### Steps

Steps can use either an **agent** (AI CLI) or a **shell command** (`run`):

```yaml
steps:
  # Agent step — sends a prompt to an AI coding CLI
  - name: step_name         # unique identifier
    agent: my_agent          # references an agent key
    prompt: |                # supports {{ variables }}
      Do something with {{ feature_spec }}
      Previous output: {{ steps.other_step.output }}
    context:                 # optional file/git context
      - git:diff             # auto-captures current diff
      - src/index.ts         # includes file contents
    loop:                    # optional loop config
      until: steps.audit.output contains APPROVED
      max: 5                 # max iterations
      on_max: fail           # fail | pause | continue

  # Shell step — runs a command directly, no agent needed
  - name: test
    run: "npm test 2>&1 || true"
```

Shell steps capture stdout/stderr as `{{ steps.<name>.output }}` and the exit code as `{{ steps.<name>.exitCode }}`, just like agent steps. Use them for tests, linting, builds, or any deterministic command.

### Parallel Steps

Mark consecutive steps with `parallel: true` to run them concurrently:

```yaml
steps:
  - name: build
    agent: builder
    prompt: "Implement {{ feature_spec }}"

  - name: lint
    run: "npm run lint 2>&1 || true"
    parallel: true

  - name: test
    run: "npm test 2>&1 || true"
    parallel: true

  - name: security
    agent: auditor
    prompt: "Audit the code changes."
    parallel: true

  - name: fix
    agent: builder
    prompt: |
      Fix these issues:
      Lint: {{ steps.lint.output }}
      Tests: {{ steps.test.output }}
      Security: {{ steps.security.output }}
```

Consecutive `parallel: true` steps form a group and execute via `Promise.all`. Note: parallel steps cannot have `loop` — move the loop to a sequential step downstream.

### Template Variables

| Variable | Description |
|---|---|
| `{{ feature_spec }}` | The `--spec` value passed to `agentloop run` |
| `{{ steps.<name>.output }}` | Output from a previous step |
| `{{ steps.<name>.exitCode }}` | Exit code from a previous step |

## Examples

See the [`examples/`](./examples) directory:

- **[build-and-audit.yml](./examples/build-and-audit.yml)** — The classic two-agent loop
- **[build-test-secure.yml](./examples/build-test-secure.yml)** — Three agents: builder, tester, security auditor
- **[build-test-fix.yml](./examples/build-test-fix.yml)** — Shell steps for lint + test, loop until tests pass
- **[parallel-audit.yml](./examples/parallel-audit.yml)** — Lint + test + security audit in parallel

## Roadmap

- [x] Core workflow engine with YAML config
- [x] Claude Code + Codex CLI adapters
- [x] Git diff context capture
- [x] Loop logic with configurable termination
- [x] Markdown run reports
- [x] Git worktree isolation (`--worktree`) with auto-commits per step
- [x] Gemini CLI adapter
- [x] Custom agent support (any CLI via `command` template)
- [x] Parallel step execution (`parallel: true`)
- [x] Shell steps (`run`) for tests, linting, builds — no agent needed
- [x] Cost tracking (Claude Code via JSON output)
- [ ] TUI diff viewer
- [ ] Web dashboard for run history
- [ ] GitHub Actions integration
- [ ] Shared workflow library

## Contributing

Contributions are welcome! The easiest ways to help:

1. **Add an adapter** — Support a new coding CLI in `src/adapters/`
2. **Share a workflow** — Add your YAML configs to `examples/`
3. **Report bugs** — Open an issue with your config + error output

## License

MIT
