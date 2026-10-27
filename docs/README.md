# alchemy-unifi

[Alchemy](https://alchemy.run) (v2, Effect-native) providers for Ubiquiti UniFi. These docs describe what exists now.

## Notes

- The SDK, the `UnifiNetwork` auth provider, the console connection, site resolution, the read cache, the test harness and the first resources (`FirewallZone`, `Network`, `WifiBroadcast`) are built.
- Each UniFi application gets two packages: the Alchemy provider (`packages/network`, `@alchemy-unifi/network`) and its raw distilled SDK (`packages/network-sdk`, `@alchemy-unifi/network-sdk`), laid out like a `@distilled.cloud/*` package. The provider depends on the SDK; anyone needing an escape hatch uses the SDK package directly.
- `packages/network-sdk/src/services/` is generated (see [spec-generation.md](spec-generation.md)); the rest of `packages/network-sdk/src/` is hand-written.

## Background

- [connection.md](connection.md): the auth provider, credentials, connection, sites, read cache and TLS.
- [state.md](state.md): `UnifiNetwork.state()`, the state store on the console.
- [resources/](resources/README.md): resource conventions, lifecycle and lookups, and a page per resource.
- [unifi-api.md](unifi-api.md): what's known about UniFi's APIs, paths, auth and versions, including behaviour verified on the test controller.
- [sdk.md](sdk.md): using the generated SDK.
- [spec-generation.md](spec-generation.md): how the SDK is generated, and how to fix the spec.
- [testing.md](testing.md): unit tests, controller tests and the test controller.
- [tooling.md](tooling.md): packaging and formatting rules that aren't obvious from the config.
