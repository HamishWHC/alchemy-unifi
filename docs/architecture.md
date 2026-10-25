# alchemy-unifi architecture

Status: **proposal for review.** What exists so far:

- tooling;
- the generated SDK (`src/sdk`);
- a Docker controller for tests;
- an empty provider collection.

No resources are implemented yet.

## Goals

- Alchemy (v2, Effect-native) providers for Ubiquiti UniFi, starting with the UniFi Network application.
- Every resource works over both connection types against the same API:
    - **local**: direct to the console (e.g. `https://192.168.1.1`) or to a self-hosted controller;
    - **remote**: via the `api.ui.com` cloud connector.
- One package per UniFi application (`network` now; `site-manager`, `protect`, … later), each publishable independently.
- Follow existing Alchemy providers' conventions wherever one exists.
- Cover the whole Network API surface over time, **including** deployment-specific things like WANs. Whether a given stack manages them is the stack's choice (home-network won't).

Non-goals for now: Site Manager/Protect resources, multi-console stacks, Bun.

## Repository layout

```text
alchemy-unifi/                       pnpm 12 + turbo workspace, pnpm-native versioning
├── docs/architecture.md
└── packages/
    └── network/                     @alchemy-unifi/network
        ├── openapi/                 vendored specs: network-<version>.json
        ├── scripts/
        │   ├── normalise-spec.ts    fixes for the published spec (see "SDK")
        │   ├── convert.ts           OpenAPI → Smithy (.generated-specs/network.json, gitignored)
        │   └── generate.ts          Smithy → Effect SDK (src/sdk/services, committed)
        ├── src/
        │   ├── sdk/                 distilled-style SDK: generated services + hand-written
        │   │                        credentials, errors, protocol, retry, traits, pagination
        │   ├── index.ts             public namespace (`import * as UnifiNetwork`)
        │   ├── Providers.ts         ProviderCollection + providers()
        │   ├── Credentials.ts       connection config resolved from the profile
        │   └── <Resource>.ts        one file per resource (planned)
        └── test/
            └── controller/          Docker UniFi Network Application for lifecycle tests
```

`src/sdk` follows the layout of a `@distilled.cloud/*` package exactly. It can become its own package, or be upstreamed to distilled as `@distilled.cloud/unifi-network`, without changes. Alchemy's own providers depend on separate distilled SDK packages in the same way. When `site-manager` arrives, the shared `api.ui.com` auth and connection code moves to `@alchemy-unifi/core`.

## UniFi API surfaces

| API                                                            | Base URL                                                                                                                                                                                                                                       | Write coverage                                                                                                                                                                                         | Used for                                                                         |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| **Network Integration API** (official, OpenAPI)                | UniFi OS console: `https://<console>/proxy/network/integration`<br>Standalone controller: `https://<host>:8443/integration` (verified on 10.6.109)<br>Remote: `https://api.ui.com/v1/connector/consoles/{consoleId}/proxy/network/integration` | networks, Wi-Fi broadcasts, firewall zones and policies (+ordering), ACL rules (+ordering), DNS policies, traffic matching lists, vouchers; read-only for WANs, devices, clients, RADIUS profiles, VPN | Everything we can                                                                |
| **Legacy internal API** (`/proxy/network/api/s/{site}/rest/*`) | local; remote unverified                                                                                                                                                                                                                       | everything the UI can do                                                                                                                                                                               | Later: legacy-only resources such as writable WANs, port forwards, static routes |
| **Site Manager API** (`api.ui.com/v1`)                         | remote                                                                                                                                                                                                                                         | read-only                                                                                                                                                                                              | Picking a console during `profile` setup; the future `site-manager` package      |

All three take `X-API-KEY`. Remote-mode limits: 100 requests/minute per console, 25 s timeout, 10 MB responses.

Local mode probes `GET {url}/proxy/network/integration/v1/info`, then `{url}/integration/v1/info`, and caches whichever answers. That way the same profile shape works for a console and for a self-hosted controller.

### Version policy

Support the latest stable Network release only.

- The newest spec Ubiquiti publishes is still **10.6.106**; there's no spec page for 10.6.109. Your network runs 10.6.109, and so does the test controller. The vendored spec is 10.6.106, and the generated SDK works against 10.6.109 (verified end to end).
- Ubiquiti has said 10.6 is the last standalone Network Application. Network 11 ships with UniFi OS Server and consoles. Bump the spec when developer.ui.com publishes an 11.x spec.

## SDK: distilled codegen

The SDK is generated with distilled's own pipeline (`@distilled.cloud/core/codegen`), the same one used by the SDKs behind Alchemy's built-in providers. `pnpm generate` runs:

1. **`normalise-spec.ts`** fixes two problems in the published spec:
    - schema names like `"Create or update Network"` are rewritten to identifiers, including inside `discriminator.mapping`;
    - Java-style `discriminator.mapping` polymorphism is rewritten to `oneOf` unions with literal tags.

    Without these, every polymorphic type (network IPv4/DHCP/IPv6 config, Wi-Fi security, policy actions, protocol scopes) degrades to `unknown`.

2. **`convert.ts`** runs distilled's OpenAPI → Smithy converter.
3. **`generate.ts`** runs the Smithy → Effect compiler.
    - `unionStyle: "untagged"`, so union payloads are validated against their case schemas.
    - Offset/limit list operations are marked paginated and use `paginateOffset` (`src/sdk/pagination.ts`), since UniFi returns `totalCount` rather than a next-offset token.

The result is 73 operations, each an `Effect` with typed errors (`catchTag("NotFound", …)`), retry policies, and `.pages()`/`.items()` streams on list operations. It needs a `Credentials` layer (`{ baseUrl, apiKey }`) and an `HttpClient`. The generated code passes our strict tsconfig.

Known spec gaps: 24 members remain `unknown` because UniFi's spec gives them no schema (ACL/firewall `sourceFilter`/`destinationFilter`, Wi-Fi `radiusConfiguration`, device `accessPoint`). These get fixed with distilled's RFC-6902 patches (`patches/*.json`) as each resource needs them.

Distilled core imports `@effect/platform-node` and `rolldown` without declaring them, so these are declared via `packageExtensions` in `pnpm-workspace.yaml`. That's worth reporting upstream.

## Package internals

```text
<Resource>.ts      yield* SDK operations; lookups; ordering
     │
Connection         resolves the profile into the SDK's Credentials ({ baseUrl, apiKey }):
                   local path probe, TLS handling, remote rate limiting, per-run read cache
     │
src/sdk            generated operations + UnifiNetworkProtocol (X-API-KEY, error envelopes, retry)
     │
AuthProvider       profile/env resolution (local | remote)
```

- **Errors and retry** come from distilled's protocol: typed status errors, throttling and transient retry policies.
- **TLS.** Consoles use self-signed certs, so the connection layer supplies an `HttpClient` built on an undici dispatcher. It either pins the console's certificate fingerprint (preferred) or skips verification (`insecure`). Node only.
- **Remote rate limit.** A semaphore/token bucket under 100 requests/minute, plus distilled's throttling retry on 429.
- **Per-run read cache.** Within one plan/deploy, list results are cached per (site, type) and invalidated on writes to that type. Lookups, `read` and natural-key searches then hit the console once, which matters most under the remote rate limit.

## Connections and auth

A hand-rolled `AuthProvider` named `UnifiNetwork` (`makeStoredAuthProvider` is single-method) with two methods:

| Method   | Stored fields                                                   | Env vars                                                     |
| -------- | --------------------------------------------------------------- | ------------------------------------------------------------ |
| `local`  | `url`, `apiKey` (secret), `caFingerprint` or `insecure`, `site` | `UNIFI_URL`, `UNIFI_API_KEY`, `UNIFI_INSECURE`, `UNIFI_SITE` |
| `remote` | `consoleId`, `apiKey` (secret), `site`                          | `UNIFI_CONSOLE_ID`, `UNIFI_API_KEY`, `UNIFI_SITE`            |

- `configure` for `remote` lists your consoles via Site Manager `GET /v1/hosts`.
- `details` shows the console, connection type and Network version.
- Credentials resolve lazily (`resolveProviderConfig` + `Effect.cached`), like the Neon provider.
- There is one console per profile. Multi-site setups use one stage + profile per site.
- Outside CI, Alchemy prefers env vars over the profile when all required vars are set, so multi-site users should keep `UNIFI_*` out of `.env`.

## Resource model

Conventions follow Alchemy's providers (Neon, Cloudflare):

- **Types and exports:** type strings are `UnifiNetwork.<Name>`, and users call `UnifiNetwork.Network("Trusted", {...})`.
- **Attributes** are named for the thing (`networkId`, `firewallZoneId`, `wifiBroadcastId`, `siteId`), never a bare `id`, matching `productId`, `branchId` and `zoneId` in Alchemy's providers.
- **Props** are a thin layer over the SDK's create/update types, with these changes:
    - an optional `site` (defaults to the profile's site);
    - references in place of raw ID fields (`zone` instead of `zoneId`);
    - `Redacted<string>` for secrets.

### References and IDs

Alchemy's convention is **structural references**. Neon's `branch: { projectId; branchId }` and Cloudflare's `zone: { zoneId }` are satisfied by the resource itself, or by an object literal when you hold a raw ID. We do the same:

```ts
export type FirewallZoneReference = { readonly firewallZoneId: string } | BuiltinFirewallZone;

Effect.gen(function* () {
	// A FirewallZone resource:
	const a = { zone: trustedZone };
	// A raw ID, explicitly labelled:
	const b = { zone: { firewallZoneId: "ffcdb32c-…" } };
	// An object made in the UI:
	const c = { zone: yield* UnifiNetwork.FirewallZone.lookup({ name: "Cameras" }) };
	// A built-in zone:
	const d = { zone: UnifiNetwork.FirewallZone.EXTERNAL };
});
```

This gives the safety of a nominal ID type: a bare string never typechecks, and the `{ firewallZoneId }` label forces the intent to be explicit. It also stays compatible with how Alchemy wires `Output`s, which a branded string class would complicate.

On lookups: Alchemy has no standard lookup API. Its providers use plain Effect functions internally (Cloudflare's `findZoneByName`, AWS's `lookupAssetsBucket`). We expose them as `Resource.lookup(query)`, beside Alchemy's own `Resource.ref(...)`, which reads another stage's state. A lookup returns the same structural reference, and fails with a typed `NotFound`. It creates no state, so it can never delete anything. Planned lookups:

- `Network.lookup`, `FirewallZone.lookup`, `WifiBroadcast.lookup`;
- `Wan.lookup`, `Device.lookup`, `RadiusProfile.lookup`, `DpiApplication.lookup`, `Country.lookup`.

### Built-in firewall zones

Built-in zones have per-console UUIDs, so the constants are symbolic references, resolved at reconcile time by name with `metadata.origin = SYSTEM_DEFINED` (Alchemy's constant style is SCREAMING_SNAKE):

```ts
UnifiNetwork.FirewallZone.INTERNAL;
UnifiNetwork.FirewallZone.EXTERNAL;
UnifiNetwork.FirewallZone.GATEWAY;
UnifiNetwork.FirewallZone.VPN;
UnifiNetwork.FirewallZone.HOTSPOT;
UnifiNetwork.FirewallZone.DMZ;
```

Verified against the test controller: the zone-based firewall migration creates exactly `Internal`, `External`, `Gateway`, `Vpn`, `Hotspot` and `Dmz` (note the API's spelling of the last two).

To attach networks to a built-in zone, use `FirewallZone("Internal", { builtin: FirewallZone.INTERNAL, networks: [...] })`. It adopts the system zone and only syncs `networkIds`, since the API rejects other changes; `delete` detaches its networks rather than deleting the zone.

### Lifecycle mapping

| Operation   | Behaviour                                                                                                                                                                  |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reconcile` | Observe by `output.<x>Id` (missing ⇒ create); compare only fields the user set (the API fills server defaults); `PUT` the full DTO only on drift; return fresh attributes. |
| `diff`      | `replace` on site change or variant change (network `management`, Wi-Fi `type`); otherwise update. Guarded by `isResolved`.                                                |
| `read`      | By ID, else natural key (name; plus VLAN for networks). UniFi objects have no tags, so matches return `Unowned(attrs)` and taking them over needs `--adopt` (see below).   |
| `delete`    | `DELETE`, 404 = success; system-defined objects are released, not deleted.                                                                                                 |
| `list`      | Exhaustive `items()` stream of user-defined objects.                                                                                                                       |

### Adoption

`alchemy deploy --adopt` (preview with `alchemy plan --adopt`) is a single flag for the whole run. For any resource with no state, the engine calls `read`; a match marked `Unowned` fails with `OwnedBySomeoneElse` unless the flag is set, in which case it's silently taken over. State is then written, and later runs never ask again.

So adopting the existing consoles is one reviewed `--adopt` run per site, and recovering a lost state store is another. That's simple enough that ownership markers (e.g. in policy `description` fields) aren't worth it.

The one caveat is that the flag isn't per-resource: in a run with `--adopt`, every unowned name collision is taken over. The plan lists each takeover, so review it.

### Firewall policy ordering

UniFi orders user-defined policies per (source zone, destination zone) pair, in two buckets, before and after the system-defined ones (`PUT /firewall/policies/ordering`). Ordering is a resource per zone pair:

```ts
// alchemy.run.ts (excerpt)
Effect.gen(function* () {
	const trustedZone = yield* UnifiNetwork.FirewallZone("Trusted", { name: "Trusted", networks: [trusted] });
	const iotZone = yield* UnifiNetwork.FirewallZone("IoT", { name: "IoT", networks: [iot] });

	const allowHomeAssistant = yield* UnifiNetwork.FirewallPolicy("AllowHomeAssistantToIoT", {
		name: "Allow Home Assistant to IoT",
		enabled: true,
		action: { type: "ALLOW" },
		source: { zone: trustedZone /* , trafficFilter: Home Assistant's IP */ },
		destination: { zone: iotZone },
		ipProtocolScope: { ipVersion: "IPV4" },
		loggingEnabled: false,
	});

	const blockTrustedToIoT = yield* UnifiNetwork.FirewallPolicy("BlockTrustedToIoT", {
		name: "Block Trusted to IoT",
		enabled: true,
		action: { type: "BLOCK" },
		source: { zone: trustedZone },
		destination: { zone: iotZone },
		ipProtocolScope: { ipVersion: "IPV4_AND_IPV6" },
		loggingEnabled: true,
	});

	// Allow must be evaluated before the blanket block.
	yield* UnifiNetwork.FirewallPolicyOrdering("TrustedToIoT", {
		source: trustedZone,
		destination: iotZone,
		beforeSystemDefined: [allowHomeAssistant, blockTrustedToIoT],
	});
});
```

Semantics:

- **Dependencies.** Listing a policy makes the ordering depend on it, so policies are created before they're ordered and the ordering is re-applied when the set changes.
- **Validation.** `reconcile` fails with a typed error if a listed policy's zones don't match the pair.
- **Unmanaged policies.** Policies in the pair that this stack doesn't manage (e.g. created in the UI) are kept, after the managed ones in their current relative order, with a warning. Set `exclusive: true` to fail instead.
- **Identity.** The zone pair is the identity, so `read` adopts an existing ordering without `--adopt` (singleton semantics). `delete` leaves the current order in place.
- Verified on the test controller: `GET /firewall/policies/ordering?sourceFirewallZoneId=…&destinationFirewallZoneId=…` returns `{ orderedFirewallPolicyIds: { beforeSystemDefined, afterSystemDefined } }`, and new policies land at the end of `beforeSystemDefined`.
- `AclRuleOrdering` works the same way (`PUT /acl-rules/ordering`).

### Other conventions

- Guard critical objects with `RemovalPolicy.retain(...)`, Alchemy's equivalent of `prevent_destroy`.
- Hotspot vouchers stay out of scope (they're ephemeral, not configuration).

## Roadmap

1. **Foundation**: connection layer (path probe, TLS, rate limit, cache), `AuthProvider`, site resolution, lifecycle tests on the Docker harness (see Testing).
2. **Core resources**: `Network`, `WifiBroadcast`, `FirewallZone` (+ built-ins), lookups.
3. **Policies**: `FirewallPolicy` + `FirewallPolicyOrdering`, `AclRule` + `AclRuleOrdering`, `DnsPolicy`, `TrafficMatchingList`.
4. **Read-only and site-specific lookups**: `Wan`, `Device`, `RadiusProfile`, `DpiApplication`, VPN.
5. **Legacy client** for writable WANs and other legacy-only resources, after a spike on legacy-over-connector.

## Testing

- **Unit:** an in-memory fake of the Integration API, as an `HttpClient` layer, covering drift, 404 recovery, adoption, system objects and ordering.
- **Lifecycle:** `alchemy/Test/Vitest` `test.provider` against a disposable controller (`test/controller`: `docker compose up -d && ./setup.sh`). No VM, no real console.

### The test controller

`linuxserver/unifi-network-application:10.6.109` with MongoDB, made to behave like a UniFi OS console. On consoles, UniFi OS validates `X-API-KEY` and forwards requests to the Network app with an `X-ApiKeyId` header; the Network app then fetches the key's details and scopes from UniFi Core. The harness reproduces that:

```text
test ──X-API-KEY──▶ unifi-os sidecar :18080/proxy/network/*  (fake UniFi OS proxy: key → X-ApiKeyId)
                        ▼
                    unifi :8080 (Network 10.6.109 + api-key-agent)
                        │ GET /api/apiKey/{id}, /api/users/{id}, /api/system
                        ▼
                    unifi-os sidecar 127.0.0.1:11081  (fake UniFi Core: one fixed key, full scopes)
```

- **`fake-unifi-os.mjs`** (Node, no dependencies) plays both UniFi OS roles, sharing the controller's network namespace.
- **`-Dintegration.api.force.using.ucore.authentication=true`** is an existing switch in the Network app. It points the Integration API at the UniFi OS authenticator.
- **`agent/ApiKeyAgent.java`** is needed because that authenticator still bails out unless the app runs in full UniFi OS mode, and full mode needs proprietary UniFi OS components (gRPC services) that the standalone build lacks. This tiny Java agent flips only the authenticator's check, using the JDK's built-in ClassFile API. It's compiled at `compose up` by a JDK 25 container. It targets obfuscated names, so it's tied to 10.6.109 and must be re-checked on each controller bump.
- **`internal-port.sh`** sets `unifi.local.http.port=8080`, because the authenticator only trusts requests that arrive on the internal API port.
- **`setup.sh`**:
    1. runs first-run setup;
    2. registers a fake, offline **UDM Pro** in MongoDB, because gateway-managed networks require a gateway on the site;
    3. runs the real zone-based firewall migration (`POST /v2/api/site/default/firewall/migrate`), which creates the built-in zones.

Verified end to end on a clean start:

- API-key auth on the console path `/proxy/network/integration/v1` (wrong keys get 401);
- network create/update/delete (unmanaged and gateway-managed with DHCP), with typed `NotFound` after delete;
- Wi-Fi broadcast create, with the passphrase readable on `GET`;
- built-in zones, custom zones, firewall policies, and policy ordering.

Things the controller taught us that the spec doesn't say, which become spec patches or provider validation:

- gateway networks need `zoneId` once zone-based firewall is on;
- WPA Wi-Fi needs `securityConfiguration.fastRoamingEnabled`;
- Wi-Fi requires `bssTransitionEnabled`, `advertiseDeviceName`, `arpProxyEnabled`, and a numeric `broadcastingFrequenciesGHz`;
- responses include server defaults the request didn't set (e.g. `mdnsForwardingEnabled`, `domainName: ""`), confirming the "compare only fields you set" rule.

Limits:

- the fake gateway is offline, so anything that needs a live device (WAN status, client data, device actions) isn't testable;
- the remote connector path is covered by unit tests only, since only the base URL and rate limiting differ.

## Tooling

- **pnpm 12** (`devEngines`) with **pnpm-native versioning**:
    - `pnpm change` records an intent (`.changeset/*.md`);
    - `pnpm version -r` applies the intents;
    - `pnpm release` (turbo build, then `pnpm publish -r`) publishes;
    - changelogs are committed (`versioning.changelog.storage: repository`).
- turbo, lefthook, oxlint and oxfmt (configs from bitburner-sync).
- **TypeScript 7.1.0-beta**, pinned, with `@effect/tsgo`. This lets tsdown emit bundled declarations via `dts: { generator: "tsgo" }`. Downsides of the beta:
    - compiler bugs are possible;
    - rolldown-plugin-dts labels its tsgo mode experimental, though the output looked correct on the current surface;
    - `@effect/tsgo` and oxlint have to keep supporting the exact beta, so bump all three together.

    Moving to 7.1 stable is a one-line change.

- `exports` point at `dist/` (built `index.mjs` + `index.d.mts`), so consumers, including injected local ones, always get build output. Workspace tests import `src/` relatively.
- `dependencies`/`peerDependencies` use literal ranges rather than `catalog:` so the package installs correctly via `file:`. `devDependencies` use the catalog.
- `alchemy` and `effect` are peer dependencies, as in Alchemy's own provider packages.

## Open questions and risks

1. **Test controller upkeep**: the API-key agent targets obfuscated 10.6.109 names; each controller bump needs a quick re-check. The spike tooling that found them is described in Testing.
2. **Legacy API over the connector**: unverified; only matters for legacy-only resources.
3. **Spec gaps**: patching the 24 untyped members, plus the undocumented required fields above, as resources need them.
4. **Network 11 / UniFi OS Server**: track for the spec bump; check path and auth parity.
