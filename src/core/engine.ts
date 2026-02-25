import { readFile } from "fs/promises";
import path from "path";
import { parse as parseYaml } from "yaml";
import { execa } from "execa";
import { WorkflowSchema, type WorkflowConfig, type StepConfig } from "./schema.js";
import { getAdapter, checkAdapters } from "../adapters/index.js";
import { getGitDiff, snapshotCommit } from "../utils/git.js";
import { resolveTemplate, evaluateCondition } from "../utils/template.js";
import { logger } from "../utils/logger.js";
import { generateReport, type StepRecord } from "../utils/report.js";
import { createWorktree, type WorktreeInfo } from "../utils/worktree.js";

// ── Types ────────────────────────────────────────────────────────────

export interface RunOptions {
  /** Path to the workflow YAML file */
  configPath: string;
  /** Working directory (defaults to cwd) */
  cwd?: string;
  /** Feature spec text or path to a spec file */
  spec?: string;
  /** Dry run — show what would execute without running */
  dryRun?: boolean;
  /** Run in an isolated git worktree */
  worktree?: boolean;
}

interface StepResult {
  output: string;
  exitCode: number;
  durationMs: number;
  costUsd?: number;
  timedOut?: boolean;
}

interface StepGroup {
  parallel: boolean;
  steps: StepConfig[];
  startIndex: number;
}

// ── Step grouping ────────────────────────────────────────────────────

function groupSteps(steps: StepConfig[]): StepGroup[] {
  const groups: StepGroup[] = [];
  let i = 0;

  while (i < steps.length) {
    if (steps[i]!.parallel) {
      const startIndex = i;
      const batch: StepConfig[] = [];
      while (i < steps.length && steps[i]!.parallel) {
        batch.push(steps[i]!);
        i++;
      }
      groups.push({ parallel: true, steps: batch, startIndex });
    } else {
      groups.push({ parallel: false, steps: [steps[i]!], startIndex: i });
      i++;
    }
  }

  return groups;
}

// ── Single step execution ────────────────────────────────────────────

async function executeOneStep(
  step: StepConfig,
  config: WorkflowConfig,
  variables: Record<string, string>,
  effectiveCwd: string,
  baseBranch: string | undefined
): Promise<StepResult> {
  if (step.run) {
    // ── Shell step ──────────────────────────────────────────────
    const resolvedCmd = resolveTemplate(step.run, variables);
    logger.dim(`  → ${resolvedCmd}`);
    const start = Date.now();

    try {
      const proc = await execa("sh", ["-c", resolvedCmd], {
        cwd: effectiveCwd,
        timeout: 10 * 60 * 1000,
        reject: false,
      });

      if (proc.timedOut) {
        return {
          output: "[TIMED OUT] Shell command exceeded the 10 minute timeout.\n" + [proc.stdout, proc.stderr].filter(Boolean).join("\n"),
          exitCode: 1,
          durationMs: Date.now() - start,
          timedOut: true,
        };
      }

      return {
        output: [proc.stdout, proc.stderr].filter(Boolean).join("\n"),
        exitCode: proc.exitCode ?? 1,
        durationMs: Date.now() - start,
      };
    } catch (err: any) {
      return {
        output: err.message ?? "Shell command failed",
        exitCode: 1,
        durationMs: Date.now() - start,
      };
    }
  }

  // ── Agent step ────────────────────────────────────────────────
  const agentConfig = config.agents[step.agent!];
  if (!agentConfig) {
    throw new Error(`Agent "${step.agent}" not defined in config`);
  }

  // Resolve context
  let contextBlock = "";
  if (step.context) {
    for (const ctx of step.context) {
      if (ctx === "git:diff") {
        const diff = await getGitDiff(effectiveCwd, baseBranch);
        contextBlock += `\n\n### Git Diff:\n\`\`\`\n${diff}\n\`\`\``;
      } else {
        try {
          const content = await readFile(path.resolve(effectiveCwd, ctx), "utf-8");
          contextBlock += `\n\n### ${ctx}:\n\`\`\`\n${content}\n\`\`\``;
        } catch {
          logger.warn(`Could not read context: ${ctx}`);
        }
      }
    }
  }

  const resolvedPrompt = resolveTemplate(
    step.prompt! + contextBlock,
    variables
  );

  const adapter = getAdapter(agentConfig.cli);
  return adapter.execute(resolvedPrompt, agentConfig, effectiveCwd);
}

// ── Main run ─────────────────────────────────────────────────────────

export async function run(options: RunOptions): Promise<void> {
  const startTime = Date.now();
  const cwd = options.cwd ?? process.cwd();

  logger.banner();

  // ── Load & validate config ──────────────────────────────────────
  const configFile = path.resolve(cwd, options.configPath);
  const rawYaml = await readFile(configFile, "utf-8");
  const parsed = parseYaml(rawYaml);
  const config: WorkflowConfig = WorkflowSchema.parse(parsed);

  logger.info(`Workflow: ${config.name}`);
  logger.info(`Steps: ${config.steps.map((s) => s.name).join(" → ")}`);
  logger.info(`Agents: ${Object.keys(config.agents).join(", ")}`);

  // ── Check agent availability ────────────────────────────────────
  const usedAgentKeys = new Set(config.steps.map((s) => s.agent).filter(Boolean));
  const usedClis = [
    ...new Set(
      [...usedAgentKeys]
        .map((key) => config.agents[key!]?.cli)
        .filter(Boolean) as string[]
    ),
  ];
  const { available, missing } = await checkAdapters(usedClis);

  if (missing.length > 0) {
    logger.error(`Missing CLIs: ${missing.join(", ")}`);
    logger.dim("  Install them and make sure they're on your PATH.");
    process.exit(1);
  }
  if (available.length > 0) {
    logger.success(`All CLIs available: ${available.join(", ")}`);
  }

  // ── Load spec if provided ───────────────────────────────────────
  let featureSpec = options.spec ?? "";
  if (featureSpec && !featureSpec.includes("\n")) {
    try {
      featureSpec = await readFile(path.resolve(cwd, featureSpec), "utf-8");
    } catch {
      // Not a file, treat as inline spec text
    }
  }

  // ── Dry run ─────────────────────────────────────────────────────
  if (options.dryRun) {
    logger.info("DRY RUN — showing execution plan:\n");
    if (options.worktree) {
      logger.info("Worktree: enabled (will create isolated worktree)");
    }
    const stepGroups = groupSteps(config.steps);
    for (const group of stepGroups) {
      if (group.parallel) {
        logger.info(`Parallel group (${group.steps.length} steps):`);
      }
      for (const step of group.steps) {
        logger.step(step.name);
        if (step.run) {
          logger.dim(`    Run: ${step.run}`);
        } else {
          const agent = config.agents[step.agent!];
          logger.dim(`    Agent: ${step.agent} (${agent?.cli})`);
          logger.dim(`    Prompt: ${step.prompt!.slice(0, 100).trim()}...`);
        }
        if (step.loop) {
          logger.dim(`    Loop: until "${step.loop.until}" (max ${step.loop.max})`);
        }
      }
    }
    return;
  }

  // ── Worktree isolation ──────────────────────────────────────────
  let effectiveCwd = cwd;
  let worktreeInfo: WorktreeInfo | null = null;

  if (options.worktree) {
    worktreeInfo = await createWorktree(cwd);
    effectiveCwd = worktreeInfo.path;
    logger.info(`Worktree: ${worktreeInfo.path}`);
    logger.info(`Branch: ${worktreeInfo.branch}`);
  }

  // ── Execute steps ───────────────────────────────────────────────
  const variables: Record<string, string> = {
    feature_spec: featureSpec,
  };
  const records: StepRecord[] = [];
  let approved = false;
  let totalCostUsd = 0;

  const loopStepIndex = config.steps.findIndex((s) => s.loop);
  const loopConfig = loopStepIndex >= 0 ? config.steps[loopStepIndex]!.loop! : null;
  const maxIterations = loopConfig?.max ?? 1;
  const stepGroups = groupSteps(config.steps);

  // Find re-entry point: the step referenced by the loop condition.
  // On iteration > 1, skip all groups before this point.
  // If the referenced step is inside a parallel group, re-enter at the group start.
  let reEntryIndex = 0;
  if (loopConfig) {
    const condMatch = loopConfig.until.match(/^steps\.([\w\-.]+)\./);
    if (condMatch) {
      const refStepName = condMatch[1];
      const refIndex = config.steps.findIndex((s) => s.name === refStepName);
      if (refIndex >= 0) {
        // Find which group contains this step and use the group's startIndex
        const owningGroup = stepGroups.find(
          (g) => refIndex >= g.startIndex && refIndex < g.startIndex + g.steps.length
        );
        reEntryIndex = owningGroup?.startIndex ?? refIndex;
      }
    }
  }

  try {
  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    for (const group of stepGroups) {
      // ── Skip steps before the loop re-entry point on iteration > 1 ──
      if (iteration > 1 && reEntryIndex > 0 && group.startIndex < reEntryIndex) {
        for (const s of group.steps) {
          logger.dim(`  Skipping "${s.name}" on iteration ${iteration}`);
        }
        continue;
      }

      if (group.parallel && group.steps.length > 1) {
        // ── Parallel execution ──────────────────────────────────
        logger.info(`Running ${group.steps.length} steps in parallel...`);
        for (const s of group.steps) {
          logger.step(s.name, iteration);
        }

        const results = await Promise.all(
          group.steps.map((step) =>
            executeOneStep(step, config, variables, effectiveCwd, worktreeInfo?.baseBranch)
          )
        );

        // Process all results
        for (let j = 0; j < group.steps.length; j++) {
          const step = group.steps[j]!;
          const result = results[j]!;

          variables[`steps.${step.name}.output`] = result.output;
          variables[`steps.${step.name}.exitCode`] = String(result.exitCode);

          if (result.costUsd) totalCostUsd += result.costUsd;

          if (result.timedOut) {
            logger.warn(`${step.name} timed out after ${(result.durationMs / 1000).toFixed(1)}s`);
          } else {
            logger.success(`${step.name} done in ${(result.durationMs / 1000).toFixed(1)}s`);
          }
          logger.output(result.output);

          records.push({
            step: step.name,
            agent: step.run ? "shell" : `${step.agent} (${config.agents[step.agent!]!.cli})`,
            iteration,
            output: result.output,
            exitCode: result.exitCode,
            durationMs: result.durationMs,
            costUsd: result.costUsd,
          });
        }

        // Auto-commit once for the entire parallel group
        if (worktreeInfo) {
          const names = group.steps.map((s) => s.name).join(" + ");
          const committed = await snapshotCommit(
            effectiveCwd,
            `agentloop: ${names} (iteration ${iteration})`
          );
          if (committed) {
            logger.dim(`  Auto-committed: "${names}"`);
          }
        }
      } else {
        // ── Sequential execution ────────────────────────────────
        const step = group.steps[0]!;
        logger.step(step.name, iteration);

        const result = await executeOneStep(
          step, config, variables, effectiveCwd, worktreeInfo?.baseBranch
        );

        variables[`steps.${step.name}.output`] = result.output;
        variables[`steps.${step.name}.exitCode`] = String(result.exitCode);

        if (result.costUsd) totalCostUsd += result.costUsd;

        if (result.timedOut) {
          logger.warn(`Timed out after ${(result.durationMs / 1000).toFixed(1)}s`);
        } else {
          logger.success(`Done in ${(result.durationMs / 1000).toFixed(1)}s`);
        }
        logger.output(result.output);

        // Auto-commit in worktree mode
        if (worktreeInfo) {
          const committed = await snapshotCommit(
            effectiveCwd,
            `agentloop: ${step.name} (iteration ${iteration})`
          );
          if (committed) {
            logger.dim(`  Auto-committed: "${step.name}"`);
          }
        }

        records.push({
          step: step.name,
          agent: step.run ? "shell" : `${step.agent} (${config.agents[step.agent!]!.cli})`,
          iteration,
          output: result.output,
          exitCode: result.exitCode,
          durationMs: result.durationMs,
          costUsd: result.costUsd,
        });

        // Check loop condition (only on sequential steps)
        if (step.loop) {
          if (evaluateCondition(step.loop.until, variables)) {
            approved = true;
            logger.success("Loop condition met — workflow complete!");
            break;
          } else if (iteration < maxIterations) {
            logger.warn(
              `Condition not met: "${step.loop.until}" — looping (${iteration}/${maxIterations})`
            );
          }
        }
      }

      if (approved) break;
    }

    if (approved) break;
  }
  } finally {
    if (worktreeInfo) {
      logger.worktreeSummary(worktreeInfo);
    }
  }

  // ── Summary & Report ────────────────────────────────────────────
  const totalDuration = Date.now() - startTime;
  logger.summary(records.length, totalDuration, approved, loopConfig !== null, totalCostUsd);

  const reportPath = await generateReport(
    config.name,
    records,
    approved,
    totalDuration,
    cwd
  );
  logger.info(`Report saved to: ${reportPath}`);

  if (!approved && loopConfig?.on_max === "fail") {
    process.exit(1);
  }
}
