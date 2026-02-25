import { execa } from "execa";
import type { AgentConfig } from "../core/schema.js";
import type { AgentAdapter, AgentResult } from "./base.js";
import { logger } from "../utils/logger.js";

export class ClaudeCodeAdapter implements AgentAdapter {
  name = "claude-code";

  async isAvailable(): Promise<boolean> {
    try {
      await execa("claude", ["--version"]);
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
      "--print", // non-interactive mode, prints response to stdout
      "--output-format",
      "text",
    ];

    if (config.model) {
      args.push("--model", config.model);
    }

    if (config.system) {
      args.push("--system-prompt", config.system);
    }

    args.push(prompt);

    const start = Date.now();

    logger.dim(`  → claude ${args.slice(0, 3).join(" ")}...`);

    try {
      const result = await execa("claude", args, {
        cwd,
        timeout: 10 * 60 * 1000, // 10 min timeout
        reject: false,
      });

      return {
        output: result.stdout || result.stderr,
        exitCode: result.exitCode ?? 1,
        durationMs: Date.now() - start,
      };
    } catch (err: any) {
      return {
        output: err.message ?? "Claude Code execution failed",
        exitCode: 1,
        durationMs: Date.now() - start,
      };
    }
  }
}
