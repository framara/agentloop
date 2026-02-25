import { execa } from "execa";

/**
 * Get the git diff of uncommitted changes in the working directory.
 */
export async function getGitDiff(cwd: string): Promise<string> {
  try {
    // Staged + unstaged changes
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
 * Create a snapshot commit so the auditor can see a clean diff.
 */
export async function snapshotCommit(
  cwd: string,
  message: string
): Promise<boolean> {
  try {
    await execa("git", ["add", "-A"], { cwd });
    await execa("git", ["commit", "-m", message, "--allow-empty"], { cwd });
    return true;
  } catch {
    return false;
  }
}
