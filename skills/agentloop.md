# AgentLoop — Project Skill

Multi-agent orchestrator for AI coding CLIs. Chains Claude Code, Codex, Gemini, and any CLI into automated build → audit → fix loops via YAML config.

## Architecture

```
src/
  cli.ts                  # Commander CLI — run, init, validate, cleanup
  core/
    schema.ts             # Zod schemas — WorkflowConfig, AgentConfig, StepConfig, LoopConfig
    engine.ts             # Main orchestrator — loads YAML, executes steps, manages loops
  adapters/
    base.ts               # AgentAdapter interface + AgentResult type
    claude-code.ts        # Claude Code adapter (JSON output, cost tracking, stdin piping)
    codex.ts              # OpenAI Codex adapter
    gemini.ts             # Google Gemini CLI adapter
    custom.ts             # Universal adapter — runs any CLI via command template
    index.ts              # Adapter registry + availability checker
  utils/
    git.ts                # getGitDiff (supports baseBranch for worktree mode), snapshotCommit
    worktree.ts           # createWorktree, listWorktrees, removeWorktree
    template.ts           # Mustache-style {{ variable }} resolver + condition evaluator
    logger.ts             # Chalk-based structured output (steps, summaries, worktree info)
    report.ts             # Markdown run report generator
examples/
  build-and-audit.yml     # Two-agent loop: build → audit → fix
  build-test-secure.yml   # Three agents: builder, tester, security auditor
  build-test-fix.yml      # Shell steps for lint + test, loop until tests pass
  parallel-audit.yml      # Parallel lint + test + security audit
```

## Config Format (agentloop.yml)

```yaml
name: workflow-name

agents:
  agent_key:
    cli: claude-code | codex | gemini | aider | custom
    model: optional-model-override
    system: |
      Optional system prompt
    command: "for custom cli: any-cli --flag {{prompt}}"

steps:
  # Agent step — sends prompt to an AI CLI
  - name: step-name
    agent: agent_key
    prompt: |
      Supports {{ feature_spec }} and {{ steps.prev.output }}
    context:
      - git:diff           # Injects git diff (cumulative in worktree mode)
      - path/to/file.ts    # Injects file contents

  # Shell step — runs command directly, no agent
  - name: test
    run: "npm test 2>&1 || true"

  # Parallel steps — consecutive parallel: true steps run concurrently
  - name: lint
    run: "npm run lint"
    parallel: true
  - name: test
    run: "npm test"
    parallel: true

  # Loop step — repeats workflow from re-entry point
  - name: fix
    agent: builder
    prompt: "Fix: {{ steps.audit.output }}"
    loop:
      until: steps.audit.output contains APPROVED
      max: 5
      on_max: fail | pause | continue
```

## Key Engine Concepts

### Step Execution
- Steps run sequentially by default
- `parallel: true` on consecutive steps groups them for `Promise.all` execution
- Shell steps (`run`) execute via `sh -c`, capture stdout/stderr + exit code
- Agent steps resolve context + prompt template, then delegate to the adapter
- All step outputs stored as `{{ steps.<name>.output }}` and `{{ steps.<name>.exitCode }}`

### Loop Logic
- The engine finds the first step with `loop` config
- The loop condition (e.g., `steps.audit.output contains APPROVED`) is parsed to find the referenced step
- On iteration > 1, all steps before the referenced step's group are skipped (re-entry point)
- Loop runs up to `max` iterations

### Worktree Isolation (--worktree)
- Creates `git worktree add -b agentloop/run-<id>` in `$TMPDIR`
- All steps execute in the worktree (user's checkout untouched)
- Auto-commits after each step/parallel group with `agentloop: <step> (iteration N)`
- `git:diff` context uses `git diff baseBranch...HEAD` for cumulative diff
- Report written to original cwd, not the worktree
- `agentloop cleanup` removes all agentloop worktrees + branches

### Adapters
- All built-in adapters pipe prompts via stdin (avoids ARG_MAX)
- Claude Code uses `--output-format json` to extract cost from structured response
- Custom adapter replaces `{{prompt}}` in the command template, runs via `sh -c`
- `aider` is an alias for the custom adapter
- Timeout detection: adapters check `timedOut` and prefix output with `[TIMED OUT]`

### Template System
- `{{ variable }}` — resolved from the variables map
- Supports word chars, dots, and hyphens: `{{ steps.security-audit.output }}`
- Conditions: `contains` (case-insensitive) and `==` (exact match)

## CLI Commands

```
agentloop run -c config.yml -s "spec" --worktree --dry-run
agentloop init                    # Scaffold agentloop.yml
agentloop validate -c config.yml  # Check config validity
agentloop cleanup                 # Remove agentloop worktrees/branches
```

## Tech Stack
- TypeScript (ES2022, Node16 module resolution)
- commander (CLI), zod (validation), execa (process execution), yaml (parsing), chalk (output)
- Build: `tsc` to `dist/`, dev: `tsx src/cli.ts`

## Conventions
- Adapters implement `AgentAdapter` interface from `base.ts`
- All file imports use `.js` extension (Node16 ESM)
- Errors in step execution throw (not `process.exit`) so `finally` blocks run
- Reports go to original cwd, execution happens in effectiveCwd (which may be a worktree)
