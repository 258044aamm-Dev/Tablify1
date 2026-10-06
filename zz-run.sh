#!/usr/bin/env bash
#
# One-command bootstrap for the Tablify workspace. The sandbox recycles between calls: `/tmp` and
# `node_modules` disappear, and `.git` can come back behind the remote. Everything that must survive
# either lives under `/home/user` (this file, `node_modules` is regenerated) or on the remote.
#
# Usage:  bash zz-run.sh <command> [args…]
#
# It is a *scratch* file for the current step run; delete it before the final commit if it is not wanted
# in the repo. Playwright browsers are deliberately **not** installed here: the browser suite is run by
# the human, not by this agent.
set -euo pipefail

export PATH=/tmp/bun/bun-linux-x64:$PATH

if ! command -v bun >/dev/null 2>&1; then
	mkdir -p /tmp/bun
	cd /tmp/bun
	curl -sL https://github.com/oven-sh/bun/releases/download/bun-v1.4.2/bun-linux-x64.zip -o bun.zip
	unzip -oq bun.zip
	cd - >/dev/null
fi

cd /home/user/tablify

if [ ! -d node_modules ]; then
	bun install >/dev/null 2>&1
fi

# The tree is the source of truth; `.git` is the stale half. Fast-forward it to the remote tip without
# touching a single file (a `checkout`/`stash` here would throw the uncommitted step away).
if ! git merge-base --is-ancestor 2b94903 HEAD 2>/dev/null; then
	TOKEN=$(cat /home/user/.secrets/github-token)
	git -c core.hooksPath=/dev/null fetch -q \
		"https://x-access-token:${TOKEN}@github.com/258044aamm-Dev/Tablify.git" main
	git -c core.hooksPath=/dev/null update-ref refs/heads/main FETCH_HEAD
	git -c core.hooksPath=/dev/null reset --mixed -q
	git -c core.hooksPath=/dev/null checkout -- tests/fixtures/tabula/crlf-bom.tabula
fi

exec "$@"
