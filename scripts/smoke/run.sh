#!/usr/bin/env bash
# Consumer smoke test: installs the packed packages into a fresh npm project
# (outside the workspace, as a user would), typechecks `project/`, then
# deploys and destroys it on a fresh test-controller site. The typecheck
# includes every TypeScript block in the user docs, package READMEs and
# doc comments. Needs a build and a
# running test controller. Usage: scripts/smoke/run.sh [--no-deploy]
set -euo pipefail
cd "$(dirname "$0")/../.."
root="$PWD"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

for package in network-sdk network; do
	(cd "packages/$package" && pnpm pack --pack-destination "$work" >/dev/null)
done

# The provider's peers, at the ranges it declares.
peers="$(node -p 'Object.entries(require("./packages/network/package.json").peerDependencies).map(([n, r]) => `${n}@${r}`).join(" ")')"

cp -R scripts/smoke/project/. "$work/project"
cd "$work/project"
# shellcheck disable=SC2086 # peers is a list
npm install --no-audit --no-fund --loglevel=error "$work"/*.tgz $peers typescript @types/node
node "$root/scripts/smoke/examples.ts" examples
npx tsc -p tsconfig.json
echo "smoke: typecheck passed (the stack and every docs example)"

if [ "${1:-}" = "--no-deploy" ]; then exit 0; fi
cd "$root/packages/test-controller"
node src/cli.ts with-site smoke -- bash -c "cd '$work/project' && npx alchemy deploy --stage smoke --yes --no-input && npx alchemy destroy --stage smoke --yes --no-input"
echo "smoke: deploy and destroy passed"
