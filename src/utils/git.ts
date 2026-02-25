import { execa } from "execa";

/**
 * Get the git diff of changes in the working directory.
 * When baseBranch is provided (worktree mode), returns cumulative diff
 * from the base branch — this avoids returning empty diffs after auto-commits.
 */
export async function getGitDiff(cwd: string, baseBranch?: string): Promise<string> {
  try {
    // Worktree mode: cumulative diff from the fork point
    if (baseBranch) {
      const { stdout } = await execa(
        "git",
        ["diff", `${baseBranch}...HEAD`],
        { cwd }
      );
      return stdout || "(no changes from base branch)";
    }

    // Normal mode: staged + unstaged changes
    const { stdout: staged } = await execa("git", ["diff", "--cached"], { cwd });
    const { stdout: unstaged } = await execa("git", ["diff"], { cwd });

    const combined = [staged, unstaged].filter(Boolean).join("\n");

    if (!combined.trim()) {
      // Fall back to diff against HEAD
      const { stdout: headDiff } = await execa(
        "git",
        ["diff", "HEAD"],
        { cwd }
      );
      return headDiff || "(no changes detected)";
    }

    return combined;
  } catch {
    return "(git diff unavailable — not a git repository?)";
  }
}

/**
 * Get a summary of changed files.
 */
export async function getChangedFiles(cwd: string): Promise<string[]> {
  try {
    const { stdout } = await execa(
      "git",
      ["diff", "--name-only", "HEAD"],
      { cwd }
    );
    return stdout.split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Create a snapshot commit if there are changes.
 * Returns true if a commit was created, false if working tree was clean.
 */
export async function snapshotCommit(
  cwd: string,
  message: string
): Promise<boolean> {
  try {
    await execa("git", ["add", "-A"], { cwd });
    const { stdout } = await execa("git", ["status", "--porcelain"], { cwd });
    if (!stdout.trim()) return false;
    await execa("git", ["commit", "-m", message], { cwd });
    return true;
  } catch {
    return false;
  }
}
