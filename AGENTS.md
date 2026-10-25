# AGENTS.md: alchemy-unifi

Things you must know that aren't obvious from the code.

## Documentation

- **Docs live in `docs/`, one file per subject**, with the overview in `docs/README.md`. They describe the current state only.
- **Plans** for future or in-progress work go in `plans/` (versioned). Delete a plan when it's completed or cancelled; anything still worth knowing goes into `docs/` or the code. `_scratch/` (gitignored) is for session-local notes and plans.

## Safety

- **Never test against a real UniFi console.** The user's networks are live. Use the Docker test controller (`packages/test-controller`, see `docs/testing.md`).
- **Controller tests use their own site** (`useSite` per file), never the controller's `default` site: parallel worktrees share the controller.

## Code generation

- **`packages/network-sdk/src/services/` is generated.** Never edit it. Fix structural spec problems in `scripts/normalise-spec.ts`, targeted ones with distilled RFC-6902 patches in `packages/network-sdk/patches/`, then run `pnpm generate`.
- The test controller's Java agent (`packages/test-controller/agent/ApiKeyAgent.java`) targets obfuscated names from Network **10.6.109**. Bumping the controller image means re-finding them (see `docs/testing.md`).

## Conventions and preferences

- **Resources** resolve their site with `resolveSite`, list through `ReadCache` (invalidating on writes), and treat `NotFound` on delete as already deleted (see `docs/connection.md`).
- **Provider code calls the SDK through `withConnection`** (`packages/network/src/Connection.ts`). Never provide an `HttpClient` from `providers()`: lifecycle operations run in the stack's merged context, so it would replace other providers' clients (see `docs/connection.md`).

- **Follow existing Alchemy provider conventions** before inventing anything: naming, structural `{ fooId }` references, `<thing>Id` attributes, SCREAMING_SNAKE constants, `providers()` layout, auth providers, lifecycle semantics. When unsure, read Alchemy's source (`github.com/alchemy-run/alchemy`: `packages/neon`, `packages/cloudflare`) and copy the closest provider.
- **Cover the whole Network API over time**, including deployment-specific things (WANs, devices). Whether a stack manages them is the consumer's choice.
- **Support only the latest stable UniFi Network release.**
- **Node only.** Bun is not a target.
- **Two packages per UniFi application:** the provider (`network`) and its raw distilled SDK (`network-sdk`), laid out like the `@distilled.cloud/*` packages on npm. Site Manager and Protect follow the same pattern later.
- **Releases** use pnpm's built-in versioning (`pnpm change`, `pnpm version -r`), not changesets.
- **Bump `typescript`, `@effect/tsgo` and `oxlint` together.** `@effect/tsgo` supports specific TS and oxlint versions.
- **Fix lint errors in the code; don't disable rules.**
- **Testing infrastructure:** the user does not want VM-based setups. Keep the test controller Docker-only.
