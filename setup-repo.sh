#!/bin/bash
set -e

# ─────────────────────────────────────────────
#  AgentLoop — GitHub repo setup script
#  
#  Prerequisites:
#    - gh CLI installed (brew install gh / apt install gh)
#    - gh auth login (already authenticated)
#
#  Usage:
#    tar xzf agentloop.tar.gz
#    cd agentloop
#    chmod +x setup-repo.sh
#    ./setup-repo.sh
# ─────────────────────────────────────────────

REPO_NAME="agentloop"
DESCRIPTION="🔁 Multi-agent orchestration for AI coding CLIs. Chain Claude Code, Codex, and more into automated build → audit → fix loops."

echo ""
echo "  🔁 AgentLoop — GitHub Repo Setup"
echo "  ─────────────────────────────────"
echo ""

# Check prerequisites
if ! command -v gh &> /dev/null; then
  echo "  ✖ GitHub CLI (gh) not found."
  echo "    Install: https://cli.github.com/"
  exit 1
fi

if ! gh auth status &> /dev/null; then
  echo "  ✖ Not logged into GitHub. Run: gh auth login"
  exit 1
fi

GH_USER=$(gh api user --jq '.login')
echo "  ℹ Logged in as: $GH_USER"

# Initialize git
echo "  → Initializing git..."
git init -b main
git add -A
git commit -m "feat: initial scaffold — workflow engine, adapters, CLI, examples"

# Create GitHub repo
echo "  → Creating GitHub repo: $GH_USER/$REPO_NAME"
gh repo create "$REPO_NAME" \
  --public \
  --description "$DESCRIPTION" \
  --source . \
  --remote origin \
  --push

# Add topics
echo "  → Adding topics..."
gh repo edit "$GH_USER/$REPO_NAME" \
  --add-topic "ai" \
  --add-topic "multi-agent" \
  --add-topic "orchestration" \
  --add-topic "claude-code" \
  --add-topic "codex" \
  --add-topic "vibe-coding" \
  --add-topic "developer-tools" \
  --add-topic "automation" \
  --add-topic "cli"

# Enable issues, disable wiki (not needed yet)
gh repo edit "$GH_USER/$REPO_NAME" \
  --enable-issues \
  --delete-branch-on-merge

echo ""
echo "  ✔ Done! Your repo is live at:"
echo "    https://github.com/$GH_USER/$REPO_NAME"
echo ""
echo "  Next steps:"
echo "    npm install"
echo "    npm run build"
echo "    npm link            # makes 'agentloop' available globally"
echo "    agentloop init      # in any project"
echo "    agentloop run --spec 'your feature'"
echo ""
