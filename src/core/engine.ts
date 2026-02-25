import { readFile } from "fs/promises";
import path from "path";
import { parse as parseYaml } from "yaml";
import { WorkflowSchema, type WorkflowConfig, type StepConfig } from "./schema.js";
import { getAdapter, checkAdapters } from "../adapters/index.js";
import { getGitDiff } from "../utils/git.js";
import { resolveTemplate, evaluateCondition } from "../utils/template.js";
import { logger } from "../utils/logger.js";
import { generateReport, type StepRecord } from "../utils/report.js";

export interface RunOptions {
  /** Path to the workflow YAML file */
  configPath: string;
  /** Working directory (defaults to cwd) */
  cwd?: string;
  /** Feature spec text or path to a spec file */
  spec?: string;
  /** Dry run — show what would execute without running */
  dryRun?: boolean;
}

export async function run(options: RunOptions): Promise<void> {
  const startTime = Date.now();
  const cwd = options.cwd ?? process.cwd();

  logger.banner();

  // ── Load & validate config ──────────────────────────────────────
  const rawYaml = await readFile(options.configPath, "utf-8");
  const parsed = parseYaml(rawYaml);
  const config: WorkflowConfig = WorkflowSchema.parse(parsed);

  logger.info(`Workflow: ${config.name}`);
  logger.info(`Steps: ${config.steps.map((s) => s.name).join(" → ")}`);
  logger.info(`Agents: ${Object.keys(config.agents).join(", ")}`);

  // ── Check agent availability ────────────────────────────────────
  const clis = [...new Set(Object.values(config.agents).map((a) => a.cli))];
  const { available, missing } = await checkAdapters(clis);

  if (missing.length > 0) {
    logger.error(`Missing CLIs: ${missing.join(", ")}`);
    logger.dim("  Install them and make sure they're on your PATH.");
    process.exit(1);
  }
  logger.success(`All CLIs available: ${available.join(", ")}`);

  // ── Load spec if provided ───────────────────────────────────────
  let featureSpec = options.spec ?? "";
  if (featureSpec && !featureSpec.includes("\n")) {
    // Might be a file path
    try {
      featureSpec = await readFile(path.resolve(cwd, featureSpec), "utf-8");
    } catch {
      // Not a file, treat as inline spec text — that's fine
    }
  }

  // ── Dry run ─────────────────────────────────────────────────────
  if (options.dryRun) {
    logger.info("DRY RUN — showing execution plan:\n");
    for (const step of config.steps) {
      const agent = config.agents[step.agent];
      logger.step(step.name);
      logger.dim(`    Agent: ${step.agent} (${agent?.cli})`);
      logger.dim(`    Prompt: ${step.prompt.slice(0, 100).trim()}...`);
      if (step.loop) {
        logger.dim(`    Loop: until "${step.loop.until}" (max ${step.loop.max})`);
      }
    }
    return;
  }

  // ── Execute steps ───────────────────────────────────────────────
  const variables: Record<string, string> = {
    feature_spec: featureSpec,
  };
  const records: StepRecord[] = [];
  let approved = false;

  // Find the looping step group — in MVP, we support a single loop
  // that wraps from the loop-step back to the step after the first build.
  const loopStepIndex = config.steps.findIndex((s) => s.loop);
  const loopConfig = loopStepIndex >= 0 ? config.steps[loopStepIndex]!.loop! : null;
  const maxIterations = loopConfig?.max ?? 1;

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    for (let i = 0; i < config.steps.length; i++) {
      const step = config.steps[i]!;

      // On iterations > 1, skip steps before the loop-back point
      // (typically: skip the initial build, go straight to fix → audit)
      if (iteration > 1 && i === 0 && loopStepIndex > 0) {
        // Re-run from the step right after the first build
        // Actually, we want to run the "fix" step which references audit output.
        // The simplest approach: on iteration > 1, skip steps that don't reference
        // previous step outputs (i.e., the initial build step).
        if (!step.prompt.includes("steps.")) {
          logger.dim(`  Skipping "${step.name}" on iteration ${iteration}`);
          continue;
        }
      }

      logger.step(step.name, iteration);

      const agentConfig = config.agents[step.agent];
      if (!agentConfig) {
        logger.error(`Agent "${step.agent}" not defined in config`);
        process.exit(1);
      }

      // ── Resolve context ───────────────────────────────────────
      let contextBlock = "";
      if (step.context) {
        for (const ctx of step.context) {
          if (ctx === "git:diff") {
            const diff = await getGitDiff(cwd);
            contextBlock += `\n\n### Git Diff:\n\`\`\`\n${diff}\n\`\`\``;
          } else {
            // Read file or directory listing
            try {
              const content = await readFile(path.resolve(cwd, ctx), "utf-8");
              contextBlock += `\n\n### ${ctx}:\n\`\`\`\n${content}\n\`\`\``;
            } catch {
              logger.warn(`Could not read context: ${ctx}`);
            }
          }
        }
      }

      // ── Resolve prompt template ───────────────────────────────
      const resolvedPrompt = resolveTemplate(
        step.prompt + contextBlock,
        variables
      );

      // ── Execute ───────────────────────────────────────────────
      const adapter = getAdapter(agentConfig.cli);
      const result = await adapter.execute(resolvedPrompt, agentConfig, cwd);

      // Store output for downstream steps
      variables[`steps.${step.name}.output`] = result.output;
      variables[`steps.${step.name}.exitCode`] = String(result.exitCode);

      logger.success(`Done in ${(result.durationMs / 1000).toFixed(1)}s`);
      logger.output(result.output);

      records.push({
        step: step.name,
        agent: `${step.agent} (${agentConfig.cli})`,
        iteration,
        output: result.output,
        exitCode: result.exitCode,
        durationMs: result.durationMs,
      });

      // ── Check loop condition ──────────────────────────────────
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

  // ── Summary & Report ────────────────────────────────────────────
  const totalDuration = Date.now() - startTime;
  logger.summary(records.length, totalDuration, approved);

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
