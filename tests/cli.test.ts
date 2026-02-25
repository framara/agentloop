import { describe, it, expect } from "vitest";
import { execa } from "execa";
import { mkdtemp, readFile, rm, writeFile, chmod, mkdir } from "fs/promises";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

async function writeExecutable(filePath: string, body: string): Promise<void> {
  await writeFile(filePath, body, "utf-8");
  await chmod(filePath, 0o755);
}

async function runCli(
  promptArgs: string[],
  env: Record<string, string>
): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number | null;
}> {
  const result = await execa(
    "node",
    ["--import", "tsx", "src/cli.ts", ...promptArgs],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        ...env,
      },
      reject: false,
    }
  );

  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
  };
}

describe.sequential("cli simple loop", () => {
  it("joins prompt args into a single prompt sent to Claude", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "agentloop-cli-test-"));
    const binDir = path.join(dir, "bin");
    const claudeInputPath = path.join(dir, "claude-input.txt");

    try {
      await mkdir(binDir, { recursive: true });
      await writeExecutable(
        path.join(binDir, "claude"),
        `#!/bin/sh
cat > "$CLAUDE_INPUT_PATH"
printf '{"type":"result","result":"build ok","total_cost_usd":0.01}\\n'
`
      );
      await writeExecutable(
        path.join(binDir, "codex"),
        `#!/bin/sh
printf 'APPROVED\\n'
`
      );

      const result = await runCli(
        ["add", "dark", "mode"],
        {
          PATH: `${binDir}:${process.env.PATH ?? ""}`,
          CLAUDE_INPUT_PATH: claudeInputPath,
        }
      );

      expect(result.exitCode).toBe(0);
      const captured = await readFile(claudeInputPath, "utf-8");
      expect(captured).toBe("add dark mode");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not treat 'NOT APPROVED' as approval, and continues to fix loop", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "agentloop-cli-test-"));
    const binDir = path.join(dir, "bin");
    const claudeCallsPath = path.join(dir, "claude-calls.txt");
    const codexCountPath = path.join(dir, "codex-count.txt");

    try {
      await mkdir(binDir, { recursive: true });
      await writeExecutable(
        path.join(binDir, "claude"),
        `#!/bin/sh
echo "call" >> "$CLAUDE_CALLS_PATH"
printf '{"type":"result","result":"ok","total_cost_usd":0.01}\\n'
`
      );
      await writeExecutable(
        path.join(binDir, "codex"),
        `#!/bin/sh
count=0
if [ -f "$CODEX_COUNT_PATH" ]; then
  count=$(cat "$CODEX_COUNT_PATH")
fi
count=$((count + 1))
echo "$count" > "$CODEX_COUNT_PATH"
if [ "$count" -eq 1 ]; then
  printf 'NOT APPROVED\\n'
else
  printf 'APPROVED\\n'
fi
`
      );

      const result = await runCli(
        ["feature", "request"],
        {
          PATH: `${binDir}:${process.env.PATH ?? ""}`,
          CLAUDE_CALLS_PATH: claudeCallsPath,
          CODEX_COUNT_PATH: codexCountPath,
        }
      );

      expect(result.exitCode).toBe(0);
      const claudeCalls = (await readFile(claudeCallsPath, "utf-8"))
        .trim()
        .split("\n")
        .filter(Boolean);
      // Build + Fix should both run.
      expect(claudeCalls).toHaveLength(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("fails fast when review command exits non-zero", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "agentloop-cli-test-"));
    const binDir = path.join(dir, "bin");
    const claudeCallsPath = path.join(dir, "claude-calls.txt");

    try {
      await mkdir(binDir, { recursive: true });
      await writeExecutable(
        path.join(binDir, "claude"),
        `#!/bin/sh
echo "call" >> "$CLAUDE_CALLS_PATH"
printf '{"type":"result","result":"ok","total_cost_usd":0.01}\\n'
`
      );
      await writeExecutable(
        path.join(binDir, "codex"),
        `#!/bin/sh
printf 'review failed\\n' >&2
exit 2
`
      );

      const result = await runCli(
        ["feature", "request"],
        {
          PATH: `${binDir}:${process.env.PATH ?? ""}`,
          CLAUDE_CALLS_PATH: claudeCallsPath,
        }
      );

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain("Review failed");
      const claudeCalls = (await readFile(claudeCallsPath, "utf-8"))
        .trim()
        .split("\n")
        .filter(Boolean);
      // Build ran once, then exited before Fix.
      expect(claudeCalls).toHaveLength(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("treats suggestion-only review as non-blocking and stops", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "agentloop-cli-test-"));
    const binDir = path.join(dir, "bin");
    const claudeCallsPath = path.join(dir, "claude-calls.txt");

    try {
      await mkdir(binDir, { recursive: true });
      await writeExecutable(
        path.join(binDir, "claude"),
        `#!/bin/sh
echo "call" >> "$CLAUDE_CALLS_PATH"
printf '{"type":"result","result":"ok","total_cost_usd":0.01}\\n'
`
      );
      await writeExecutable(
        path.join(binDir, "codex"),
        `#!/bin/sh
cat <<'EOF'
OpenAI Codex v0.104.0 (research preview)
--------
workdir: /tmp/example
model: gpt-5.3-codex
provider: openai
approval: never
sandbox: workspace-write
reasoning effort: high
reasoning summaries: auto
session id: abc-123
--------
user
current changes
mcp: revenuecat starting
mcp: XcodeBuildMCP ready
Suggestion: rename variable for readability.
EOF
`
      );

      const result = await runCli(
        ["feature", "request"],
        {
          PATH: `${binDir}:${process.env.PATH ?? ""}`,
          CLAUDE_CALLS_PATH: claudeCallsPath,
        }
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("No blocking issues");
      expect(result.stdout).toContain("Suggestion: rename variable for readability.");
      expect(result.stdout).not.toContain("workdir:");
      expect(result.stdout).not.toContain("mcp:");
      const claudeCalls = (await readFile(claudeCallsPath, "utf-8"))
        .trim()
        .split("\n")
        .filter(Boolean);
      // Build only; no Fix loop for non-blocking feedback.
      expect(claudeCalls).toHaveLength(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
