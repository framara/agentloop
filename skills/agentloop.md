# AgentLooper -- Project Skill

Zero-config two-agent coding loop. Claude Code builds, Codex reviews, loop until approved.

## Architecture

```
src/
  cli.ts                  # Main entry point -- the two-agent loop
  utils/
    logger.ts             # Spinner with elapsed timer, step/output/summary formatting
```

## How the CLI Works (cli.ts)

### Entry point
- Takes prompt from `process.argv.slice(2).join(" ")`
- No subcommands, no flags (except --help)

### Loop (max 5 iterations)
1. **Build** (iteration 1 only) -- `runClaude(prompt)` with edit permissions
2. **Review** (every iteration) -- `runCodexReview()` reads uncommitted diff
3. **Approval check**:
   - `isApprovedReview()` -- exact "APPROVED" on its own line
   - `hasBlockingFindings()` -- classifies findings as blocking vs non-blocking
   - If approved or no blocking issues -> stop
   - If blocking -> **Fix** -- `runClaude(fixPrompt)` -> back to Review

### Claude Code invocation
```
claude --print --dangerously-skip-permissions --verbose --output-format stream-json -
```
- Prompt piped via stdin
- Stream-json parsed line by line for spinner updates (tool_use events)
- Result event extracted for output text and cost_usd
- 20-minute timeout

### Codex invocation
```
codex exec review --uncommitted --full-auto
```
- stdin set to "ignore" (--uncommitted conflicts with piped input)
- Output sanitized via `sanitizeCodexReviewOutput()` -- strips metadata lines
- 20-minute timeout

### Review classification

**Positive signals (non-blocking):**
- "no issues found", "looks good", "LGTM", "ship it"

**Blocking keywords (trigger fix loop):**
- bug, crash, security, vulnerability, exploit, regression, broken, failing, exception, panic, data loss, null pointer, memory leak, deadlock, race condition, SQL injection, XSS, CSRF, compile error, build failed

**Non-blocking keywords (treated as approved):**
- nit, suggestion, optional, minor, style, formatting, naming, readability, polish, docs, comment, consider, could, nice to have

**Default:** unclassified findings are treated as blocking (conservative).

### Fix prompt
Tells Claude Code to focus on concrete correctness/security/runtime failures, not style suggestions.

## Logger (utils/logger.ts)

### Spinner
- Braille-dot frames
- Shows elapsed time: `Editing file.swift (32s)`
- `spinnerStart(text)` / `spinnerUpdate(text)` / `spinnerStop()`
- Writes to stderr, clears line with `\r\x1b[K`

### Output methods
- `step(name, iteration)` -- `Build (iteration 1)`
- `success(msg)` -- `Done`
- `warn(msg)` -- `Issues found`
- `error(msg)` -- `Failed`
- `output(text, maxLines=20)` -- bordered box with truncation
- `summary(steps, duration, approved, cost)` -- final status line

## Tech Stack
- TypeScript (ES2022, Node16 module resolution)
- execa v9 (process execution with streaming, timeout, reject: false)
- chalk v5 (terminal colors)
- readline (stream-json line parsing)
- Build: `tsc` to `dist/`, dev: `tsx src/cli.ts`

## Conventions
- All file imports use `.js` extension (Node16 ESM)
- No config files -- everything hardcoded in cli.ts
- Exit code 0 = approved, 1 = failure
- Fail-fast on non-zero exit from any agent step
