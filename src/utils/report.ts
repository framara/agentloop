import { writeFile } from "fs/promises";
import path from "path";

export interface StepRecord {
  step: string;
  agent: string;
  iteration: number;
  output: string;
  exitCode: number;
  durationMs: number;
}

export async function generateReport(
  workflowName: string,
  records: StepRecord[],
  approved: boolean,
  totalDurationMs: number,
  cwd: string
): Promise<string> {
  const lines: string[] = [
    `# AgentLoop Run Report`,
    ``,
    `**Workflow:** ${workflowName}`,
    `**Status:** ${approved ? "✅ Approved" : "⚠️ Max iterations reached"}`,
    `**Total duration:** ${(totalDurationMs / 1000).toFixed(1)}s`,
    `**Steps executed:** ${records.length}`,
    ``,
    `---`,
    ``,
  ];

  for (const record of records) {
    lines.push(`## Step: ${record.step} (iteration ${record.iteration})`);
    lines.push(``);
    lines.push(`- **Agent:** ${record.agent}`);
    lines.push(`- **Exit code:** ${record.exitCode}`);
    lines.push(`- **Duration:** ${(record.durationMs / 1000).toFixed(1)}s`);
    lines.push(``);
    lines.push(`<details>`);
    lines.push(`<summary>Output</summary>`);
    lines.push(``);
    lines.push("```");
    lines.push(record.output.slice(0, 5000)); // Truncate very long outputs
    lines.push("```");
    lines.push(``);
    lines.push(`</details>`);
    lines.push(``);
  }

  const reportContent = lines.join("\n");
  const reportPath = path.join(cwd, `agentloop-report-${Date.now()}.md`);
  await writeFile(reportPath, reportContent, "utf-8");

  return reportPath;
}
