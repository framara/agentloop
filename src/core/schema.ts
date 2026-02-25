import { z } from "zod";

// ── Agent definition ────────────────────────────────────────────────
export const AgentSchema = z.object({
  cli: z
    .enum(["claude-code", "codex", "gemini", "aider", "custom"])
    .describe("Which coding CLI to use"),
  model: z.string().optional().describe("Model override for this agent"),
  system: z.string().optional().describe("System prompt / role for the agent"),
  command: z
    .string()
    .optional()
    .describe("Custom command template (for 'custom' cli type)"),
  allowEdits: z
    .boolean()
    .optional()
    .describe("Allow the agent to edit files (default: read-only / print mode)"),
  timeout: z
    .number()
    .optional()
    .describe("Timeout in minutes for agent execution (default: 10)"),
});

export type AgentConfig = z.infer<typeof AgentSchema>;

// ── Loop condition ──────────────────────────────────────────────────
export const LoopSchema = z.object({
  until: z
    .string()
    .describe('Condition to stop looping, e.g. "steps.audit.output contains APPROVED"'),
  max: z.number().default(5).describe("Maximum number of iterations"),
  on_max: z
    .enum(["pause", "fail", "continue"])
    .default("fail")
    .describe("What to do when max iterations reached"),
});

export type LoopConfig = z.infer<typeof LoopSchema>;

// ── Step definition ─────────────────────────────────────────────────
export const StepSchema = z
  .object({
    name: z.string().describe("Unique step identifier"),
    agent: z
      .string()
      .optional()
      .describe("Key referencing an agent in the agents map"),
    prompt: z
      .string()
      .optional()
      .describe("Prompt template (supports {{ variables }})"),
    run: z
      .string()
      .optional()
      .describe("Shell command to run directly (no agent needed)"),
    parallel: z
      .boolean()
      .optional()
      .describe("Run concurrently with adjacent parallel steps"),
    context: z
      .array(z.string())
      .optional()
      .describe("Files, dirs, or special refs like git:diff to include"),
    loop: LoopSchema.optional().describe("Loop configuration for this step"),
  })
  .refine(
    (s) => (s.agent && s.prompt) || s.run,
    'Step must have either "agent" + "prompt" or "run"'
  )
  .refine(
    (s) => !(s.run && s.agent),
    'Step cannot have both "run" and "agent" — use one or the other'
  )
  .refine(
    (s) => !(s.parallel && s.loop),
    'Parallel steps cannot have "loop" — move the loop to a sequential step'
  );

export type StepConfig = z.infer<typeof StepSchema>;

// ── Top-level workflow ──────────────────────────────────────────────
export const WorkflowSchema = z.object({
  name: z.string().describe("Workflow name"),
  agents: z.record(z.string(), AgentSchema).describe("Named agent definitions"),
  steps: z.array(StepSchema).min(1).describe("Ordered list of steps to execute"),
});

export type WorkflowConfig = z.infer<typeof WorkflowSchema>;
