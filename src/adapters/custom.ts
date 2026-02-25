import { execa } from "execa";
import type { AgentConfig } from "../core/schema.js";
import type { AgentAdapter, AgentResult } from "./base.js";
import { logger } from "../utils/logger.js";

/**
 * Runs any CLI command as an agent.
 *
 * The `command` field in the agent config is a shell command template.
 * The placeholder {{prompt}} is replaced with the resolved prompt text.
 *
 * Example config:
 *   agents:
 *     my_agent:
 *       cli: custom
 *       command: "aider --yes-always --message {{prompt}}"
 */
export class CustomAdapter implements AgentAdapter {
  name = "custom";

  async isAvailable(): Promise<boolean> {
    // Custom agents are always "available" — the command itself
    // is validated at execution time.
    return true;
  }

  async execute(
    prompt: string,
    config: AgentConfig,
    cwd: string
  ): Promise<AgentResult> {
    if (!config.command) {
      return {
        output:
          'Custom agent requires a "command" field in config, e.g.: command: "aider --yes-always --message {{prompt}}"',
        exitCode: 1,
        durationMs: 0,
      };
    }

    // Replace {{prompt}} placeholder with the actual prompt.
    // Shell-escape newlines so the prompt survives as a single argument.
    const escapedPrompt = prompt.replace(/'/g, "'\\''");
    const resolved = config.command.replace(
      /\{\{\s*prompt\s*\}\}/g,
      `'${escapedPrompt}'`
    );

    const start = Date.now();

    logger.dim(`  → ${resolved.slice(0, 60)}...`);

    try {
      const result = await execa("sh", ["-c", resolved], {
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
        output: err.message ?? "Custom command execution failed",
        exitCode: 1,
        durationMs: Date.now() - start,
      };
    }
  }
}
