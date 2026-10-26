# FirewallPolicy

A zone-based firewall policy: an `action` (`ALLOW`, `BLOCK`, `REJECT`) for traffic from a `source` zone to a `destination` zone, optionally narrowed by traffic filters, a protocol scope, connection state, IPsec and a schedule.

- **Endpoints are `{ zone, trafficFilter? }`.** `zone` is any zone reference (a resource, a lookup, or a built-in constant). Filters are the API's, with `networkFilter.networks` and `trafficMatchingList` references in place of IDs; other IDs (VPN servers, site-to-site tunnels, DPI apps) stay raw until those have resources.
- **Unset optional fields get an explicit default**, unlike other resources' props: leaving out a `trafficFilter`, `connectionStateFilter`, `ipsecFilter` or `schedule` removes it from the console's policy, and an unset `description` is blank (the console omits a blank one). Drift in any of them is put back on the next update. Updates send the whole body.
- **Changing zones updates the policy in place** (verified); it moves to the end of the new pair's `beforeSystemDefined`. Re-list it in that pair's `FirewallPolicyOrdering` to place it.
- **Names aren't unique**, even within a zone pair (verified), so adoption (name + zone pair, user-defined only) and lookups refuse several matches.
- **Derived policies are invisible.** Policies UniFi generates (`metadata.origin: "DERIVED"`, e.g. from UI Objects, or ones fresh sites have) are never listed, adopted or ordered; the API refuses to update or delete them. A managed policy may share a derived one's name: user-defined names aren't unique, so the console accepts it.
- **Network filters need gateway networks**, in the source and the destination alike. An unmanaged network is routed by another router, so the gateway's firewall never sees its traffic and can't filter it. The console rejects one with a bare 500 ("Unexpected error", verified for every zone pair tried) rather than a validation error.
- **`PATCH` exists but only takes `loggingEnabled`**, so the provider always uses `PUT`.
