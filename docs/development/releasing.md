# Releasing

`@alchemy-unifi/network` and `@alchemy-unifi/network-sdk` are published from `.github/workflows/release.yml` with npm trusted publishing (OIDC, no tokens), so every version has provenance. npm trusts that one file by name, so nightlies and releases share it.

## Day to day

- **Record a change intent per package** with each user-visible change, and commit it with the change. One intent names one package, and its summary is written for that package's users, because it becomes that package's changelog entry and GitHub release notes. A change touching both packages gets two intents:

    ```sh
    pnpm change @alchemy-unifi/network-sdk --bump minor --summary "Add the ACL rule operations' typed errors."
    pnpm change @alchemy-unifi/network --bump minor --summary "Add \`AclRule\`."
    ```

    Each writes `.changeset/<name>.md`. `pnpm change status` shows what the pending intents would release. A package that only picks up a dependency's new version (the provider after an SDK release) gets an "Updated dependencies" entry automatically.

- **Every push to `main` publishes a nightly** of each package under the `nightly` dist-tag: `<next version>-nightly.<UTC timestamp>.g<sha>`, where the next version is what the pending intents produce (else the next patch). Each nightly of the provider depends on the SDK nightly from the same commit. Install with `npm install @alchemy-unifi/network@nightly`.
- **To release**, run the Release workflow by hand on `main` (Actions → Release → Run workflow), or `gh workflow run release.yml`. It runs twice:
    1. **On `main`:** fails if there are no pending intents; runs `pnpm version -r`, which bumps the packages the intents name (and their dependents), prepends each one's `CHANGELOG.md` (`versioning.changelog.storage: repository`) and deletes the consumed intents; formats those files; commits "Release …", tags `<package>@<version>`, and pushes both atomically to `main` (it needs to be allowed past `main`'s ruleset). Nothing is published yet, so a refused push costs nothing. It then starts the workflow again on the new tag.
    2. **On the tag:** builds, publishes versions npm doesn't have yet under `latest`, and creates a GitHub release per tag on that commit from its changelog section. Publishing from the tagged commit is what makes each version's provenance name the commit that contains it: provenance records the commit a run started from, not commits made during it. If it fails, re-run it: it skips versions already on npm and tags that already have releases.

    The workflow's own pushes don't trigger workflows (its dispatches do), so the release commit publishes no nightly.

- **Publishing** packs with pnpm, which rewrites `workspace:` ranges, and publishes the tarball with npm, because npm handles the OIDC exchange (npm 11.5.1 or later).

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

3. Trust the workflow for each package:

    ```sh
    npm trust github @alchemy-unifi/network --file release.yml --repo HamishWHC/alchemy-unifi --allow-publish
    npm trust github @alchemy-unifi/network-sdk --file release.yml --repo HamishWHC/alchemy-unifi --allow-publish
    ```

4. Run the Release workflow. The manifests start at `0.0.1` (the placeholder's version), so the first intent's `minor` releases 0.1.0. pnpm uses a manifest's version unchanged for a package npm doesn't have yet.

Until a package exists on npm, nightlies skip it.
