import type { AgentAdapter } from "./base.js";
import { ClaudeCodeAdapter } from "./claude-code.js";
import { CodexAdapter } from "./codex.js";
import { GeminiAdapter } from "./gemini.js";
import { CustomAdapter } from "./custom.js";

const customAdapter = new CustomAdapter();

const adapters: Record<string, AgentAdapter> = {
  "claude-code": new ClaudeCodeAdapter(),
  codex: new CodexAdapter(),
  gemini: new GeminiAdapter(),
  aider: customAdapter,
  custom: customAdapter,
};

export function getAdapter(cli: string): AgentAdapter {
  const adapter = adapters[cli];
  if (!adapter) {
    throw new Error(
      `No adapter for CLI "${cli}". Available: ${Object.keys(adapters).join(", ")}`
    );
  }
  return adapter;
}

export async function checkAdapters(
  clis: string[]
): Promise<{ available: string[]; missing: string[] }> {
  const available: string[] = [];
  const missing: string[] = [];

  for (const cli of clis) {
    const adapter = adapters[cli];
    if (adapter && (await adapter.isAvailable())) {
      available.push(cli);
    } else {
      missing.push(cli);
    }
  }

  return { available, missing };
}
