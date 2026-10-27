# SDK internals (`@alchemy-unifi/network-sdk`)

The user-facing page is [sdk.md](../sdk.md).

An Effect SDK for the UniFi Network Integration API in `packages/network-sdk`, generated with distilled's codegen (see [spec-generation.md](spec-generation.md)). Its layout and `exports` match a `@distilled.cloud/*` package (e.g. `@distilled.cloud/neon`), so it can be upstreamed without changes.

Hand-written files sit beside the generated `services/` and follow distilled's layout:

- the root re-exports every operation (`Sdk.createNetwork`), plus `Services.network`, `T` (traits), `Retry`, the protocol and errors;
- subpaths `./Credentials`, `./Errors`, `./Traits`, `./Pagination`, `./Protocol` and `./Retry` expose the hand-written modules, and `./<service>` (`./network`) a generated service.

It's a separate package so that consumers needing an escape hatch can call the API directly; `@alchemy-unifi/network` doesn't re-export it.

## Known gaps

- **Untyped members.** 24 members are `unknown` because UniFi's spec gives them no schema: ACL/firewall `sourceFilter`/`destinationFilter`, Wi-Fi `radiusConfiguration`, device `accessPoint`, and a few metadata fields.
- **Undocumented required fields.** A few fields the spec marks optional are required by the server, depending on other fields (see [unifi-api.md](unifi-api.md#behaviour-not-in-the-spec)). The provider's props types enforce them.

Patches (`packages/network-sdk/patches/`) can fix either: one marks Wi-Fi passphrases sensitive, so they decode as `Redacted` and accept `Redacted`; another types Wi-Fi basic data rates as integers (the spec's string enums are rejected by the console). See [spec-generation.md](spec-generation.md#fixing-the-spec).
