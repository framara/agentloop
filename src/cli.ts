#!/usr/bin/env node

import { execa } from "execa";
import { logger } from "./utils/logger.js";
import { createInterface } from "readline";

const prompt = process.argv[2];

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

// ── Claude Code (builder) ────────────────────────────────────────────

interface RunResult {
  output: string;
  exitCode: number;
  costUsd?: number;
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

async function runCodexReview(originalPrompt: string): Promise<RunResult> {
  const reviewInstructions = `The original request was: "${originalPrompt}". If the implementation is correct, complete, and has no bugs, respond with exactly: APPROVED. Otherwise, list specific issues to fix.`;

  const args = [
    "exec", "review",
    "--uncommitted",
    "--full-auto",
    reviewInstructions,
  ];

  const result = await execa("codex", args, {
    cwd: process.cwd(),
    reject: false,
  });

  const output = result.stdout || result.stderr || "";

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

try {
  for (let i = 1; i <= MAX_ITERATIONS; i++) {
    // ── Build / Fix (Claude Code) ──────────────────────────────
    if (i === 1) {
      logger.step("Build", i);
      logger.spinnerStart("Claude Code is building...");

      const build = await runClaude(prompt);
      logger.spinnerStop();

      if (build.costUsd) totalCost += build.costUsd;
      logger.success(`Done`);
      logger.output(build.output);
    }

    // ── Review (Codex) ─────────────────────────────────────────
    logger.step("Review", i);
    logger.spinnerStart("Codex is reviewing...");

    const review = await runCodexReview(prompt);
    logger.spinnerStop();

    const isApproved = review.output.trim().toUpperCase().includes("APPROVED");

    if (isApproved) {
      logger.success("APPROVED");
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

    const fixPrompt = `Fix the following issues found during code review:

${review.output}

The original request was: "${prompt}"`;

    const fix = await runClaude(fixPrompt);
    logger.spinnerStop();

    if (fix.costUsd) totalCost += fix.costUsd;
    logger.success("Done");
    logger.output(fix.output);
  }

  const durationMs = Date.now() - start;
  logger.summary(0, durationMs, approved, true, totalCost);
} catch (err: any) {
  logger.spinnerStop();
  logger.error(err.message ?? "Execution failed");
  process.exit(1);
}
