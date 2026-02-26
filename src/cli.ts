#!/usr/bin/env node

import { execa } from "execa";
import { logger } from "./utils/logger.js";
import { createInterface } from "readline";

const prompt = process.argv.slice(2).join(" ").trim();

if (!prompt || prompt === "--help" || prompt === "-h") {
  console.log(`
  Usage: agentlooper "your prompt"

  Examples:
    agentlooper "add a settings screen with dark mode toggle"
    agentlooper "fix the login bug where users get logged out"
    agentlooper "refactor the database layer to use connection pooling"
`);
  process.exit(prompt ? 0 : 1);
}

const MAX_ITERATIONS = 5;
const COMMAND_TIMEOUT_MS = 20 * 60 * 1000;

// ── Claude Code (builder) ────────────────────────────────────────────

interface RunResult {
  output: string;
  exitCode: number;
  costUsd?: number;
}

function isApprovedReview(output: string): boolean {
  return output
    .split(/\r?\n/)
    .some((line) => line.trim().toUpperCase() === "APPROVED");
}

function sanitizeCodexReviewOutput(raw: string): string {
  const noisyLineMatchers: RegExp[] = [
    /^OpenAI Codex v/i,
    /^-+$/,
    /^workdir:/i,
    /^model:/i,
    /^provider:/i,
    /^approval:/i,
    /^sandbox:/i,
    /^reasoning effort:/i,
    /^reasoning summaries:/i,
    /^session id:/i,
    /^user$/i,
    /^assistant$/i,
    /^system$/i,
    /^current changes$/i,
    /^mcp:/i,
  ];

  const kept: string[] = [];
  let previousBlank = false;

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    const isNoise = noisyLineMatchers.some((re) => re.test(line));
    if (isNoise) continue;

    if (line === "") {
      if (!previousBlank) {
        kept.push("");
      }
      previousBlank = true;
      continue;
    }

    previousBlank = false;
    kept.push(rawLine);
  }

  return kept.join("\n").trim();
}

function hasBlockingFindings(output: string): boolean {
  const normalized = output.toLowerCase();

  const positiveSignals = [
    "no issues found",
    "no critical issues",
    "no actionable findings",
    "looks good",
    "lgtm",
    "ship it",
  ];
  if (positiveSignals.some((signal) => normalized.includes(signal))) {
    return false;
  }

  const blockingHints = [
    /\bbug\b/,
    /\bcrash\b/,
    /\bsecurity\b/,
    /\bvulnerab/,
    /\bexploit\b/,
    /\bregression\b/,
    /\bincorrect\b/,
    /\bbroken\b/,
    /\bfail(?:ing|ed)?\b/,
    /\bexception\b/,
    /\bpanic\b/,
    /\bdata loss\b/,
    /\bauth(?:entication|orization)?\b/,
    /\bnull pointer\b/,
    /\bmemory leak\b/,
    /\bdeadlock\b/,
    /\brace condition\b/,
    /\bsql injection\b/,
    /\bxss\b/,
    /\bcsrf\b/,
    /\bcompile error\b/,
    /\bbuild (?:fails|failed)\b/,
  ];
  if (blockingHints.some((pattern) => pattern.test(normalized))) {
    return true;
  }

  const nonBlockingHints = [
    /\bnit(?:pick)?s?\b/,
    /\bsuggestion\b/,
    /\boptional\b/,
    /\bminor\b/,
    /\bstyle\b/,
    /\bstylistic\b/,
    /\bformat(?:ting)?\b/,
    /\bnaming\b/,
    /\breadability\b/,
    /\bpolish\b/,
    /\bdocs?\b/,
    /\bcomment\b/,
    /\bconsider\b/,
    /\bcould\b/,
    /\bnice to have\b/,
  ];
  if (nonBlockingHints.some((pattern) => pattern.test(normalized))) {
    return false;
  }

  // Conservative default: if we cannot clearly classify it as non-blocking,
  // treat it as blocking so we do not auto-approve real issues.
  return true;
}

async function runClaude(input: string): Promise<RunResult> {
  const args = [
    "--print",
    "--dangerously-skip-permissions",
    "--verbose",
    "--output-format", "stream-json",
    "-",
  ];

  let output = "";
  let costUsd: number | undefined;

  const proc = execa("claude", args, {
    cwd: process.cwd(),
    input,
    timeout: COMMAND_TIMEOUT_MS,
    reject: false,
  });

  if (proc.stdout) {
    const rl = createInterface({ input: proc.stdout });
    rl.on("line", (line) => {
      try {
        const event = JSON.parse(line);

        if (event.type === "assistant" && event.message) {
          const msg = event.message;
          if (msg.type === "tool_use") {
            const name = msg.name ?? "";
            const inp = msg.input ?? {};
            if (name === "Read" || name === "read_file") {
              const short = (inp.file_path ?? inp.path ?? "").split("/").slice(-2).join("/");
              logger.spinnerUpdate(`Reading ${short}`);
            } else if (name === "Write" || name === "write_file" || name === "create_file") {
              const short = (inp.file_path ?? inp.path ?? "").split("/").slice(-2).join("/");
              logger.spinnerUpdate(`Writing ${short}`);
            } else if (name === "Edit" || name === "edit_file") {
              const short = (inp.file_path ?? inp.path ?? "").split("/").slice(-2).join("/");
              logger.spinnerUpdate(`Editing ${short}`);
            } else if (name === "Bash" || name === "execute_command" || name === "bash") {
              logger.spinnerUpdate(`Running: ${(inp.command ?? "").slice(0, 40)}`);
            } else if (name === "Glob" || name === "glob" || name === "list_files") {
              logger.spinnerUpdate("Searching files...");
            } else if (name === "Grep" || name === "grep" || name === "search") {
              logger.spinnerUpdate(`Searching for "${(inp.pattern ?? "").slice(0, 30)}"`);
            } else if (name) {
              logger.spinnerUpdate(`${name}...`);
            }
          }
          if (msg.type === "text") {
            logger.spinnerUpdate("Thinking...");
          }
        }

        if (event.type === "result") {
          if (typeof event.result === "string") output = event.result;
          costUsd =
            typeof event.cost_usd === "number" ? event.cost_usd :
            typeof event.total_cost_usd === "number" ? event.total_cost_usd :
            undefined;
        }
      } catch {
        // ignore
      }
    });
  }

  const result = await proc;

  if (!output) {
    output = result.stdout || result.stderr || "";
    try {
      const parsed = JSON.parse(output);
      if (typeof parsed === "object" && parsed !== null) {
        const text = parsed.result ?? parsed.text;
        if (typeof text === "string") output = text;
        costUsd =
          typeof parsed.cost_usd === "number" ? parsed.cost_usd :
          typeof parsed.total_cost_usd === "number" ? parsed.total_cost_usd :
          undefined;
      }
    } catch {
      // raw
    }
  }

  return { output, exitCode: result.exitCode ?? 1, costUsd };
}

// ── Codex (reviewer) ─────────────────────────────────────────────────

async function runCodexReview(): Promise<RunResult> {
  const args = [
    "exec", "review",
    "--uncommitted",
    "--full-auto",
  ];

  const result = await execa("codex", args, {
    cwd: process.cwd(),
    // Some Codex versions treat piped stdin as a prompt, which conflicts
    // with --uncommitted. Ignore stdin to keep this invocation prompt-free.
    stdin: "ignore",
    timeout: COMMAND_TIMEOUT_MS,
    reject: false,
  });

  const rawOutput = result.stdout || result.stderr || "";
  const cleanedOutput = sanitizeCodexReviewOutput(rawOutput);
  const output = cleanedOutput || rawOutput;

  return {
    output,
    exitCode: result.exitCode ?? 1,
  };
}

// ── Main loop ────────────────────────────────────────────────────────

logger.banner();
const start = Date.now();
let totalCost = 0;
let approved = false;
let stepsRun = 0;

try {
  for (let i = 1; i <= MAX_ITERATIONS; i++) {
    // ── Build / Fix (Claude Code) ──────────────────────────────
    if (i === 1) {
      logger.step("Build", i);
      logger.spinnerStart("Claude Code is building...");

      const build = await runClaude(prompt);
      logger.spinnerStop();

      if (build.costUsd) totalCost += build.costUsd;
      stepsRun++;
      logger.success(`Done`);
      logger.output(build.output);
      if (build.exitCode !== 0) {
        logger.error(`Build failed (exit ${build.exitCode})`);
        process.exit(1);
      }
    }

    // ── Review (Codex) ─────────────────────────────────────────
    logger.step("Review", i);
    logger.spinnerStart("Codex is reviewing...");

    const review = await runCodexReview();
    logger.spinnerStop();
    stepsRun++;
    if (review.exitCode !== 0) {
      logger.error(`Review failed (exit ${review.exitCode})`);
      logger.output(review.output);
      process.exit(1);
    }

    const isApproved = isApprovedReview(review.output);
    const hasBlocking = hasBlockingFindings(review.output);

    if (isApproved) {
      logger.success("APPROVED");
      logger.output(review.output);
      approved = true;
      break;
    }

    if (!hasBlocking) {
      logger.success("No blocking issues — treating review as approved");
      logger.output(review.output);
      approved = true;
      break;
    }

    logger.warn("Issues found");
    logger.output(review.output);

    if (i === MAX_ITERATIONS) {
      logger.warn(`Max iterations (${MAX_ITERATIONS}) reached`);
      break;
    }

    // ── Fix (Claude Code) ──────────────────────────────────────
    logger.step("Fix", i + 1);
    logger.spinnerStart("Claude Code is fixing...");

    const fixPrompt = `Fix the following BLOCKING issues found during code review:

${review.output}

The original request was: "${prompt}"

Focus only on concrete correctness, security, runtime, or test failures.
Do not spend time on optional style-only suggestions.`;

    const fix = await runClaude(fixPrompt);
    logger.spinnerStop();

    if (fix.costUsd) totalCost += fix.costUsd;
    stepsRun++;
    logger.success("Done");
    logger.output(fix.output);
    if (fix.exitCode !== 0) {
      logger.error(`Fix failed (exit ${fix.exitCode})`);
      process.exit(1);
    }
  }

  const durationMs = Date.now() - start;
  logger.summary(stepsRun, durationMs, approved, totalCost);
  if (!approved) {
    process.exit(1);
  }
} catch (err: any) {
  logger.spinnerStop();
  logger.error(err.message ?? "Execution failed");
  process.exit(1);
}
