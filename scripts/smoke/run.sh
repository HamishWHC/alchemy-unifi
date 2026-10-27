#!/usr/bin/env bash
# Consumer smoke test: installs the packed packages into a fresh npm project
# (outside the workspace, as a user would), typechecks `project/`, then
# deploys and destroys it on a fresh test-controller site. The typecheck
# includes every TypeScript block in the user docs, package READMEs and
# doc comments. It then does the same for each part of the docs tutorial,
# deploying the parts in order. Needs a build and a running test controller.
# Set PACKED_DIR to test tarballs already packed (as CI does) instead of packing.
# Usage: scripts/smoke/run.sh [--no-deploy]
set -euo pipefail
cd "$(dirname "$0")/../.."
root="$PWD"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

if [ -n "${PACKED_DIR:-}" ]; then
	cp "$PACKED_DIR"/*.tgz "$work/"
else
	for package in network-sdk network; do
		(cd "packages/$package" && pnpm pack --pack-destination "$work" >/dev/null)
	done
fi

# The provider's peers, at the ranges it declares.
peers="$(node -p 'Object.entries(require("./packages/network/package.json").peerDependencies).map(([n, r]) => `${n}@${r}`).join(" ")')"

cp -R scripts/smoke/project/. "$work/project"
cd "$work/project"
# shellcheck disable=SC2086 # peers is a list
npm install --no-audit --no-fund --loglevel=error "$work"/*.tgz $peers typescript @types/node
node "$root/scripts/smoke/examples.ts" examples
npx tsc -p tsconfig.json
echo "smoke: typecheck passed (the stack and every docs example)"

# The tutorial, replayed part by part: each part's end state is its own
# project, sharing this one's dependencies.
node "$root/scripts/smoke/tutorial.ts" "$work/tutorial"
for part in "$work"/tutorial/part-*; do
	cp package.json "$part/"
	ln -s "$work/project/node_modules" "$part/node_modules"
	node -e 'const c = require("./tsconfig.json"); c.include = ["alchemy.run.ts", "src/**/*.ts"]; c.compilerOptions.allowImportingTsExtensions = true; process.stdout.write(JSON.stringify(c))' >"$part/tsconfig.json"
	(cd "$part" && npx tsc -p tsconfig.json)
done
echo "smoke: typecheck passed (every tutorial part)"

if [ "${1:-}" = "--no-deploy" ]; then exit 0; fi
cd "$root/packages/test-controller"
node src/cli.ts with-site smoke -- bash -c "cd '$work/project' && npx alchemy deploy --stage smoke --yes --no-input && npx alchemy destroy --stage smoke --yes --no-input"
echo "smoke: deploy and destroy passed"

# Each tutorial part deploys over the previous one, as a reader's would, on
# the stage the tutorial uses. `--adopt` takes over the site's default network.
parts="$(find "$work/tutorial" -mindepth 1 -maxdepth 1 -name 'part-*' | sort -t- -k2 -n)"
last="$(echo "$parts" | tail -n 1)"
node src/cli.ts with-site tutorial -- bash -c "
	set -euo pipefail
	export LAB_WIFI_PASSPHRASE=smoke-test-passphrase
	for part in $(echo "$parts" | tr '\n' ' '); do
		echo \"smoke: deploying \$(basename \"\$part\")\"
		(cd \"\$part\" && npx alchemy deploy --stage home --adopt --yes --no-input)
	done
	cd '$last' && npx alchemy destroy --stage home --yes --no-input
"
echo "smoke: every tutorial part deployed, and the tutorial destroyed"
