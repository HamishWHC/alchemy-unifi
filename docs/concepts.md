# Concepts

## Props mirror the API

Each resource's props are the UniFi Network Integration API's create/update body, so the API's field names and options carry over. The differences:

- **References instead of IDs:** `zone` instead of `zoneId`, `network` instead of a network ID, `trafficMatchingList` instead of a list ID, and so on.
- **`site`:** optional on every resource, only needed on consoles hosting several UniFi sites ([details](connecting.md#several-consoles-sites-or-connections)).
- **Passphrases take `Redacted`** values.

## References

A reference is a small object naming another object: `{ firewallZoneId }`, `{ networkId }`, `{ trafficMatchingListId }`. Resources, lookups and built-in constants all fit, and so does a literal object with an ID you already know. Passing a resource also makes Alchemy create it first.

```ts
import * as UnifiNetwork from "@alchemy-unifi/network";
import * as Effect from "effect/Effect";

export const references = Effect.gen(function* () {
	const managed = yield* UnifiNetwork.FirewallZone("cameras", { name: "Cameras" }); // a resource
	const existing = yield* UnifiNetwork.FirewallZone.lookup({ name: "IoT" }); // a lookup
	const builtIn = UnifiNetwork.FirewallZone.EXTERNAL; // a built-in zone
	const known = { firewallZoneId: "6630f3a9-7a4c-4c1d-9b1e-0d0c4a5e2b11" }; // an ID you know
	return [managed, existing, builtIn, known];
});
```

## Lookups

`FirewallZone.lookup`, `Network.lookup`, `WifiBroadcast.lookup`, `TrafficMatchingList.lookup` and `FirewallPolicy.lookup` find things the stack uses but doesn't manage. They run during `plan`, and return the same attributes as the resource, so a lookup fits anywhere a reference does.

```ts
import * as UnifiNetwork from "@alchemy-unifi/network";
import * as Effect from "effect/Effect";

export const lookups = Effect.gen(function* () {
	const lan = yield* UnifiNetwork.Network.lookup({ vlanId: 1 });
	const guests = yield* UnifiNetwork.Network.lookup({ name: "Guests" });
	const printers = yield* UnifiNetwork.TrafficMatchingList.lookup({ name: "Printers" });
	return { lan: lan.networkId, guests: guests.networkId, printers: printers.trafficMatchingListId };
});
```

A lookup that finds nothing, or several matches, stops the plan with an error listing what it searched for.

## Built-in zones

The zone-based firewall's system zones are constants, not resources: `FirewallZone.INTERNAL`, `EXTERNAL`, `GATEWAY`, `VPN`, `HOTSPOT` and `DMZ`. They can't be renamed or deleted. Custom zones are [`FirewallZone`](resources/FirewallZone.md) resources.

## Changes made in the UI

**Props are the whole truth.** Every update sends the complete object, and an optional prop you leave out means "the console's default", never "whatever's there now". So:

- A change made in the UI, to any field of a managed object, is undone by the next update of that object.
- `alchemy deploy` only updates objects whose props changed. To find and undo changes made in the UI, run `npx alchemy drift --stage home` (or `deploy --detect-drift`).
- Objects the stack doesn't manage are left alone.

Some UI settings are views of fields the provider manages, so changing them in the UI rewrites managed objects. The resource pages point these out, e.g. the gateway mDNS proxy setting on [`Network`](resources/Network.md#gotchas).

## Adoption

A resource whose object already exists (same natural key) isn't created again: `deploy --adopt` takes it over, and updates it to match the props. Each resource page lists its natural key. Without `--adopt`, the deploy stops with an error, so existing objects are never taken over by accident.

When several objects match a natural key (some, like policy names, needn't be unique), nothing is adopted, and the deploy creates a new one.

## Objects UniFi generates

UniFi creates some firewall policies itself: system policies between zones, and derived policies (e.g. from UI objects). The provider never lists, adopts, changes or orders derived policies, and system policies can't be edited. Your policies sit before or after the system ones (see [`FirewallPolicyOrdering`](resources/FirewallPolicyOrdering.md)).
