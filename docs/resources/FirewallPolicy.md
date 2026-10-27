# FirewallPolicy

A zone-based firewall policy: an `action` (`ALLOW`, `BLOCK` or `REJECT`) for traffic from a `source` zone to a `destination` zone, optionally narrowed by traffic filters, protocol, connection state, IPsec and a schedule.

```ts
import * as UnifiNetwork from "@alchemy-unifi/network";
import * as Effect from "effect/Effect";

export const policies = Effect.gen(function* () {
	const { HOTSPOT, INTERNAL } = UnifiNetwork.FirewallZone;
	const guests = yield* UnifiNetwork.Network.lookup({ name: "Guests" });
	const printers = yield* UnifiNetwork.TrafficMatchingList.lookup({ name: "Printers" });
	// Let guests print, on the printers' IPP port only.
	const allowPrinting = yield* UnifiNetwork.FirewallPolicy("guests-print", {
		name: "Allow guests to print",
		enabled: true,
		action: { type: "ALLOW", allowReturnTraffic: true },
		source: {
			zone: HOTSPOT,
			trafficFilter: { type: "NETWORK", networkFilter: { matchOpposite: false, networks: [guests] } },
		},
		destination: {
			zone: INTERNAL,
			trafficFilter: {
				type: "IP_ADDRESS",
				ipAddressFilter: { type: "TRAFFIC_MATCHING_LIST", matchOpposite: false, trafficMatchingList: printers },
				portFilter: { type: "PORTS", matchOpposite: false, items: [{ type: "PORT_NUMBER", value: 631 }] },
			},
		},
		ipProtocolScope: {
			ipVersion: "IPV4_AND_IPV6",
			protocolFilter: { type: "NAMED_PROTOCOL", protocol: { name: "tcp" }, matchOpposite: false },
		},
		loggingEnabled: false,
	});
	return { allowPrinting: allowPrinting.firewallPolicyId };
});
```

**Lookup:** `FirewallPolicy.lookup({ name, source?, destination? })`; give the zones when the name isn't unique.

**Adoption** matches the name and zone pair, among policies you made (never system or derived ones).

## Gotchas

- **Order matters, and new policies go last** in their zone pair's "before system" bucket. Use [`FirewallPolicyOrdering`](FirewallPolicyOrdering.md) to place them.
- **Changing zones moves the policy** to the end of the new pair; re-list it in that pair's ordering.
- **Names aren't unique,** even within a zone pair, so adoption and lookups refuse several matches.
- **Network filters only work on gateway networks** (`management: "GATEWAY"`), in the source and the destination alike: the gateway never sees an unmanaged network's traffic. The console rejects one with a bare "Unexpected error".
- **Optional criteria you leave out are removed,** like every optional prop ([details](../concepts.md#changes-made-in-the-ui)).
- **Some IDs are still raw:** VPN servers, site-to-site tunnels and DPI applications in filters.
