# alchemy-unifi

[Alchemy](https://alchemy.run) providers for Ubiquiti UniFi, built on Effect.

| Package                                              | Description                                                                                                                                                                                       |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@alchemy-unifi/network`](packages/network)         | Alchemy provider for the UniFi Network application: networks, Wi-Fi, zone-based firewall and DNS policies, plus a state store on the console. Connects locally or via the ui.com cloud connector. |
| [`@alchemy-unifi/network-sdk`](packages/network-sdk) | The raw Effect SDK for the UniFi Network Integration API, generated with distilled.                                                                                                               |

See [docs/](docs/README.md) for how it works.

## Development

Lifecycle tests run against a Docker test controller; see [docs/testing.md](docs/testing.md). Every push to `main` publishes a nightly; releases are cut by hand from recorded change intents; see [docs/releasing.md](docs/releasing.md).

## License

[MIT](LICENSE)
