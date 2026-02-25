import { describe, it, expect } from "vitest";
import { WorkflowSchema, StepSchema, AgentSchema } from "../src/core/schema.js";

describe("AgentSchema", () => {
  it("validates a minimal agent", () => {
    const result = AgentSchema.safeParse({ cli: "claude-code" });
    expect(result.success).toBe(true);
  });

  it("validates agent with all fields", () => {
    const result = AgentSchema.safeParse({
      cli: "custom",
      model: "gpt-4",
      system: "You are helpful",
      command: "aider --message {{prompt}}",
    });
    expect(result.success).toBe(true);
  });

  it("rejects unknown cli type", () => {
    const result = AgentSchema.safeParse({ cli: "unknown" });
    expect(result.success).toBe(false);
  });
});

describe("StepSchema", () => {
  it("validates agent step with agent + prompt", () => {
    const result = StepSchema.safeParse({
      name: "build",
      agent: "builder",
      prompt: "Build it",
    });
    expect(result.success).toBe(true);
  });

  it("validates shell step with run", () => {
    const result = StepSchema.safeParse({
      name: "test",
      run: "npm test",
    });
    expect(result.success).toBe(true);
  });

  it("rejects step with neither agent nor run", () => {
    const result = StepSchema.safeParse({ name: "empty" });
    expect(result.success).toBe(false);
  });

  it("rejects step with both agent and run", () => {
    const result = StepSchema.safeParse({
      name: "bad",
      agent: "builder",
      prompt: "do stuff",
      run: "npm test",
    });
    expect(result.success).toBe(false);
  });

  it("rejects step with agent but no prompt", () => {
    const result = StepSchema.safeParse({
      name: "bad",
      agent: "builder",
    });
    expect(result.success).toBe(false);
  });

  it("rejects parallel step with loop", () => {
    const result = StepSchema.safeParse({
      name: "bad",
      run: "npm test",
      parallel: true,
      loop: { until: "steps.test.exitCode == 0" },
    });
    expect(result.success).toBe(false);
  });

  it("accepts parallel step without loop", () => {
    const result = StepSchema.safeParse({
      name: "test",
      run: "npm test",
      parallel: true,
    });
    expect(result.success).toBe(true);
  });
});

describe("WorkflowSchema", () => {
  it("validates a minimal workflow", () => {
    const result = WorkflowSchema.safeParse({
      name: "test",
      agents: { builder: { cli: "claude-code" } },
      steps: [{ name: "build", agent: "builder", prompt: "Build it" }],
    });
    expect(result.success).toBe(true);
  });

  it("validates workflow with mixed step types", () => {
    const result = WorkflowSchema.safeParse({
      name: "mixed",
      agents: { builder: { cli: "claude-code" } },
      steps: [
        { name: "build", agent: "builder", prompt: "Build it" },
        { name: "test", run: "npm test" },
        { name: "lint", run: "eslint .", parallel: true },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects workflow with no steps", () => {
    const result = WorkflowSchema.safeParse({
      name: "empty",
      agents: { builder: { cli: "claude-code" } },
      steps: [],
    });
    expect(result.success).toBe(false);
  });
});
