# Resource implementation

How the resources in `packages/network/src` are built. `providers()` registers `FirewallZone`, `Network`, `WifiBroadcast`, `TrafficMatchingList`, `FirewallPolicy`, `FirewallPolicyOrdering` and `DnsPolicy`. The user-facing pages are in [`docs/resources/`](../resources/); the API behaviour behind these decisions is in [unifi-api.md](unifi-api.md#behaviour-not-in-the-spec).

## Conventions

- **Props are the Integration API's create/update body**, with three changes:
    - an optional `site` (see [architecture.md](architecture.md#sites));
    - references in place of ID fields: `zone` instead of `zoneId`, `network` instead of a `{ type: "SPECIFIC", networkId }` object, `device` instead of `deviceId`, and in firewall policy filters `networks` instead of `networkIds` and `trafficMatchingList` instead of `trafficMatchingListId`;
    - passphrases accept `Redacted` (the SDK marks them sensitive via `packages/network-sdk/patches/`).
- **References are structural** (`{ firewallZoneId }`, `{ networkId }`), as in Alchemy's own providers: a resource, a lookup result or a literal object all fit, and a bare string never typechecks. A reference carrying a `siteId` (resources and lookups do) is checked against the referencing resource's site.
- **Props are authoritative** (user's decision): every update sends the whole object, and an unset optional prop means an explicit default, never "keep the console's value". So a change made in the UI, to any field, is put back by the next update.
    - **Unset means absent**: an unset optional prop is left out of the body, and a `PUT` without a field removes or resets it (verified for the fields tested), so the console ends up with its own default.
    - **Explicit defaults are the documented exceptions**, each verified, for one of two reasons:
        - the console **keeps** the field's value when a `PUT` leaves it out, so it could never be reset (`Network`'s `mdnsForwardingEnabled`);
        - the console **reports a value** for the unset field, so a body without it would never match: every deploy would update it, and drift would report it, forever (`Network`'s DHCP `domainName: ""`, `WifiBroadcast`'s `bandSteeringEnabled: false`).
    - **`test/controller/Defaults.test.ts`** creates each variant from minimal props and asserts the console's object is exactly props plus these defaults, so a UniFi release that changes one fails there. A field found to break the rule gets an explicit default, a reason in the code, and a line under [Per resource](#per-resource).
- **Attributes** are `siteId`, `<thing>Id`, a few fields worth referencing (names, VLAN, zone, type), and `config`: the whole object as the console reports it, passphrases as `Redacted` (they're in state through props anyway). `alchemy drift` compares attributes, so `config` makes it see any change. Fields that change without the object being edited (a policy's `index`) are left out.
- **Objects UniFi generates are invisible** (user's decision): `metadata.origin: "DERIVED"` policies (e.g. made from UI Objects) are never listed, adopted or ordered. The API refuses to update or delete them anyway.

## Lifecycle

| Op          | Behaviour                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reconcile` | Get the object by ID; missing (404, or another site) ⇒ create. Otherwise compare the console's object with the desired body (props plus defaults) field for field, and on any difference `PUT` the desired body.                                                                                                                                                                                                        |
| `diff`      | `replace` when the site changes, or the variant where the console can't change it in place (`management`, Wi-Fi `type`); otherwise Alchemy's default (update when props change). Props that depend on undeployed resources are treated as unknown.                                                                                                                                                                      |
| `read`      | By ID; without state, by natural key, returned as `Unowned` so adoption needs `--adopt`. Natural keys: zone name (custom zones only), network VLAN ID (unique per site; adopting renames to match props), Wi-Fi name, list name, policy name + zone pair, DNS type + domain (+ value when a domain has several). Several matches ⇒ nothing adopted. Orderings are singletons per zone pair and adopt without `--adopt`. |
| `delete`    | 404 is success, as Alchemy requires. The site's default network is never deleted, and deleting an ordering leaves the order as it is.                                                                                                                                                                                                                                                                                   |
| `list`      | User-defined objects in the profile's site, for `alchemy nuke`. Orderings list nothing.                                                                                                                                                                                                                                                                                                                                 |

- **Adoption of a resource whose props reference another resource adopted in the same run is deferred**: Alchemy can't probe while props hold unresolved outputs, so `plan --adopt` shows it as `create`, and the deploy runs `read` just before creating and adopts the match instead. Verified against the test controller and both live consoles.
- **A deploy with unchanged props is a no-op**: Alchemy's plan doesn't read resources whose props are unchanged. `alchemy drift` (or `deploy --detect-drift`) reads them, reports changes, and repairs them.
- **Reads go through the read cache** (one list per type per site per run); writes invalidate it. Firewall policies, traffic-matching lists and DNS policies are read by ID from that list, since it returns whole objects (verified equal to `GET` and write responses), so a plan reading 35 policies costs one request; networks and Wi-Fi broadcasts need a `GET` each for their details. Writes take their attributes from the response.

## Lookups

`FirewallZone.lookup({ name })`, `Network.lookup({ name } | { vlanId })`, `WifiBroadcast.lookup({ name })`, `TrafficMatchingList.lookup({ name })` and `FirewallPolicy.lookup({ name, source?, destination? })` (each also takes `site`) return the same attributes as the resource, so they fit wherever a reference does. They run at plan time in the stack body. Alchemy only lets stack bodies fail with `ConfigError`, so a lookup that finds nothing (or several) **dies** with a user-facing `LookupNotFound` / `LookupAmbiguous` rather than failing with a typed error. `UnifiNetworkConnection` and `UnifiNetworkReadCache` carry Alchemy's `kind: "Environment"` tag so stack bodies may require them.

## Per resource

- **FirewallZone:**
    - networks join zones from the network side (`Network({ zone })`, user's decision). Both sides are writable in the API, so managing both would make the resources fight; the zone has no `networks` prop or `networkIds` attribute;
    - built-in zone constants resolve by name and `metadata.origin: "SYSTEM_DEFINED"` in the referencing resource's site;
    - a rename's body must include `networkIds`, which replaces the member list, and the zone's own `networkIds` lags a network joining by about 300 ms, so the provider builds the list from the networks' `zoneId`s.
- **Network:**
    - explicit defaults: a gateway network's `mdnsForwardingEnabled` is `true` (what the console sets on create; a `PUT` without it keeps the old value) and a DHCP server's `domainName` is `""` (reported when unset). Switch-managed networks aren't covered by `Defaults.test.ts`: the test controller has no layer-3 switch;
    - replacement deletes first (`deleteFirst`), because VLAN IDs are unique per site;
    - the default network (VLAN 1, `default: true`) is never deleted, and a change that would replace it fails the plan.
- **WifiBroadcast:**
    - explicit default: a standard broadcast's `bandSteeringEnabled` is `false` (reported when unset);
    - `broadcastingFrequenciesGHz` compares as a set: real consoles return their own order;
    - a reference to the default network (resource or lookup) is sent as `{ type: "NATIVE" }`, the only form the console accepts;
    - enterprise `radiusConfiguration` is `unknown`: the spec gives it no schema, and it hasn't been worked out on the controller.
- **FirewallPolicy:**
    - no explicit defaults: every optional criterion is removed by a `PUT` without it (verified);
    - `config` leaves out `index`, which changes whenever the pair's ordering does;
    - lists inside a policy (ports, addresses, networks, connection states) compare as sets;
    - `PATCH` only takes `loggingEnabled`, so updates are always `PUT`s;
    - adoption matches name and zone pair among user-defined policies, and refuses several matches.
- **FirewallPolicyOrdering:**
    - the API takes the whole pair or nothing, so unlisted policies are kept after the listed ones in their bucket, in their current relative order (a warning, or an error with `exclusive`);
    - policies the ordering stops listing are kept quietly, even when exclusive: Alchemy applies the ordering before deleting a removed policy. `listedFirewallPolicyIds` records what the props listed;
    - state-store policies (`alchemy-state/` names) are kept quietly too. The store may have created one after the run's policy list was cached, so unlisted policies missing from the cache are fetched by ID;
    - a listed policy that's missing, derived, in another pair or listed twice fails with `InvalidFirewallPolicyOrdering`.
- **TrafficMatchingList:** a delete refused because something outside the stack references the list (422) becomes `TrafficMatchingListInUse`, naming the user-defined policies that use it.
- **DnsPolicy:** there's no name, so adoption matches type and domain; when several records match, the one whose other props match too is adopted, and still several (or none) means nothing is adopted.
