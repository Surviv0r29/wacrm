#!/usr/bin/env bash
# Remove all git remotes so this copy is no longer tied to GitHub.
# Local commit history is kept; only remote URLs are removed.
#
# Usage:
#   bash scripts/disconnect-git.sh
#   bash scripts/disconnect-git.sh --remove-origin-only

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Not a git repository — nothing to disconnect."
  exit 0
fi

ONLY_ORIGIN=false
if [[ "${1:-}" == "--remove-origin-only" ]]; then
  ONLY_ORIGIN=true
fi

echo "Current remotes:"
git remote -v || true
echo

remove_remote() {
  local name="$1"
  if git remote get-url "$name" >/dev/null 2>&1; then
    git remote remove "$name"
    echo "Removed remote: $name"
  fi
}

remove_remote origin

if [[ "$ONLY_ORIGIN" == false ]]; then
  for remote in $(git remote); do
    remove_remote "$remote"
  done
fi

echo
echo "Remotes after disconnect:"
git remote -v 2>/dev/null || echo "(none)"
echo
echo "Done. This folder is now a standalone local repo with no upstream."
echo "To deploy on Ubuntu, copy the project to the server and run:"
echo "  sudo bash scripts/deploy-ubuntu.sh --install"
