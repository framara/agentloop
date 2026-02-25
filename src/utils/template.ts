/**
 * Simple Mustache-style template resolver.
 * Supports {{ variable }} and {{ steps.stepName.output }} syntax.
 */
export function resolveTemplate(
  template: string,
  variables: Record<string, string>
): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, key: string) => {
    const value = variables[key];
    if (value === undefined) {
      return match; // Leave unresolved variables as-is
    }
    return value;
  });
}

/**
 * Evaluate a simple condition string.
 * Supports: "steps.<name>.output contains <keyword>"
 */
export function evaluateCondition(
  condition: string,
  variables: Record<string, string>
): boolean {
  // Pattern: "steps.audit.output contains APPROVED"
  const containsMatch = condition.match(
    /^([\w.]+)\s+contains\s+"?([^"]+)"?$/i
  );

  if (containsMatch) {
    const [, varPath, keyword] = containsMatch;
    const value = variables[varPath!] ?? "";
    return value.toUpperCase().includes(keyword!.toUpperCase());
  }

  // Pattern: "steps.audit.exitCode == 0"
  const equalsMatch = condition.match(/^([\w.]+)\s*==\s*(.+)$/);
  if (equalsMatch) {
    const [, varPath, expected] = equalsMatch;
    const value = variables[varPath!] ?? "";
    return value.trim() === expected!.trim();
  }

  return false;
}
