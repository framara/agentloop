import { execa } from "execa";
import path from "path";
import os from "os";
import crypto from "crypto";

export interface WorktreeInfo {
  /** Absolute path to the worktree directory */
  path: string;
  /** Branch name created for this run */
  branch: string;
  /** Branch or commit the worktree was forked from */
  baseBranch: string;
}

/**
 * Verify the given directory is inside a git repository.
 */
export async function assertGitRepo(cwd: string): Promise<void> {
  try {
    await execa("git", ["rev-parse", "--is-inside-work-tree"], { cwd });
  } catch {
    throw new Error(
      `"${cwd}" is not inside a git repository. --worktree requires git.`
    );
  }
}

/**
 * Create an isolated git worktree for an AgentLoop run.
 * Returns the worktree path, branch name, and base branch.
 */
export async function createWorktree(cwd: string): Promise<WorktreeInfo> {
  await assertGitRepo(cwd);

  const runId = crypto.randomBytes(4).toString("hex");

  // Resolve repo root and use its basename for the temp dir name
  const { stdout: repoRoot } = await execa(
    "git",
    ["rev-parse", "--show-toplevel"],
    { cwd }
  );
  const repoName = path.basename(repoRoot.trim());

  const branch = `agentloop/run-${runId}`;
  const worktreePath = path.join(
    os.tmpdir(),
    `agentloop-${repoName}-${runId}`
  );

  // Get current branch (or commit SHA if detached)
  let baseBranch: string;
  try {
    const { stdout } = await execa(
      "git",
      ["rev-parse", "--abbrev-ref", "HEAD"],
      { cwd }
    );
    baseBranch = stdout.trim();
    // If detached, --abbrev-ref returns "HEAD" — fall back to SHA
    if (baseBranch === "HEAD") {
      const { stdout: sha } = await execa(
        "git",
        ["rev-parse", "HEAD"],
        { cwd }
      );
      baseBranch = sha.trim();
    }
  } catch {
    throw new Error("Failed to determine current branch. Is this repo empty?");
  }

  // Create worktree with a new branch from HEAD
  await execa("git", ["worktree", "add", "-b", branch, worktreePath], { cwd });

  return { path: worktreePath, branch, baseBranch };
}

/**
 * List all agentloop worktrees for the current repo.
 */
export async function listWorktrees(cwd: string): Promise<WorktreeInfo[]> {
  try {
    const { stdout } = await execa("git", ["worktree", "list", "--porcelain"], { cwd });
    if (!stdout.trim()) return [];

    const entries: WorktreeInfo[] = [];
    let currentPath = "";
    let currentBranch = "";

    for (const line of stdout.split("\n")) {
      if (line.startsWith("worktree ")) {
        currentPath = line.slice("worktree ".length);
      } else if (line.startsWith("branch refs/heads/")) {
        currentBranch = line.slice("branch refs/heads/".length);
      } else if (line === "") {
        // End of entry
        if (currentBranch.startsWith("agentloop/")) {
          entries.push({
            path: currentPath,
            branch: currentBranch,
            baseBranch: "", // Not tracked in worktree list
          });
        }
        currentPath = "";
        currentBranch = "";
      }
    }

    // Handle last entry if file doesn't end with newline
    if (currentBranch.startsWith("agentloop/")) {
      entries.push({
        path: currentPath,
        branch: currentBranch,
        baseBranch: "",
      });
    }

    return entries;
  } catch {
    return [];
  }
}

/**
 * Remove a worktree and delete its branch.
 */
export async function removeWorktree(
  cwd: string,
  worktreePath: string,
  branch: string
): Promise<{ removed: boolean; error?: string }> {
  try {
    await execa("git", ["worktree", "remove", worktreePath, "--force"], { cwd });
  } catch (err: any) {
    return { removed: false, error: `Failed to remove worktree: ${err.message}` };
  }

  try {
    await execa("git", ["branch", "-D", branch], { cwd });
  } catch {
    // Branch may already be gone — that's fine
  }

  return { removed: true };
}
