# Development

How the packages work inside, and how to work on them. The user docs are one level up ([../README.md](../README.md)); anything a user needs to know belongs there, not here.

## Layout

| Path                       | What                                                                                                                       |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `packages/network`         | `@alchemy-unifi/network`: the Alchemy provider (auth provider, connection, resources, lookups, state store)                |
| `packages/network-sdk`     | `@alchemy-unifi/network-sdk`: the Effect SDK, generated with distilled (`src/services/`) plus hand-written support modules |
| `packages/test-controller` | Private: a disposable UniFi Network Application in Docker for tests                                                        |
| `scripts/smoke`            | The consumer smoke test: the packed packages in a fresh npm project                                                        |
| `scripts/release.ts`       | Helpers for the release workflow                                                                                           |

## Contributing

- **Setup:** Node 22 or later, pnpm 12 (`devEngines` fetches it), and Docker for the test controller. `pnpm install` at the root.
- **Checks:** `pnpm check` (typecheck, lint, format), `pnpm turbo run test:unit`, and `pnpm test` for everything, which starts the test controller. Never test against a real console.
- **Record a change intent per package** for every user-visible change, each summarised for that package's users: `pnpm change <package> --bump <patch|minor|major> --summary "…"` (see [releasing.md](releasing.md)).
- **Docs change with the code.** User-facing behaviour and gotchas go in the user docs, with an example that typechecks: the smoke test compiles every TypeScript block in `docs/*.md`, `docs/resources/*.md`, the package READMEs and the packages' doc comments against the packed packages. So each block is a complete module, imports included.
- `AGENTS.md` at the root lists the rules that are easy to break (generated code, the test controller's Java agent, `withConnection`).

## Pages

- [architecture.md](architecture.md): the auth provider, credentials and connection layers, sites, read cache and TLS.
- [resources.md](resources.md): how resources are built: props conventions, explicit defaults, attributes, lifecycle, adoption, lookups, and notes per resource.
- [state-store.md](state-store.md): how `UnifiNetwork.state()` stores, locks and writes.
- [sdk.md](sdk.md): the SDK's layout, known gaps and patches.
- [spec-generation.md](spec-generation.md): how the SDK is generated, and how to fix or bump the spec.
- [unifi-api.md](unifi-api.md): what's known about UniFi's APIs, including behaviour verified on the test controller and real consoles.
- [testing.md](testing.md): unit tests, controller tests, the smoke test and the test controller.
- [tooling.md](tooling.md): packaging and formatting rules that aren't obvious from the config.
- [releasing.md](releasing.md): change intents, nightlies, releases and the one-time npm bootstrap.
