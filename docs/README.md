# alchemy-unifi

[Alchemy](https://alchemy.run) (v2, Effect-native) providers for Ubiquiti UniFi. These docs describe what exists now.

## Notes

- Only the SDK and the test controller are built. `providers()` registers no resources yet, and there's no auth provider.
- `packages/network/src/sdk/services/` is generated (see [spec-generation.md](spec-generation.md)); the rest of `src/sdk/` is hand-written.
- Each UniFi application (Site Manager, Protect, …) gets its own package under `packages/`.

## Background

- [unifi-api.md](unifi-api.md): what's known about UniFi's APIs, paths, auth and versions, including behaviour verified on the test controller.
- [sdk.md](sdk.md): using the generated SDK.
- [spec-generation.md](spec-generation.md): how the SDK is generated, and how to fix the spec.
- [testing.md](testing.md): unit tests and the test controller.
- [tooling.md](tooling.md): packaging and formatting rules that aren't obvious from the config.
