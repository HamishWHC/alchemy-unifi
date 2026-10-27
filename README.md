# alchemy-unifi

[Alchemy](https://alchemy.run) providers for Ubiquiti UniFi, built on Effect.

| Package                                              | Description                                                                                                                                                                                       |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@alchemy-unifi/network`](packages/network)         | Alchemy provider for the UniFi Network application: networks, Wi-Fi, zone-based firewall and DNS policies, plus a state store on the console. Connects locally or via the ui.com cloud connector. |
| [`@alchemy-unifi/network-sdk`](packages/network-sdk) | The raw Effect SDK for the UniFi Network Integration API, generated with distilled.                                                                                                               |

See [the docs](https://alchemy-unifi.hamishwhc.com) to get started. For a real-world config, see [home-network](https://github.com/HamishWHC/home-network): two sites sharing one stack, with zones, networks, Wi-Fi, a full firewall matrix and the state store on the console.

## Development

See [docs/development/](docs/development/README.md): how the packages work, testing against a Docker test controller, and releasing (a nightly on every push to `main`, releases by hand from recorded change intents).

## License

[MIT](LICENSE)
