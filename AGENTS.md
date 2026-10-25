# AGENTS.md: alchemy-unifi

Things you must know that aren't obvious from the code.

## Documentation

- **Docs live in `docs/`, one file per subject**, with the overview in `docs/README.md`. They describe the current state only.

## Safety

- **Never test against a real UniFi console.** The user's networks are live. Use the Docker test controller (`packages/network/test/controller`, see `docs/testing.md`).

## Code generation

- **`packages/network/src/sdk/services/` is generated.** Never edit it. Fix structural spec problems in `scripts/normalise-spec.ts`, targeted ones with distilled RFC-6902 patches, then run `pnpm generate`.
- The test controller's Java agent (`test/controller/agent/ApiKeyAgent.java`) targets obfuscated names from Network **10.6.109**. Bumping the controller image means re-finding them (see `docs/testing.md`).

## Conventions and preferences

- **Follow existing Alchemy provider conventions** before inventing anything: naming, structural `{ fooId }` references, `<thing>Id` attributes, SCREAMING_SNAKE constants, `providers()` layout, auth providers, lifecycle semantics. When unsure, read Alchemy's source (`github.com/alchemy-run/alchemy`: `packages/neon`, `packages/cloudflare`) and copy the closest provider.
- **Cover the whole Network API over time**, including deployment-specific things (WANs, devices). Whether a stack manages them is the consumer's choice.
- **Support only the latest stable UniFi Network release.**
- **Node only.** Bun is not a target.
- **One package per UniFi application** (`network` now; Site Manager and Protect later, each its own package under `packages/`).
- **Releases** use pnpm's built-in versioning (`pnpm change`, `pnpm version -r`), not changesets.
- **Bump `typescript`, `@effect/tsgo` and `oxlint` together.** `@effect/tsgo` supports specific TS and oxlint versions.
- **Fix lint errors in the code; don't disable rules.**
- **Testing infrastructure:** the user does not want VM-based setups. Keep the test controller Docker-only.
