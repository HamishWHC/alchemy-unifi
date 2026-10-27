# Releasing

`@alchemy-unifi/network` and `@alchemy-unifi/network-sdk` are published with npm trusted publishing (OIDC, no tokens), so every version has provenance. Both nightlies and releases run `release.yml`'s one job, but npm checks the calling workflow's filename, so it trusts two: `ci.yml` (which calls it for nightlies) and `release.yml` (run by hand for releases).

- **Only `main` can publish.** npm's trust doesn't check the branch, so the publishing job runs in the GitHub environment `npm`, which only `main` may deploy to, and npm only accepts tokens from that environment. A branch with an edited workflow gets a token npm rejects. The environment has no required reviewers, so nightlies stay automatic.
- **Releases push with a deploy key.** `GITHUB_TOKEN` can't bypass `main`'s pull-request ruleset, but deploy keys can. The key's private half is the `npm` environment secret `RELEASE_DEPLOY_KEY`, so only the release job on `main` can use it. Unlike `GITHUB_TOKEN` pushes, its pushes trigger workflows: the release commit runs CI, and so publishes a nightly of the next patch.
- **Actions are pinned to commit SHAs** (with the release as a comment), so a moved tag can't change what runs in a job holding the publishing token.

## Day to day

- **Record a change intent per package** with each user-visible change, and commit it with the change. One intent names one package, and its summary is written for that package's users, because it becomes that package's changelog entry and GitHub release notes. A change touching both packages gets two intents:

    ```sh
    pnpm change @alchemy-unifi/network-sdk --bump minor --summary "Add the ACL rule operations' typed errors."
    pnpm change @alchemy-unifi/network --bump minor --summary "Add \`AclRule\`."
    ```

    Each writes `.changeset/<name>.md`. `pnpm change status` shows what the pending intents would release. A package that only picks up a dependency's new version (the provider after an SDK release) gets an "Updated dependencies" entry automatically.

- **Every push to `main` publishes a nightly** once CI passes: `ci.yml`'s `nightly` job runs after the CI job and calls `release.yml` with `nightly: true`. That runs `pnpm version -r` without committing, so each nightly carries the changelog so far, then bumps both packages to a prerelease of that version with `pnpm version -r prerelease --preid nightly.<UTC timestamp>.g<short sha>` (e.g. `0.1.1-nightly.20261027061928.g4ad5afa.0` after 0.1.0; pnpm counts from the manifest, which never holds a committed nightly, so its own counter alone would repeat), and publishes under the `nightly` dist-tag. semver's `prerelease` bumps the patch of a release version first, so a nightly sorts after the version the pending intents give, not before it. Both packages always get a nightly, so the provider's depends on the SDK's from the same commit. Install with `npm install @alchemy-unifi/network@nightly`.
- **To release**, run the Release workflow by hand on `main` (Actions → Release → Run workflow), or `gh workflow run release.yml`. Its one job:
    1. runs `pnpm version -r`, which bumps the packages the intents name (and their dependents), prepends each one's `CHANGELOG.md` (`versioning.changelog.storage: repository`; oxfmt ignores these generated files) and deletes the consumed intents;
    2. commits "Release …", tags `<package>@<version>`, and pushes both atomically to `main` (the workflow must be allowed past `main`'s ruleset). Nothing is published until the push succeeds;
    3. builds, runs `pnpm publish -r`, which publishes every public package whose version npm doesn't have yet, under `latest`, and creates a GitHub release from its changelog section for each package's version tag that has none.

    **If it fails after pushing**, start a new run (not a re-run, which would start from the old commit and apply the intents again). With no pending intents, it skips straight to publishing and releasing whatever is missing.

    Provenance names the commit the run started from, so a release's provenance points at the commit before its release commit.

- **Publishing is pnpm's** (`pnpm publish -r --provenance`): it rewrites `workspace:` ranges, packs the root LICENSE into each package, and does the trusted-publishing exchange itself. `--provenance` is explicit, though pnpm adds it under trusted publishing anyway. npm is only needed for the one-time setup below.

## Bootstrap (done once)

npm can only trust a workflow for a package that already exists, so each name was first claimed by hand:

1. Create the npm org `alchemy-unifi`, and enable 2FA on the account.
2. Publish a placeholder `0.0.1` of each package, then deprecate it:

    ```sh
    npm login
    for name in network network-sdk; do
    	dir=$(mktemp -d)
    	printf '{"name":"@alchemy-unifi/%s","version":"0.0.1","description":"Placeholder: install 0.1.0 or later.","license":"MIT","repository":"github:HamishWHC/alchemy-unifi"}\n' "$name" > "$dir/package.json"
    	printf 'Placeholder that reserved the name. Install 0.1.0 or later.\n' > "$dir/README.md"
    	(cd "$dir" && npm publish --access public)
    	npm deprecate "@alchemy-unifi/$name@0.0.1" "Placeholder: install 0.1.0 or later."
    done
    ```

3. Create the GitHub environment `npm` (Settings → Environments), with deployment branches limited to `main`.
4. Trust both workflows for each package, from that environment only:

    ```sh
    for name in network network-sdk; do
    	for file in release.yml ci.yml; do
    		npm trust github "@alchemy-unifi/$name" --file "$file" --repo HamishWHC/alchemy-unifi --env npm --allow-publish
    	done
    done
    ```

5. Generate a deploy key (`ssh-keygen -t ed25519 -f release-key -N ""`), add the public half with write access under Settings → Deploy keys, the private half as the `npm` environment secret `RELEASE_DEPLOY_KEY`, and **Deploy keys** to the bypass list of `main`'s ruleset.
6. On npmjs.com, set each package's publishing access to require two-factor authentication and disallow tokens. Trusted publishing still works; long-lived tokens can't publish.

7. Run the Release workflow. The manifests start at `0.0.1` (the placeholder's version), so the first intent's `minor` releases 0.1.0. pnpm uses a manifest's version unchanged for a package npm doesn't have yet.
