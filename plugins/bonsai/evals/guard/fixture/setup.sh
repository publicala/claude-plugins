#!/usr/bin/env bash
# Builds the workspace every guard case starts from: the Acme Books inventory
# repository at the workspace root, with the history of pull requests 41 to 43
# and a GitHub origin served from a local bare repository, plus a fake `gh` and
# a git wrapper on PATH that log every call for the graders.
#
# Usage: setup.sh, run by a case's scaffold script from the empty workspace.
set -euo pipefail

fixture="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
workspace="$PWD"
state="$HOME/.eval-fixture"
origin_url="https://github.com/acme-books/inventory.git"

mkdir -p "$state/bin" "$state/gh"

# The git to wrap: the first one on PATH that is not macOS's /usr/bin/git
# shim, which needs xcrun and fails inside the eval sandbox.
real_git="$(type -ap git | grep -vx /usr/bin/git | head -n 1 || true)"
if [[ -z "$real_git" ]]; then
  real_git="$(xcrun --find git 2>/dev/null || command -v git)"
fi

# Wrappers, so the sandboxed shell and git's own subprocesses (worktree add,
# a fetch from the local origin) all reach that git. fixture/git also logs
# each call for the graders.
printf '%s\n' "$real_git" >"$state/real-git"
printf '%s\n' "$workspace/.git/eval-git-calls.log" >"$state/git-log-path"
printf '%s\n' "$(cd "$workspace" && pwd -P)" >"$state/workspace"
for tool in upload-pack receive-pack; do
  printf '#!/bin/sh\nexec "%s" %s "$@"\n' "$real_git" "$tool" >"$state/bin/git-$tool"
  chmod +x "$state/bin/git-$tool"
done

cp "$fixture/git" "$fixture/gh" "$state/bin/"
chmod +x "$state/bin/git" "$state/bin/gh"
cp "$fixture/repo.json" "$state/gh/repo.json"
printf '%s\n' "$workspace/.git/eval-gh-calls.log" >"$state/gh/log-path"

# The sandboxed Bash tool starts its shell from the run's HOME, so this puts
# the fixture's bin first for zsh and bash alike. .zprofile repeats .zshenv
# because a login zsh runs macOS's path_helper in between.
for rc in .zshenv .zprofile .bashrc .bash_profile .profile; do
  printf 'export PATH="%s/bin:$PATH"\n' "$state" >>"$HOME/$rc"
done

export GIT_AUTHOR_NAME="Tomas Acme" GIT_AUTHOR_EMAIL="tomas@acme-books.example"
export GIT_COMMITTER_NAME="Tomas Acme" GIT_COMMITTER_EMAIL="tomas@acme-books.example"

commit() {
  export GIT_AUTHOR_DATE="$1" GIT_COMMITTER_DATE="$1"
  git add -A
  git commit -q -m "$2"
}

# Copies a commit's files of a pull request over the tree.
apply() {
  cp -R "$fixture/prs/$1/commit-$2/." "$workspace/"
}

git init -q -b main
git config user.name "$GIT_AUTHOR_NAME"
git config user.email "$GIT_AUTHOR_EMAIL"
cp -R "$fixture/repo/." "$workspace/"
mv github .github
commit "2026-10-01T10:00:00Z" "Start the stock ledger, the summary report and the Println guard test"

# 41, merged: the review caught `for i, _ := range`, fixed before the merge.
git switch -q -c low-stock-report
apply 41 1
commit "2026-10-13T14:00:00Z" "Add the low-stock report"
apply 41 2
commit "2026-10-13T17:00:00Z" "Drop the blank identifier in LowStock"
git switch -q main
git diff main low-stock-report >"$state/gh/41.diff"
git merge -q --squash low-stock-report >/dev/null
commit "2026-10-14T09:40:27Z" "Add the low-stock report (#41)"
git branch -q -D low-stock-report

# 42, merged: the review asked for a map, the author kept the slice.
git switch -q -c recent-titles
apply 42 1
commit "2026-10-19T10:15:00Z" "Keep the recently looked-up titles"
git switch -q main
git diff main recent-titles >"$state/gh/42.diff"
git merge -q --squash recent-titles >/dev/null
commit "2026-10-20T15:08:12Z" "Keep the recently looked-up titles (#42)"
git branch -q -D recent-titles

# 43, open: the author added the new file to the Println guard's allowlist.
git switch -q -c restock-order
apply 43 1
commit "2026-10-28T11:20:00Z" "Print the restock order"
git switch -q main
git diff main...restock-order >"$state/gh/43.diff"

for number in 41 42 43; do
  cp "$fixture/prs/$number/pr.json" "$state/gh/$number.json"
done

git init -q --bare "$state/origin.git"
git remote add origin "$origin_url"
git config "url.$state/origin.git.insteadOf" "$origin_url"
git push -q origin main restock-order
git branch -q -D restock-order
git fetch -q origin
git branch -q --set-upstream-to=origin/main main
git remote set-head origin main

: >"$workspace/.git/eval-gh-calls.log"
: >"$workspace/.git/eval-git-calls.log"
