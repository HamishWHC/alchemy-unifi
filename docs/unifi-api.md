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

Verified on 10.6.109:

- **Gateway networks.** `management: "GATEWAY"` networks need a gateway device on the site (`api.network.validation.gateway-not-found-on-site`). Once zone-based firewall is enabled they also need `zoneId`.
- **Zone-based firewall** is a per-site migration (`POST /v2/api/site/{site}/firewall/migrate`, legacy v2 API). Before it, zone endpoints return `api.firewall.zone-based-firewall-not-configured`. It creates six system zones: `Internal`, `External`, `Gateway`, `Vpn`, `Hotspot`, `Dmz` (note `Vpn` and `Dmz`), with `metadata.origin: "SYSTEM_DEFINED"`.
- **Wi-Fi broadcasts:**
    - WPA security requires `securityConfiguration.fastRoamingEnabled`;
    - `bssTransitionEnabled`, `advertiseDeviceName` and `arpProxyEnabled` are required;
    - `broadcastingFrequenciesGHz` takes numbers (`[2.4, 5]`), not strings.
- **Passphrases are readable.** `GET` on a Wi-Fi broadcast returns the passphrase in `securityConfiguration.passphrase`.
- **Server defaults.** Responses include fields the request didn't set (e.g. `mdnsForwardingEnabled: true`, `dhcpConfiguration.domainName: ""`).
- **Policy ordering.** `GET /firewall/policies/ordering?sourceFirewallZoneId=…&destinationFirewallZoneId=…` returns `{ orderedFirewallPolicyIds: { beforeSystemDefined: [...], afterSystemDefined: [...] } }`. New policies land at the end of `beforeSystemDefined`.
- **Lists.** Pagination is `offset`/`limit` (max 200) with `{ offset, limit, count, totalCount, data }`. Filters use `filter=name.eq('x')`-style expressions; filterable fields are listed per operation in the spec.
- **Missing objects** return 404 (`NotFound` in the SDK).
