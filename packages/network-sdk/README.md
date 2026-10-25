# @alchemy-unifi/network-sdk

An Effect-native SDK for the UniFi Network Integration API, generated with [distilled](https://github.com/alchemy-run/distilled) from UniFi's published OpenAPI spec. It's laid out like the `@distilled.cloud/*` packages. [`@alchemy-unifi/network`](../network) builds the Alchemy provider on top of it.

```ts
import * as UnifiNetwork from "@alchemy-unifi/network-sdk";
import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";

const credentials = Layer.succeed(
	UnifiNetwork.Credentials,
	Effect.succeed({
		baseUrl: "https://192.168.1.1/proxy/network/integration",
		apiKey: Redacted.make("<api key>"),
	}),
);

const sites = UnifiNetwork.getSiteOverviewPage({}).pipe(
	Effect.provide(Layer.mergeAll(credentials, FetchHttpClient.layer)),
);
```

See [the docs](../../docs/sdk.md).
