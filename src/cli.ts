#!/usr/bin/env node

import { Command } from "commander";
import { run } from "./core/engine.js";
import { logger } from "./utils/logger.js";

const program = new Command();

program
  .name("agentloop")
  .description("Multi-agent orchestration for coding CLIs")
  .version("0.1.0");

program
  .command("run")
  .description("Execute a workflow")
  .option("-c, --config <path>", "Path to workflow YAML", "agentloop.yml")
  .option("-s, --spec <spec>", "Feature spec (text or file path)")
  .option("-d, --cwd <dir>", "Working directory", process.cwd())
  .option("--dry-run", "Preview execution plan without running")
  .option("--worktree", "Run in an isolated git worktree")
  .action(async (opts) => {
    try {
      await run({
        configPath: opts.config,
        spec: opts.spec,
        cwd: opts.cwd,
        dryRun: opts.dryRun,
        worktree: opts.worktree,
      });
    } catch (err: any) {
      logger.error(err.message);
      if (err.errors) {
        // Zod validation errors
        for (const e of err.errors) {
          logger.dim(`  - ${e.path.join(".")}: ${e.message}`);
        }
      }
      process.exit(1);
    }
  });

program
  .command("init")
  .description("Create a starter agentloop.yml in the current directory")
  .action(async () => {
    const { writeFile } = await import("fs/promises");
    const { existsSync } = await import("fs");

    if (existsSync("agentloop.yml")) {
      logger.warn("agentloop.yml already exists. Skipping.");
      return;
    }

    const template = `name: build-and-audit

agents:
  builder:
    cli: claude-code
    system: |
      You are a senior full-stack engineer.
      Write clean, tested, production-ready code.
      When fixing issues, address each point specifically.

  auditor:
    cli: codex
    system: |
      You are a strict code auditor.
      Review for: security vulnerabilities, performance issues,
      correctness bugs, missing error handling, and test coverage.
      If everything passes, respond with exactly: APPROVED
      Otherwise, list specific issues with file paths and line numbers.

steps:
  - name: build
    agent: builder
    prompt: |
      Implement the following feature:
      {{ feature_spec }}

  - name: test
    run: "npm test 2>&1 || true"

  - name: audit
    agent: auditor
    prompt: |
      Carefully audit all recent code changes in this repository.
      Review every file that was added or modified.

      ## Test Results:
      {{ steps.test.output }}
    context:
      - git:diff

  - name: fix
    agent: builder
    prompt: |
      Address the following audit feedback. Fix every issue mentioned:
      {{ steps.audit.output }}
    loop:
      until: steps.audit.output contains APPROVED
      max: 5
      on_max: fail
`;

    await writeFile("agentloop.yml", template, "utf-8");
    logger.success("Created agentloop.yml — edit it and run: agentloop run --spec 'your feature'");
  });

program
  .command("cleanup")
  .description("Remove agentloop worktrees and branches")
  .option("-d, --cwd <dir>", "Working directory", process.cwd())
  .action(async (opts) => {
    const { listWorktrees, removeWorktree } = await import("./utils/worktree.js");

    const worktrees = await listWorktrees(opts.cwd);

    if (worktrees.length === 0) {
      logger.success("No agentloop worktrees found. Nothing to clean up.");
      return;
    }

    logger.info(`Found ${worktrees.length} agentloop worktree(s):\n`);
    for (const wt of worktrees) {
      logger.dim(`  ${wt.branch}  →  ${wt.path}`);
    }
    console.log();

    let removed = 0;
    for (const wt of worktrees) {
      const result = await removeWorktree(opts.cwd, wt.path, wt.branch);
      if (result.removed) {
        logger.success(`Removed ${wt.branch}`);
        removed++;
      } else {
        logger.warn(`${wt.branch}: ${result.error}`);
      }
    }

    logger.info(`Cleaned up ${removed}/${worktrees.length} worktree(s).`);
  });

program
  .command("validate")
  .description("Validate a workflow YAML file")
  .option("-c, --config <path>", "Path to workflow YAML", "agentloop.yml")
  .action(async (opts) => {
    const { readFile } = await import("fs/promises");
    const { parse: parseYaml } = await import("yaml");
    const { WorkflowSchema } = await import("./core/schema.js");

    try {
      const raw = await readFile(opts.config, "utf-8");
      const parsed = parseYaml(raw);
      WorkflowSchema.parse(parsed);
      logger.success(`${opts.config} is valid!`);
    } catch (err: any) {
      logger.error(`Invalid config: ${err.message}`);
      if (err.errors) {
        for (const e of err.errors) {
          logger.dim(`  - ${e.path.join(".")}: ${e.message}`);
        }
      }
      process.exit(1);
    }
  });

program.parse();
