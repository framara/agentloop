import chalk from "chalk";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
let spinnerTimer: ReturnType<typeof setInterval> | null = null;
let spinnerFrame = 0;
let spinnerStartMs = 0;
let spinnerText = "";

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

export const logger = {
  spinnerStart(text: string) {
    this.spinnerStop();
    spinnerFrame = 0;
    spinnerStartMs = Date.now();
    spinnerText = text;
    spinnerTimer = setInterval(() => {
      const frame = SPINNER_FRAMES[spinnerFrame % SPINNER_FRAMES.length];
      const elapsed = formatElapsed(Date.now() - spinnerStartMs);
      process.stderr.write(`\r\x1b[K  ${chalk.cyan(frame!)} ${chalk.dim(spinnerText)} ${chalk.dim(`(${elapsed})`)}`);
      spinnerFrame++;
    }, 80);
  },

  spinnerUpdate(text: string) {
    spinnerText = text;
  },

  spinnerStop() {
    if (spinnerTimer) {
      clearInterval(spinnerTimer);
      spinnerTimer = null;
      process.stderr.write("\r\x1b[K"); // clear the spinner line
    }
  },

  step(name: string, iteration?: number) {
    const iter = iteration !== undefined ? chalk.dim(` (iteration ${iteration})`) : "";
    console.log(`\n${chalk.bold.cyan("▶")} ${chalk.bold(name)}${iter}`);
  },

  success(msg: string) {
    console.log(`  ${chalk.green("✔")} ${msg}`);
  },

  warn(msg: string) {
    console.log(`  ${chalk.yellow("⚠")} ${msg}`);
  },

  error(msg: string) {
    console.log(`  ${chalk.red("✖")} ${msg}`);
  },

  output(text: string, maxLines = 20) {
    const lines = text.split("\n");
    const truncated = lines.length > maxLines;
    const display = truncated ? lines.slice(0, maxLines) : lines;

    console.log(chalk.dim("  ┌─────────────────────────────────────"));
    for (const line of display) {
      console.log(chalk.dim("  │ ") + line);
    }
    if (truncated) {
      console.log(chalk.dim(`  │ ... (${lines.length - maxLines} more lines)`));
    }
    console.log(chalk.dim("  └─────────────────────────────────────"));
  },

  banner() {
    console.log(
      chalk.bold.cyan(`
   ╭─────────────────────╮
   │   🔁 AgentLooper    │
   │   Multi-Agent CLI   │
   ╰─────────────────────╯
`)
    );
  },

  summary(
    stepCount: number,
    durationMs: number,
    approved: boolean,
    totalCostUsd?: number
  ) {
    const dur = (durationMs / 1000).toFixed(1);
    const status = approved
      ? chalk.bold.green("APPROVED")
      : chalk.bold.yellow("MAX ITERATIONS REACHED");

    console.log(`\n${chalk.dim("─".repeat(45))}`);
    console.log(`  Status:     ${status}`);
    console.log(`  Steps run:  ${stepCount}`);
    console.log(`  Duration:   ${dur}s`);
    if (totalCostUsd !== undefined && totalCostUsd > 0) {
      console.log(`  Est. cost:  ${chalk.yellow(`$${totalCostUsd.toFixed(4)}`)}`);
    }
    console.log(chalk.dim("─".repeat(45)));
  },
};
