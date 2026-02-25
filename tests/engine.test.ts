import { describe, it, expect } from "vitest";

// We need to test groupSteps which is not exported, so we'll test it
// indirectly through the engine's behavior. For direct testing, we
// replicate the logic here to validate the grouping algorithm.

interface StepConfig {
  name: string;
  parallel?: boolean;
  [key: string]: unknown;
}

interface StepGroup {
  parallel: boolean;
  steps: StepConfig[];
  startIndex: number;
}

// Mirror of the groupSteps function from engine.ts
function groupSteps(steps: StepConfig[]): StepGroup[] {
  const groups: StepGroup[] = [];
  let i = 0;

  while (i < steps.length) {
    if (steps[i]!.parallel) {
      const startIndex = i;
      const batch: StepConfig[] = [];
      while (i < steps.length && steps[i]!.parallel) {
        batch.push(steps[i]!);
        i++;
      }
      groups.push({ parallel: true, steps: batch, startIndex });
    } else {
      groups.push({ parallel: false, steps: [steps[i]!], startIndex: i });
      i++;
    }
  }

  return groups;
}

describe("groupSteps", () => {
  it("groups sequential steps individually", () => {
    const steps = [
      { name: "a" },
      { name: "b" },
      { name: "c" },
    ];
    const groups = groupSteps(steps);
    expect(groups).toHaveLength(3);
    expect(groups[0]).toEqual({ parallel: false, steps: [{ name: "a" }], startIndex: 0 });
    expect(groups[1]).toEqual({ parallel: false, steps: [{ name: "b" }], startIndex: 1 });
    expect(groups[2]).toEqual({ parallel: false, steps: [{ name: "c" }], startIndex: 2 });
  });

  it("groups consecutive parallel steps together", () => {
    const steps = [
      { name: "build" },
      { name: "lint", parallel: true },
      { name: "test", parallel: true },
      { name: "fix" },
    ];
    const groups = groupSteps(steps);
    expect(groups).toHaveLength(3);
    expect(groups[0]).toEqual({ parallel: false, steps: [{ name: "build" }], startIndex: 0 });
    expect(groups[1]).toEqual({
      parallel: true,
      steps: [{ name: "lint", parallel: true }, { name: "test", parallel: true }],
      startIndex: 1,
    });
    expect(groups[2]).toEqual({ parallel: false, steps: [{ name: "fix" }], startIndex: 3 });
  });

  it("handles all parallel steps", () => {
    const steps = [
      { name: "a", parallel: true },
      { name: "b", parallel: true },
    ];
    const groups = groupSteps(steps);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.parallel).toBe(true);
    expect(groups[0]!.steps).toHaveLength(2);
  });

  it("handles single parallel step as its own group", () => {
    const steps = [
      { name: "a" },
      { name: "b", parallel: true },
      { name: "c" },
    ];
    const groups = groupSteps(steps);
    expect(groups).toHaveLength(3);
    expect(groups[1]!.parallel).toBe(true);
    expect(groups[1]!.steps).toHaveLength(1);
  });

  it("handles empty array", () => {
    expect(groupSteps([])).toEqual([]);
  });
});

describe("re-entry point calculation", () => {
  // Mirror of the re-entry logic from engine.ts
  function findReEntryIndex(
    steps: StepConfig[],
    groups: StepGroup[],
    loopUntil: string
  ): number {
    const condMatch = loopUntil.match(/^steps\.([\w\-.]+)\./);
    if (!condMatch) return 0;

    const refStepName = condMatch[1];
    const refIndex = steps.findIndex((s) => s.name === refStepName);
    if (refIndex < 0) return 0;

    const owningGroup = groups.find(
      (g) => refIndex >= g.startIndex && refIndex < g.startIndex + g.steps.length
    );
    return owningGroup?.startIndex ?? refIndex;
  }

  it("finds re-entry for simple sequential workflow", () => {
    const steps = [
      { name: "build" },
      { name: "audit" },
      { name: "fix" },
    ];
    const groups = groupSteps(steps);
    const idx = findReEntryIndex(steps, groups, "steps.audit.output contains APPROVED");
    expect(idx).toBe(1); // Re-enter at audit (index 1), skip build
  });

  it("finds re-entry at parallel group start", () => {
    const steps = [
      { name: "build" },
      { name: "lint", parallel: true },
      { name: "test", parallel: true },
      { name: "security-audit", parallel: true },
      { name: "fix" },
    ];
    const groups = groupSteps(steps);
    const idx = findReEntryIndex(steps, groups, "steps.security-audit.output contains APPROVED");
    // security-audit is at flat index 3, but its group starts at index 1
    expect(idx).toBe(1); // Re-enter at the parallel group, not at security-audit alone
  });

  it("handles hyphenated step names in condition", () => {
    const steps = [
      { name: "build" },
      { name: "code-review" },
      { name: "fix" },
    ];
    const groups = groupSteps(steps);
    const idx = findReEntryIndex(steps, groups, "steps.code-review.output contains APPROVED");
    expect(idx).toBe(1);
  });

  it("returns 0 for unrecognized condition", () => {
    const steps = [{ name: "build" }];
    const groups = groupSteps(steps);
    expect(findReEntryIndex(steps, groups, "something weird")).toBe(0);
  });

  it("returns 0 for missing step reference", () => {
    const steps = [{ name: "build" }];
    const groups = groupSteps(steps);
    expect(findReEntryIndex(steps, groups, "steps.nonexistent.output contains X")).toBe(0);
  });
});
