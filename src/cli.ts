#!/usr/bin/env node

import { execa } from "execa";
import { logger } from "./utils/logger.js";

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

logger.banner();

const start = Date.now();
logger.spinnerStart("Working...");

try {
  const result = await execa("claude", [
    "--print",
    "--dangerously-skip-permissions",
    "--output-format", "json",
    "-",
  ], {
    cwd: process.cwd(),
    input: prompt,
    reject: false,
  });

  logger.spinnerStop();

  const durationMs = Date.now() - start;
  let output = result.stdout || result.stderr || "";
  let costUsd: number | undefined;

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
    // raw output
  }

  if (result.exitCode === 0) {
    logger.success(`Done in ${(durationMs / 1000).toFixed(1)}s`);
  } else {
    logger.error(`Failed (exit ${result.exitCode})`);
  }

  logger.output(output);
  logger.summary(1, durationMs, false, false, costUsd);
} catch (err: any) {
  logger.spinnerStop();
  logger.error(err.message ?? "Execution failed");
  process.exit(1);
}
