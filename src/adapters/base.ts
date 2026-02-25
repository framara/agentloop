import type { AgentConfig } from "../core/schema.js";

export interface AgentResult {
  output: string;
  exitCode: number;
  durationMs: number;
  costUsd?: number;
  timedOut?: boolean;
}

export interface AgentAdapter {
  name: string;

  /**
   * Check if the CLI tool is installed and accessible.
   */
  isAvailable(): Promise<boolean>;

  /**
   * Execute a prompt against the coding agent.
   * @param prompt   The fully-resolved prompt string
   * @param config   Agent config from the workflow YAML
   * @param cwd      Working directory for file operations
   */
  execute(prompt: string, config: AgentConfig, cwd: string): Promise<AgentResult>;
}
