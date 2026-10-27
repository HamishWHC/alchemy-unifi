# FirewallZone

A custom zone in the zone-based firewall. Zones group networks, and [firewall policies](FirewallPolicy.md) apply between zones.

```ts
import * as UnifiNetwork from "@alchemy-unifi/network";
import * as Effect from "effect/Effect";

export const zones = Effect.gen(function* () {
	const iot = yield* UnifiNetwork.FirewallZone("iot-zone", { name: "IoT" });
	// Networks join a zone from the network's side.
	const sensors = yield* UnifiNetwork.Network("sensors", {
		management: "GATEWAY",
		name: "Sensors",
		vlanId: 21,
		enabled: true,
		cellularBackupEnabled: false,
		internetAccessEnabled: false,
		isolationEnabled: false,
		zone: iot,
		ipv4Configuration: { autoScaleEnabled: false, hostIpAddress: "192.168.21.1", prefixLength: 24 },
	});
	return { iot, sensors };
});
```

**Built-in zones** aren't resources: use `FirewallZone.INTERNAL`, `EXTERNAL`, `GATEWAY`, `VPN`, `HOTSPOT` and `DMZ` wherever a zone goes.

**Lookup:** `FirewallZone.lookup({ name })` finds any zone, built-in or custom.

**Adoption** matches the zone's name (custom zones only).

## Gotchas

- **Membership is set on the network** (`Network`'s `zone`), not on the zone, so the two never disagree.
- **Deleting a zone moves its networks to `Internal`.** Alchemy updates networks that referenced the zone before deleting it.
