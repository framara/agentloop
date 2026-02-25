import { describe, it, expect } from "vitest";
import { execa } from "execa";
import { mkdtemp, rm } from "fs/promises";
import path from "path";
import os from "os";
import { getGitDiff, snapshotCommit } from "../src/utils/git.js";
import { createWorktree, listWorktrees, removeWorktree } from "../src/utils/worktree.js";

async function createTempGitRepo(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agentloop-test-"));
  await execa("git", ["init"], { cwd: dir });
  await execa("git", ["config", "user.email", "test@test.com"], { cwd: dir });
  await execa("git", ["config", "user.name", "Test"], { cwd: dir });
  // Create initial commit so HEAD exists
  await execa("git", ["commit", "--allow-empty", "-m", "init"], { cwd: dir });
  return dir;
}

describe("getGitDiff", () => {
  it("returns no changes for clean repo", async () => {
    const dir = await createTempGitRepo();
    try {
      const diff = await getGitDiff(dir);
      expect(diff).toBe("(no changes detected)");
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("returns diff for uncommitted changes", async () => {
    const dir = await createTempGitRepo();
    try {
      const { writeFile } = await import("fs/promises");
      await writeFile(path.join(dir, "test.txt"), "hello");
      await execa("git", ["add", "test.txt"], { cwd: dir });
      const diff = await getGitDiff(dir);
      expect(diff).toContain("test.txt");
      expect(diff).toContain("+hello");
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("returns cumulative diff when baseBranch is provided", async () => {
    const dir = await createTempGitRepo();
    try {
      const { writeFile } = await import("fs/promises");
      // Create a branch and make changes
      await execa("git", ["checkout", "-b", "feature"], { cwd: dir });
      await writeFile(path.join(dir, "feature.txt"), "new feature");
      await execa("git", ["add", "feature.txt"], { cwd: dir });
      await execa("git", ["commit", "-m", "add feature"], { cwd: dir });

      const diff = await getGitDiff(dir, "main");
      expect(diff).toContain("feature.txt");
      expect(diff).toContain("+new feature");
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});

describe("snapshotCommit", () => {
  it("returns false when no changes to commit", async () => {
    const dir = await createTempGitRepo();
    try {
      const committed = await snapshotCommit(dir, "test commit");
      expect(committed).toBe(false);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("commits when there are changes", async () => {
    const dir = await createTempGitRepo();
    try {
      const { writeFile } = await import("fs/promises");
      await writeFile(path.join(dir, "file.txt"), "content");
      const committed = await snapshotCommit(dir, "test commit");
      expect(committed).toBe(true);

      // Verify commit exists
      const { stdout } = await execa("git", ["log", "--oneline", "-1"], { cwd: dir });
      expect(stdout).toContain("test commit");
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});

describe("worktree", () => {
  it("creates and removes a worktree", async () => {
    const dir = await createTempGitRepo();
    try {
      const info = await createWorktree(dir);

      expect(info.branch).toMatch(/^agentloop\/run-/);
      expect(info.baseBranch).toBeTruthy();

      // Verify worktree exists
      const { existsSync } = await import("fs");
      expect(existsSync(info.path)).toBe(true);

      // Verify it shows in list
      const worktrees = await listWorktrees(dir);
      expect(worktrees.length).toBeGreaterThanOrEqual(1);
      expect(worktrees.some((w) => w.branch === info.branch)).toBe(true);

      // Clean up
      const result = await removeWorktree(dir, info.path, info.branch);
      expect(result.removed).toBe(true);

      // Verify it's gone
      const afterCleanup = await listWorktrees(dir);
      expect(afterCleanup.some((w) => w.branch === info.branch)).toBe(false);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("worktree has correct baseBranch", async () => {
    const dir = await createTempGitRepo();
    try {
      const { stdout } = await execa("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: dir });
      const info = await createWorktree(dir);

      expect(info.baseBranch).toBe(stdout.trim());

      // Clean up
      await removeWorktree(dir, info.path, info.branch);
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});
