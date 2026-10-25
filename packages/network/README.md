# @alchemy-unifi/network

[Alchemy](https://alchemy.run) provider for the UniFi Network application. Not yet usable: see [the architecture doc](../../docs/architecture.md).

```ts
import * as UnifiNetwork from "@alchemy-unifi/network";
import * as Alchemy from "alchemy";
import * as Effect from "effect/Effect";

export default Alchemy.Stack(
	"HomeNetwork",
	{ providers: UnifiNetwork.providers(), state: Alchemy.localState() },
	Effect.gen(function* () {
		// yield* UnifiNetwork.Network("Trusted", { ... });
	}),
);
```
