import { execa } from "execa";
import type { AgentConfig } from "../core/schema.js";
import type { AgentAdapter, AgentResult } from "./base.js";
import { logger } from "../utils/logger.js";

export class CodexAdapter implements AgentAdapter {
  name = "codex";

  async isAvailable(): Promise<boolean> {
    try {
      await execa("codex", ["--version"]);
      return true;
    } catch {
      return false;
    }
  }

  async execute(
    prompt: string,
    config: AgentConfig,
    cwd: string
  ): Promise<AgentResult> {
    const args: string[] = [
      "--quiet",
      "--approval-mode",
      "full-auto",
    ];

    if (config.model) {
      args.push("--model", config.model);
    }

    args.push(prompt);

    const start = Date.now();

    logger.dim(`  → codex ${args.slice(0, 3).join(" ")}...`);

    try {
      const result = await execa("codex", args, {
        cwd,
        timeout: 10 * 60 * 1000,
        reject: false,
      });

      return {
        output: result.stdout || result.stderr,
        exitCode: result.exitCode ?? 1,
        durationMs: Date.now() - start,
      };
    } catch (err: any) {
      return {
        output: err.message ?? "Codex execution failed",
        exitCode: 1,
        durationMs: Date.now() - start,
      };
    }
  }
}
