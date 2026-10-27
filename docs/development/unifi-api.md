# UniFi APIs

What's known about the APIs the providers target. "Verified" means checked against the test controller (Network 10.6.109, see [testing.md](testing.md)).

## API surfaces

| API                                             | Base URL                                                                                                                                                                                                                           | Writes                                                                                                                                    | Notes                                                                                           |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **Network Integration API** (official, OpenAPI) | UniFi OS console: `https://<console>/proxy/network/integration`<br>Standalone controller: `https://<host>:8443/integration` (verified)<br>Remote: `https://api.ui.com/v1/connector/consoles/{consoleId}/proxy/network/integration` | networks, Wi-Fi broadcasts, firewall zones, policies and ordering, ACL rules and ordering, DNS policies, traffic matching lists, vouchers | Read-only for WANs, devices, clients, RADIUS profiles, VPN, switching. The SDK covers this API. |
| **Legacy internal API**                         | `/proxy/network/api/s/{site}/rest/*` (console), `/api/s/{site}/rest/*` (standalone)                                                                                                                                                | everything the UI can do                                                                                                                  | Unofficial. Whether it works through the cloud connector is unverified.                         |
| **Site Manager API**                            | `https://api.ui.com/v1`                                                                                                                                                                                                            | none                                                                                                                                      | Hosts, sites, devices, ISP metrics, SD-WAN; also hosts the cloud connector.                     |

All three authenticate with an `X-API-KEY` header. Local keys come from the Network app's Settings → Integrations; remote keys come from unifi.ui.com.

Specs are published per version at `https://developer.ui.com/network/v<version>/openapi.json` (and `/site-manager/v1.0.0/openapi.json`).

### Cloud connector

- Proxies any `/proxy/*` path to the console's `http://127.0.0.1/proxy/*`.
- Limits: 100 requests/minute per console, 25 s per request, 10 MB responses.
- Needs console firmware ≥ 5.0.3. Non-organisation keys only reach the key owner's consoles.
- Connector-level errors use `{ code, httpStatusCode, message, traceId }`. Network API errors use `{ statusCode, statusName, code, message, timestamp, requestPath, requestId }`. The SDK's error mapping handles both.

## Versions

- The newest published Network spec is **10.6.106**; 10.6.109 has no spec page. The vendored spec is 10.6.106, and the SDK works against 10.6.109 (verified).
- Ubiquiti has said 10.6 is the last standalone Network Application release. Network 11 ships with UniFi OS Server and on consoles.
- `GET /v1/info` returns `{ "applicationVersion": "10.6.109" }`.

## How API-key auth works inside a console

Verified by reading the 10.6.109 controller's bytecode and confirmed on the test controller:

1. UniFi OS validates `X-API-KEY` itself, then proxies `/proxy/network/*` to the Network app's internal API port (`unifi.local.http.port`, default 8081) with an `X-ApiKeyId` header.
2. The Network app fetches the key (`GET /api/apiKey/{id}`) and its creator (`GET /api/users/{id}`) from UniFi Core at `http://127.0.0.1:11081`. It checks permission scopes such as `view:controller:network` and `manage:controller:network`.
3. The Network app never sees the key secret. Its MongoDB `api_key` collection is only a cache of `{ uid, name, adminId, timeCreated }`.
4. The Integration API also accepts an `X-cloud-proxy-apikey` header. That's how cloud-connector requests arrive.

The standalone controller only uses this path if `integration.api.force.using.ucore.authentication=true` is set (JVM property) and its UniFi OS check passes. The test controller arranges both.

## Behaviour not in the spec

Verified on 10.6.109 (the test controller):

- **Gateway networks.** `management: "GATEWAY"` networks need a gateway device on the site (`api.network.validation.gateway-not-found-on-site`). Once zone-based firewall is enabled they also need `zoneId`.
- **Zone-based firewall** is a per-site migration (`POST /v2/api/site/{site}/firewall/migrate`, legacy v2 API). Before it, zone endpoints return `api.firewall.zone-based-firewall-not-configured`. It creates six system zones: `Internal`, `External`, `Gateway`, `Vpn`, `Hotspot`, `Dmz` (note `Vpn` and `Dmz`), with `metadata.origin: "SYSTEM_DEFINED"`.
- **Request bodies:** unknown properties are rejected (`Unknown request body property '$.id'`), so a `GET` response can't be sent back as an update without dropping `id`, `metadata` and (networks) `default`. Updates are full `PUT`s.
- **Networks:**
    - networks are keyed by an immutable UUID `id`; name and VLAN ID are ordinary fields, and changing the VLAN ID updates the network in place;
    - VLAN IDs must be unique per site (names needn't be); the default network's must be 1, and any other network's greater than 1;
    - deleting a network that a Wi-Fi broadcast uses fails unless `cascade=true`;
    - while networks are created or deleted, requests can fail with 422 "Configured network does not exist" for a moment, on any endpoint and any site of the console (networks, zones and policies seen under parallel tests). `withConnection` retries exactly that message;
    - a `PUT` removes optional fields it leaves out (DHCP guarding, DHCP server), except `mdnsForwardingEnabled`, which keeps its value;
    - unset on create, `mdnsForwardingEnabled` is `true` and a DHCP server's `domainName` is `""`.
- **Zones:**
    - updates must include `networkIds` and replace the member list: networks left out move to `Internal`;
    - a zone's `networkIds` lags a network joining it (by about 300 ms); the network's `zoneId` is current at once;
    - deleting a zone moves its networks to `Internal`;
    - built-in zones can be neither deleted nor renamed (422).
- **Wi-Fi broadcasts:**
    - a standard broadcast with WPA security requires `securityConfiguration.fastRoamingEnabled` ("WPA security combined with standard WiFi requires fast roaming setting"); the spec marks it optional;
    - `broadcastingFrequenciesGHz` takes numbers (`[2.4, 5]`), not strings;
    - `network: { type: "NATIVE" }` is the default network, which can't be referenced as `SPECIFIC` by ID;
    - WPA2 personal needs either preshared keys or both a network and a passphrase; open security and WPA2/WPA3 personal need a network; `mloEnabled` is rejected, even as `false`, unless the broadcast is WPA3 on several bands;
    - a `PUT` resets every optional field it leaves out (band steering, handoff thresholds, rekey interval, PMF mode); unset on create, `bandSteeringEnabled` is `false`;
    - `broadcastingFrequenciesGHz` order isn't kept: real consoles return their own order (e.g. `[5, 6, 2.4]` after sending `[2.4, 5, 6]`), and the test controller usually sorts but not always;
    - basic data rates (`basicDataRateKbpsByFrequencyGHz`) must be numbers; the spec types them as string enums, fixed by a patch (`patches/wifi-basic-data-rates.json`);
    - validation messages name fields by their Java names, not their JSON names (e.g. `band6GHzDtimPeriod` for the DTIM override's `"6"`).
- **Passphrases are readable.** `GET` on a Wi-Fi broadcast returns the passphrase in `securityConfiguration.passphrase`.
- **Server defaults.** Responses include fields the request didn't set (e.g. `mdnsForwardingEnabled: true`, `dhcpConfiguration.domainName: ""`).
- **Firewall policies:**
    - names aren't unique, even within a zone pair;
    - `PUT` can change a policy's zones; it moves to the end of the new pair's `beforeSystemDefined`;
    - `PATCH` only takes `loggingEnabled`;
    - lists inside a policy (ports, addresses, connection states) come back in an order of the console's own;
    - derived policies (`metadata.origin: "DERIVED"`) can't be updated or deleted ("Deletion of derived firewall policy is not allowed"), aren't in orderings, and fresh sites already have some (`Internal` → `Gateway`, no name);
    - a `NETWORK` traffic filter naming an unmanaged network fails with a bare 500 ("Unexpected error"), in the source or the destination, rather than a validation error: the gateway doesn't route that network, so can't filter it;
    - a destination `NETWORK` filter towards `External` is rejected properly (400 "Destination traffic filter not compatible with the zone");
    - a `PUT` without `description` removes it; `""` is stored as `""`.
- **Policy ordering.** `GET /firewall/policies/ordering?sourceFirewallZoneId=…&destinationFirewallZoneId=…` returns `{ orderedFirewallPolicyIds: { beforeSystemDefined: [...], afterSystemDefined: [...] } }`. New policies land at the end of `beforeSystemDefined`. A `PUT` must list every user-defined policy in the pair ("Not all firewall policies specified for the given firewall zone combination"); policies can move between the two buckets.
- **Network flags and system policies** (verified on a UniFi Express 7; test-controller sites have no system-defined policies, so this can't be tested there):
    - `isolationEnabled: true` adds system-defined "Isolated Networks" BLOCK policies from the network's subnet to every internal zone (its own included), not to `Gateway` or `External`;
    - `internetAccessEnabled: false` adds a system-defined "Block <subnet> Internet Access" policy to `External`;
    - per-network `mdnsForwardingEnabled` (legacy `mdns_enabled`) is what the UI shows as the Gateway mDNS Proxy mode, and it gates the system "Allow mDNS" policies to `Gateway`.
- **Default security posture** (legacy setting `global_network.default_security_posture`, `ALLOW_ALL` / `BLOCK_ALL`) only sets UI defaults for networks, port profiles and devices created later; changing it leaves existing policies and networks as they are (verified). Writing it through the legacy API with an API key fails with `api.err.Invalid`; the UI saves it in one form with the mDNS proxy setting.
- **The legacy API accepts Integration API keys** (`X-API-KEY`) for reads, locally and through the ui.com connector (verified on both consoles).
- **Traffic-matching lists:** names are unique (422 on a duplicate); `PUT` can change `type`; deleting one an enabled policy references fails with 422 "Selected traffic matching list is referenced by other resources", but deleting one only disabled policies reference succeeds and leaves them with a dangling filter (no `trafficMatchingListId`), which then can't be re-enabled ("Traffic Matching List with id=… does not exist").
- **DNS policies:** several records of one type may share a domain (e.g. two A records), but a CNAME whose alias overlaps another is rejected; `PUT` can change `type`.
- **Lists.** Pagination is `offset`/`limit` (max 200) with `{ offset, limit, count, totalCount, data }`. Filters use `filter=name.eq('x')`-style expressions; filterable fields are listed per operation in the spec.
- **Missing objects** return 404 (`NotFound` in the SDK). So does any request under a site ID the console doesn't have, reads and deletes alike (`api.resource-not-found`).
- **Sites:**
    - the Integration API only lists them (`GET /v1/sites`). Creating and deleting them takes the legacy API (`POST /api/s/default/cmd/sitemgr` with `add-site` / `delete-site`), so a deleted site can't be brought back through the Integration API;
    - the list is cached for about 10 s: a new site appears, and a deleted one disappears, only after that;
    - names needn't be unique; internal references (`default`, or generated like `x7k2m9q1`) are;
    - deleting a site deletes its devices too.
