# alchemy-unifi

[Alchemy](https://alchemy.run) providers for Ubiquiti UniFi, built on Effect.

| Package                                              | Description                                                                                                                                              |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@alchemy-unifi/network`](packages/network)         | Alchemy provider for the UniFi Network application: networks, Wi-Fi, firewall, ACL and DNS policies. Connects locally or via the ui.com cloud connector. |
| [`@alchemy-unifi/network-sdk`](packages/network-sdk) | The raw Effect SDK for the UniFi Network Integration API, generated with distilled.                                                                      |

See [docs/](docs/README.md) for how it works.

## Development

Releases use [pnpm's built-in versioning](https://pnpm.io/versioning). Lifecycle tests run against a Docker test controller; see [docs/testing.md](docs/testing.md).
