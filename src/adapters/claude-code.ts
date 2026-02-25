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
      "--print", // non-interactive mode
      "--output-format",
      "json",
    ];

    if (config.allowEdits) {
      args.push("--dangerously-skip-permissions");
    }

    if (config.model) {
      args.push("--model", config.model);
    }

    if (config.system) {
      args.push("--system-prompt", config.system);
    }

    // Pipe prompt via stdin to avoid ARG_MAX limits on large contexts
    args.push("-");

    const timeoutMs = (config.timeout ?? 10) * 60 * 1000;
    const start = Date.now();

    logger.dim(`  → claude ${args.slice(0, 3).join(" ")}...`);

    try {
      const result = await execa("claude", args, {
        cwd,
        input: prompt,
        timeout: timeoutMs,
        reject: false,
      });

      if (result.timedOut) {
        return {
          output: `[TIMED OUT] Claude Code exceeded the ${config.timeout ?? 10} minute timeout.\n` + (result.stdout || result.stderr || ""),
          exitCode: 1,
          durationMs: Date.now() - start,
          timedOut: true,
        };
      }

      const raw = result.stdout || result.stderr || "";
      let output = raw;
      let costUsd: number | undefined;

      // Parse JSON output for structured result + cost
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed === "object" && parsed !== null) {
          const text = parsed.result ?? parsed.text;
          if (typeof text === "string") {
            output = text;
          }
          costUsd =
            typeof parsed.cost_usd === "number" ? parsed.cost_usd :
            typeof parsed.total_cost_usd === "number" ? parsed.total_cost_usd :
            undefined;
        }
      } catch {
        // Not valid JSON — use raw output as-is
      }

      return {
        output,
        exitCode: result.exitCode ?? 1,
        durationMs: Date.now() - start,
        costUsd,
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
