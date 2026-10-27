# FirewallPolicyOrdering

The order the policies from one zone to another are evaluated in, first match wins. Each zone pair has two buckets, with the system policies between them: `beforeSystemDefined` and `afterSystemDefined`. System policies themselves can't be reordered.

```ts
import * as UnifiNetwork from "@alchemy-unifi/network";
import * as Effect from "effect/Effect";

export const ordering = Effect.gen(function* () {
	const { HOTSPOT, INTERNAL } = UnifiNetwork.FirewallZone;
	const block = (name: string) =>
		({
			name,
			enabled: true,
			action: { type: "BLOCK" },
			source: { zone: HOTSPOT },
			destination: { zone: INTERNAL },
			ipProtocolScope: { ipVersion: "IPV4_AND_IPV6" },
			loggingEnabled: false,
		}) satisfies UnifiNetwork.FirewallPolicyProps;
	const allowDns = yield* UnifiNetwork.FirewallPolicy("guests-dns", {
		...block("Allow guest DNS"),
		action: { type: "ALLOW", allowReturnTraffic: true },
	});
	const blockRest = yield* UnifiNetwork.FirewallPolicy("guests-block", block("Block guests"));
	yield* UnifiNetwork.FirewallPolicyOrdering("hotspot-to-internal", {
		source: HOTSPOT,
		destination: INTERNAL,
		beforeSystemDefined: [allowDns, blockRest],
	});
});
```

There's one ordering per zone pair, so an existing one is adopted without `--adopt`, and deleting the resource leaves the order as it is.

## Gotchas

- **Policies the ordering doesn't list are kept,** after the listed ones in their bucket, with a warning (e.g. policies made in the UI). Set `exclusive: true` to fail instead.
- **Removing a policy and its place in the ordering in one deploy works,** even when exclusive.
- **A listed policy must be in the pair.** One that's missing, in another pair, or listed twice fails the deploy.
- **The state store's policy is ignored:** a Gateway → Gateway ordering keeps [`UnifiNetwork.state()`](../state.md)'s policies where they are, even when exclusive.
