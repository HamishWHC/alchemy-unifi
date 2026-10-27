# Network

A network (VLAN). `management` picks what kind:

| `management`  | Routed by                            | Has                                         |
| ------------- | ------------------------------------ | ------------------------------------------- |
| `"GATEWAY"`   | The gateway                          | DHCP, a zone, internet access and isolation |
| `"SWITCH"`    | A layer-3 switch (`device`)          | DHCP on the switch                          |
| `"UNMANAGED"` | Another router (carried, not routed) | Just the VLAN                               |

```ts
import * as UnifiNetwork from "@alchemy-unifi/network";
import * as Effect from "effect/Effect";

export const networks = Effect.gen(function* () {
	const guests = yield* UnifiNetwork.Network("guests", {
		management: "GATEWAY",
		name: "Guests",
		vlanId: 40,
		enabled: true,
		cellularBackupEnabled: false,
		internetAccessEnabled: true,
		isolationEnabled: true,
		zone: UnifiNetwork.FirewallZone.HOTSPOT,
		ipv4Configuration: {
			autoScaleEnabled: false,
			hostIpAddress: "192.168.40.1",
			prefixLength: 24,
			dhcpConfiguration: {
				mode: "SERVER",
				ipAddressRange: { start: "192.168.40.100", stop: "192.168.40.250" },
				leaseTimeSeconds: 86400,
				pingConflictDetectionEnabled: true,
			},
		},
	});
	// A VLAN that passes through to another router.
	const isp = yield* UnifiNetwork.Network("isp-handoff", {
		management: "UNMANAGED",
		name: "ISP handoff",
		vlanId: 99,
		enabled: true,
	});
	return { guests: guests.networkId, isp: isp.networkId };
});
```

**Lookup:** `Network.lookup({ name })` or `Network.lookup({ vlanId })`.

**Adoption** matches the VLAN ID (unique per site), and renames the network to match props.

## The default network

Every site has a default network on VLAN 1. To manage it, declare a `Network` with `vlanId: 1` and deploy once with `--adopt`. Props may rename it, but it's never deleted (destroying the stack leaves it in place), and a change that would replace it (`management`, `site`) fails the plan.

## Gotchas

- **`zone` is required** once the site uses the zone-based firewall, which every 10.6 site does. The type has it optional only because older sites have no zones.
- **Changing `management` (or `site`) replaces the network,** deleting the old one first, because VLAN IDs must be unique. A network still used by a Wi-Fi broadcast outside the stack can't be deleted, so that replacement fails.
- **`isolationEnabled` and `internetAccessEnabled` create system firewall policies.** Isolation adds "Isolated Networks" BLOCK policies from the network to every internal zone (its own included); turning internet access off adds a "Block … Internet Access" policy to `External`. Your policies that should win over them need to come before them: list them in `beforeSystemDefined` of the pair's [`FirewallPolicyOrdering`](FirewallPolicyOrdering.md).
- **`mdnsForwardingEnabled` is the gateway mDNS proxy.** The UI's Gateway mDNS Proxy setting (Auto, Off, Custom) is a view of this flag across all networks. Saving that setting in the UI (or the global network settings form it shares) rewrites every network's flag, so set the flags in the stack and leave the UI setting alone. Unset, it's `true`, as the console defaults it.
- **Gateway networks need a gateway** adopted on the site.
- **WAN references** (in NAT and IPv6 prefix delegation) are still raw `wanInterfaceId` strings.
