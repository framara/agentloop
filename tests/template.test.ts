import { describe, it, expect } from "vitest";
import { resolveTemplate, evaluateCondition } from "../src/utils/template.js";

describe("resolveTemplate", () => {
  it("replaces simple variables", () => {
    const result = resolveTemplate("Hello {{ name }}", { name: "world" });
    expect(result).toBe("Hello world");
  });

  it("replaces dotted variables (step outputs)", () => {
    const result = resolveTemplate("Result: {{ steps.build.output }}", {
      "steps.build.output": "success",
    });
    expect(result).toBe("Result: success");
  });

  it("handles hyphenated step names", () => {
    const result = resolveTemplate("{{ steps.security-audit.output }}", {
      "steps.security-audit.output": "APPROVED",
    });
    expect(result).toBe("APPROVED");
  });

  it("leaves unresolved variables as-is", () => {
    const result = resolveTemplate("{{ unknown }}", {});
    expect(result).toBe("{{ unknown }}");
  });

  it("replaces multiple variables in one template", () => {
    const result = resolveTemplate("{{ a }} and {{ b }}", { a: "1", b: "2" });
    expect(result).toBe("1 and 2");
  });

  it("handles whitespace variations in braces", () => {
    const result = resolveTemplate("{{name}} {{  name  }}", { name: "x" });
    expect(result).toBe("x x");
  });
});

describe("evaluateCondition", () => {
  it('evaluates "contains" (case-insensitive)', () => {
    const vars = { "steps.audit.output": "All checks passed. APPROVED" };
    expect(evaluateCondition("steps.audit.output contains APPROVED", vars)).toBe(true);
  });

  it('evaluates "contains" with lowercase match', () => {
    const vars = { "steps.audit.output": "approved by reviewer" };
    expect(evaluateCondition("steps.audit.output contains APPROVED", vars)).toBe(true);
  });

  it("returns false when keyword not found", () => {
    const vars = { "steps.audit.output": "Issues found: 3" };
    expect(evaluateCondition("steps.audit.output contains APPROVED", vars)).toBe(false);
  });

  it('evaluates "contains" with quoted keyword', () => {
    const vars = { "steps.audit.output": "APPROVED" };
    expect(evaluateCondition('steps.audit.output contains "APPROVED"', vars)).toBe(true);
  });

  it('evaluates "==" condition', () => {
    const vars = { "steps.test.exitCode": "0" };
    expect(evaluateCondition("steps.test.exitCode == 0", vars)).toBe(true);
  });

  it('"==" returns false on mismatch', () => {
    const vars = { "steps.test.exitCode": "1" };
    expect(evaluateCondition("steps.test.exitCode == 0", vars)).toBe(false);
  });

  it("returns false for undefined variable", () => {
    expect(evaluateCondition("steps.missing.output contains APPROVED", {})).toBe(false);
  });

  it("returns false for unrecognized condition format", () => {
    expect(evaluateCondition("something weird", {})).toBe(false);
  });
});
