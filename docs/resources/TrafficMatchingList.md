# TrafficMatchingList

A named list of ports, IPv4 addresses or IPv6 addresses, which [firewall policies](FirewallPolicy.md) reference instead of repeating values inline. `type` is `"PORTS"`, `"IPV4_ADDRESSES"` or `"IPV6_ADDRESSES"`.

```ts
import * as UnifiNetwork from "@alchemy-unifi/network";
import * as Effect from "effect/Effect";

export const lists = Effect.gen(function* () {
	const web = yield* UnifiNetwork.TrafficMatchingList("web-ports", {
		type: "PORTS",
		name: "Web",
		items: [
			{ type: "PORT_NUMBER", value: 443 },
			{ type: "PORT_NUMBER_RANGE", start: 8000, stop: 8099 },
		],
	});
	const servers = yield* UnifiNetwork.TrafficMatchingList("servers", {
		type: "IPV4_ADDRESSES",
		name: "Servers",
		items: [
			{ type: "IP_ADDRESS", value: "192.168.10.5" },
			{ type: "IP_ADDRESS_RANGE", start: "192.168.10.20", stop: "192.168.10.29" },
			{ type: "SUBNET", value: "192.168.11.0/24" },
		],
	});
	return { web, servers };
});
```

**Lookup:** `TrafficMatchingList.lookup({ name })`.

**Adoption** matches the name, which is unique per site.

## Gotchas

- **There are no MAC lists.** Firewall policies match MAC addresses inline; share them as a constant in your code instead.
- **A list something outside the stack uses can't be deleted** (e.g. a policy made in the UI). The deploy fails with an error naming the policies that use it.
- **Disabled policies don't hold a list:** deleting a list one uses succeeds, and that policy then can't be re-enabled until its filter is fixed.
