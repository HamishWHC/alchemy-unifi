# Development

How the packages work inside, and how to work on them. The user docs are the [docs site](https://alchemy-unifi.hamishwhc.com) (see [Documentation](#documentation)); anything a user needs to know belongs there, not here.

## Layout

| Path                       | What                                                                                                                       |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `packages/network`         | `@alchemy-unifi/network`: the Alchemy provider (auth provider, connection, resources, lookups, state store)                |
| `packages/network-sdk`     | `@alchemy-unifi/network-sdk`: the Effect SDK, generated with distilled (`src/services/`) plus hand-written support modules |
| `packages/test-controller` | Private: a disposable UniFi Network Application in Docker for tests                                                        |
| `packages/docs`            | Private: the docs site (Starlight)                                                                                         |
| `scripts/smoke`            | The consumer smoke test: the packed packages in a fresh npm project                                                        |

## Contributing

- **Setup:** Node 22 or later, pnpm 12 (`devEngines` fetches it), and Docker for the test controller. `pnpm install` at the root.
- **Checks:** `pnpm check` (typecheck, lint, format), `pnpm test:unit`, `pnpm test:controller` (starts the test controller), and `pnpm test` for both. Never test against a real console.
- **Record a change intent per package** for every user-visible change, each summarised for that package's users: `pnpm change <package> --bump <patch|minor|major> --summary "…"` (see [releasing.md](releasing.md)).
- **Docs change with the code.** User-facing behaviour and gotchas go in the docs site or the resource's JSDoc, with an example the smoke test checks (see [Documentation](#documentation)).
- `AGENTS.md` at the root lists the rules that are easy to break (generated code, the test controller's Java agent, `withConnection`).

## Documentation

The site (`packages/docs`) follows the shape of an Alchemy built-in provider's docs, as set out in the `alchemy-provider` skill's `docs.md` in [alchemy-run/alchemy](https://github.com/alchemy-run/alchemy/tree/main/.agents/skills/alchemy-provider).

- **Hub pages** (`src/content/docs/`, except `reference/`): Overview, Setup, the tutorial, then a section per area. A service page creates the resource, then has one heading per thing users configure, and links to the reference for the details.
- **The reference is generated** from the JSDoc in the network package's built declarations (`pnpm --filter @alchemy-unifi/docs reference`, also run by `dev` and `build`), so it describes the package as packed. It's gitignored. Every resource's JSDoc ends with `@resource`, and reads like Alchemy's: a summary, then `### Section` headings with prose, `:::caution`/`:::note` asides for gotchas, and `**Example:** Title` blocks. Gotchas live here, not on hub pages.
- **Every TypeScript block is checked** against the packed packages by the smoke test, so each is a complete module, imports included: the hub pages, the package READMEs and the doc comments are typechecked, and the tutorial is replayed and deployed.
- **The tutorial** (`tutorial/part-<n>.mdx`) builds one project. Every TypeScript block's first line is a `// <path>` comment. A ` ```ts ` block is a whole file. A change is a ` ```diff lang="typescript" ` block of the whole file with `+`/`-` lines: without its `+` lines it must equal the file as the earlier blocks left it. `scripts/smoke/tutorial.ts` replays the parts, and the smoke test typechecks and deploys each part's end state, in order, on one test-controller site.
- **Page style:** second person, present tense, an instruction or what the reader sees; each `##` heading does one thing (a line or two, then the snippet); no narrating internals or the docs' own structure; frontmatter has `title` and a one-sentence `description` of what the reader does (tutorial parts add `sidebar.order`).
- **Links** between pages are absolute (`/firewall/ordering/`); the build fails on a broken one (`starlight-links-validator`). The build also writes `llms.txt`, `llms-small.txt` and `llms-full.txt`.

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
