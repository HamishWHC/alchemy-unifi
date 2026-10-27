# @alchemy-unifi/network-sdk

An Effect-native SDK for the UniFi Network Integration API, generated with [distilled](https://github.com/alchemy-run/distilled) from UniFi's published OpenAPI spec (Network 10.6). It's laid out like the `@distilled.cloud/*` packages: one function per operation, typed errors, pagination streams (`operation.items(...)`) and retries. [`@alchemy-unifi/network`](https://www.npmjs.com/package/@alchemy-unifi/network) builds the Alchemy provider on top of it.

```sh
npm install @alchemy-unifi/network-sdk effect
```

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

Remote consoles work too, through the ui.com connector: `https://api.ui.com/v1/connector/consoles/<console id>/proxy/network/integration` with a Site Manager key.

See [the SDK docs](https://github.com/HamishWHC/alchemy-unifi/blob/main/docs/sdk.md) for base URLs, errors, retries and gotchas.

## License

MIT
