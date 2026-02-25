import { execa } from "execa";
import type { AgentConfig } from "../core/schema.js";
import type { AgentAdapter, AgentResult } from "./base.js";
import { logger } from "../utils/logger.js";

export class GeminiAdapter implements AgentAdapter {
  name = "gemini";

  async isAvailable(): Promise<boolean> {
    try {
      await execa("gemini", ["--version"]);
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
    const args: string[] = [];

    if (config.model) {
      args.push("--model", config.model);
    }

    // Pipe prompt via stdin to avoid ARG_MAX limits on large contexts
    args.push("-");

    const timeoutMs = (config.timeout ?? 10) * 60 * 1000;
    const start = Date.now();

    logger.dim(`  → gemini ${args.slice(0, 3).join(" ")}...`);

    try {
      const result = await execa("gemini", args, {
        cwd,
        input: prompt,
        timeout: timeoutMs,
        reject: false,
      });

      if (result.timedOut) {
        return {
          output: `[TIMED OUT] Gemini CLI exceeded the ${config.timeout ?? 10} minute timeout.\n` + (result.stdout || result.stderr || ""),
          exitCode: 1,
          durationMs: Date.now() - start,
          timedOut: true,
        };
      }

      return {
        output: result.stdout || result.stderr || "",
        exitCode: result.exitCode ?? 1,
        durationMs: Date.now() - start,
      };
    } catch (err: any) {
      return {
        output: err.message ?? "Gemini CLI execution failed",
        exitCode: 1,
        durationMs: Date.now() - start,
      };
    }
  }
}
