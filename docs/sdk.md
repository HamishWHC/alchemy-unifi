# SDK (`packages/network/src/sdk`)

An Effect SDK for the UniFi Network Integration API, generated with distilled's codegen (see [spec-generation.md](spec-generation.md)). Its layout is identical to a `@distilled.cloud/*` package, so it can be split out or upstreamed without changes.

Hand-written files sit beside the generated `services/` and follow distilled's layout. `index.ts` re-exports operations at the root (`Sdk.createNetwork`, not `Sdk.network.createNetwork`). The SDK isn't part of the package's public entry point; provider code imports `./sdk/index.ts`.

## Using it

Each operation is an `Effect` that needs `Credentials` and an `HttpClient`:

```ts
import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Sdk from "./sdk/index.ts";

const credentials = Layer.succeed(
	Sdk.Credentials,
	Effect.succeed({
		baseUrl: "http://localhost:18080/proxy/network/integration", // console-style base, no /v1
		apiKey: Redacted.make("alchemy-unifi-test-key"),
	}),
);

const program = Effect.gen(function* () {
	const sites = yield* Sdk.getSiteOverviewPage({});
	const siteId = sites.data[0]?.id ?? "";
	const network = yield* Sdk.createNetwork({
		siteId,
		body: { management: "UNMANAGED", name: "example", enabled: true, vlanId: 99 },
	});
	yield* Sdk.deleteNetwork({ siteId, networkId: network.id });
});

program.pipe(Effect.provide(Layer.mergeAll(credentials, FetchHttpClient.layer)));
```

Things the types don't make obvious:

- Paginated operations also have `.pages(input)` and `.items(input)` Streams (but see the `.items()` gap below).
- Unmatched failures become `UnknownUnifiNetworkError`; schema failures become `UnifiNetworkParseError`.
- Throttling and transient errors retry by default; opt out per call with `Sdk.Retry.none`.

## Known gaps

- **Untyped members.** 24 members are `unknown` because UniFi's spec gives them no schema: ACL/firewall `sourceFilter`/`destinationFilter`, Wi-Fi `radiusConfiguration`, device `accessPoint`, and a few metadata fields.
- **Undocumented required fields.** Some fields the spec marks optional are required by the server (see [unifi-api.md](unifi-api.md#behaviour-not-in-the-spec)).

Both are fixed by spec patches; see [spec-generation.md](spec-generation.md#fixing-the-spec).

- **Untyped `.items()`.** Paginated operations are generated with `unknown` as the item type, so `.items()` yields `unknown`. Use `.pages()` and read `page.data`, which is typed, until the generator config is fixed.
