import chalk from "chalk";

export const logger = {
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

  dim(msg: string) {
    console.log(chalk.dim(msg));
  },

  info(msg: string) {
    console.log(`  ${chalk.blue("ℹ")} ${msg}`);
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
   │   🔁  AgentLoop     │
   │   Multi-Agent CLI   │
   ╰─────────────────────╯
`)
    );
  },

  summary(iterations: number, durationMs: number, approved: boolean) {
    const dur = (durationMs / 1000).toFixed(1);
    const status = approved
      ? chalk.bold.green("APPROVED")
      : chalk.bold.yellow("MAX ITERATIONS REACHED");

    console.log(`\n${chalk.dim("─".repeat(45))}`);
    console.log(`  Status:     ${status}`);
    console.log(`  Iterations: ${iterations}`);
    console.log(`  Duration:   ${dur}s`);
    console.log(chalk.dim("─".repeat(45)));
  },
};
