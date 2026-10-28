# Releasing

`@alchemy-unifi/network` and `@alchemy-unifi/network-sdk` are published with npm trusted publishing (OIDC, no tokens), so every version has provenance, and the docs site is deployed with them. Both nightlies and releases run `release.yml`'s one job, but npm checks the calling workflow's filename, so it trusts two: `ci.yml` (which calls it for nightlies) and `release.yml` (run by hand for releases).

- **Pack once, publish what the docs describe.** CI and the release job pack both packages and upload the tarballs as an artifact (`packed`, `packed-nightly`, `packed-release`). The smoke test runs against them (`PACKED_DIR`), the docs reference is generated from the packed provider (`NETWORK_PACKAGE_DIR`), and the release job publishes those exact tarballs.
- **Nothing publishes unless both builds pass.** In the release job, the package build and the docs build come before the push, the npm publish and the docs deploy, and the docs deploy comes after the publish, so the docs never describe a version npm doesn't have. A nightly also waits for CI's own docs build.

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
    2. builds and packs the packages, and builds the docs from the packed provider;
    3. commits "Release …", tags `<package>@<version>`, and pushes both atomically to `main` (the workflow must be allowed past `main`'s ruleset). Nothing is published until the push succeeds;
    4. publishes each tarball whose version npm doesn't have yet, under `latest`, and creates a GitHub release from its changelog section for each package's version tag that has none;
    5. deploys the docs to `prod` (alchemy-unifi.hamishwhc.com).

    **If it fails after pushing**, start a new run (not a re-run, which would start from the old commit and apply the intents again). With no pending intents, it skips straight to publishing and releasing whatever is missing.

    Provenance names the commit the run started from, so a release's provenance points at the commit before its release commit.

- **Publishing is pnpm's:** `pnpm pack` rewrites `workspace:` ranges and packs the root LICENSE into each package, and `pnpm publish <tarball> --provenance` does the trusted-publishing exchange itself. `--provenance` is explicit, though pnpm adds it under trusted publishing anyway. npm is only needed for the one-time setup below.

## Docs deploys

`packages/docs/alchemy.run.ts` deploys the site to Cloudflare with Alchemy, keeping its state on Cloudflare (`Cloudflare.state()`). CI deploys a build it already made (`DOCS_PREBUILT=1`) rather than building again.

| Stage     | Deployed by                                                                       | URL                                                            |
| --------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `prod`    | releases                                                                          | `alchemy-unifi.hamishwhc.com`                                  |
| `nightly` | nightlies                                                                         | `nightly.alchemy-unifi.hamishwhc.com`                          |
| `pr-<n>`  | `ci.yml`, for PRs from this repo; `docs-preview-cleanup.yml` destroys it on close | a preview version of the `nightly` Worker, commented on the PR |

They need the repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`: an account holding the `hamishwhc.com` zone, and a token that can edit Workers and that zone's DNS and Workers routes. The token can't create Alchemy's state store (the `alchemy-state-store` Worker and its Secrets Store), so that was made once by hand; see step 8 below.

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
8. Create Alchemy's state store for the docs, with a token that can also edit the Secrets Store and account settings, then narrow the token back to what the deploys need:

    ```sh
    cd packages/docs
    pnpm exec alchemy state bootstrap --backend cloudflare
    ```
