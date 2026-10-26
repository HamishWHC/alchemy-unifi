# FirewallPolicy

A zone-based firewall policy: an `action` (`ALLOW`, `BLOCK`, `REJECT`) for traffic from a `source` zone to a `destination` zone, optionally narrowed by traffic filters, a protocol scope, connection state, IPsec and a schedule.

- **Endpoints are `{ zone, trafficFilter? }`.** `zone` is any zone reference (a resource, a lookup, or a built-in constant). Filters are the API's, with `networkFilter.networks` and `trafficMatchingList` references in place of IDs; other IDs (VPN servers, site-to-site tunnels, DPI apps) stay raw until those have resources.
- **No explicit defaults** (see the [conventions](README.md#conventions)): leaving out a `trafficFilter`, `connectionStateFilter`, `ipsecFilter`, `schedule` or `description` means none; a `PUT` without one removes it (verified). `config` leaves out `index`, which changes whenever the pair's ordering does.
- **Changing zones updates the policy in place** (verified); it moves to the end of the new pair's `beforeSystemDefined`. Re-list it in that pair's `FirewallPolicyOrdering` to place it.
- **Names aren't unique**, even within a zone pair (verified), so adoption (name + zone pair, user-defined only) and lookups refuse several matches.
- **Derived policies are invisible.** Policies UniFi generates (`metadata.origin: "DERIVED"`, e.g. from UI Objects, or ones fresh sites have) are never listed, adopted or ordered; the API refuses to update or delete them. A managed policy may share a derived one's name: user-defined names aren't unique, so the console accepts it.
- **Network filters need gateway networks**, in the source and the destination alike. An unmanaged network is routed by another router, so the gateway's firewall never sees its traffic and can't filter it. The console rejects one with a bare 500 ("Unexpected error", verified for every zone pair tried) rather than a validation error.
- **`PATCH` exists but only takes `loggingEnabled`**, so the provider always uses `PUT`.
