# alchemy-unifi

[Alchemy](https://alchemy.run) providers for Ubiquiti UniFi, built on Effect.

| Package                                      | Description                                                                                                                     |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| [`@alchemy-unifi/network`](packages/network) | UniFi Network application: networks, Wi-Fi, firewall, ACL and DNS policies. Connects locally or via the ui.com cloud connector. |

See [docs/architecture.md](docs/architecture.md) for the design.

## Development

```sh
pnpm install
pnpm check      # typecheck, lint, format
pnpm test
pnpm generate   # regenerate the SDK from the vendored OpenAPI spec (distilled codegen)
pnpm build
```

Releases use [pnpm's built-in versioning](https://pnpm.io/versioning): `pnpm change` records a change, `pnpm version -r` applies pending changes, and `pnpm release` builds and publishes.

Lifecycle tests run against a disposable controller: `docker compose -f packages/network/test/controller/compose.yaml up -d`, then `packages/network/test/controller/setup.sh`.
