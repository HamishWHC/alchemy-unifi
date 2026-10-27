# DnsPolicy

The gateway's local DNS: a record (`A_RECORD`, `AAAA_RECORD`, `CNAME_RECORD`, `MX_RECORD`, `SRV_RECORD`, `TXT_RECORD`), or a `FORWARD_DOMAIN` rule that sends a domain's queries to another DNS server.

```ts
import * as UnifiNetwork from "@alchemy-unifi/network";
import * as Effect from "effect/Effect";

export const dns = Effect.gen(function* () {
	yield* UnifiNetwork.DnsPolicy("nas", {
		type: "A_RECORD",
		enabled: true,
		domain: "nas.home.arpa",
		ipv4Address: "192.168.10.5",
		ttlSeconds: 300,
	});
	yield* UnifiNetwork.DnsPolicy("files", {
		type: "CNAME_RECORD",
		enabled: true,
		domain: "files.home.arpa",
		targetDomain: "nas.home.arpa",
		ttlSeconds: 300,
	});
	yield* UnifiNetwork.DnsPolicy("lab", {
		type: "FORWARD_DOMAIN",
		enabled: true,
		domain: "lab.home.arpa",
		ipAddress: "192.168.10.53",
	});
});
```

**Adoption** matches type and domain. A domain may have several records of one type; then the one whose other props match too is adopted.

## Gotchas

- **The console checks records against each other,** e.g. it rejects a CNAME that overlaps another record.
- **Changing `type` updates the record in place.**
