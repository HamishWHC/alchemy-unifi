# @alchemy-unifi/network

[Alchemy](https://alchemy.run) provider for the UniFi Network application: manage a UniFi site's networks, Wi-Fi and zone-based firewall as Effect code. It connects to a console directly or through the ui.com cloud connector, and can keep the stack's state on the console itself.

```sh
npm install @alchemy-unifi/network alchemy effect @effect/platform-node
```

## What it manages

| Resource                 | What                                                                   |
| ------------------------ | ---------------------------------------------------------------------- |
| `FirewallZone`           | Custom zones in the zone-based firewall                                |
| `Network`                | Networks (VLANs), with DHCP and zone membership                        |
| `WifiBroadcast`          | Wi-Fi networks (SSIDs), standard or IoT-optimised                      |
| `TrafficMatchingList`    | Port, IPv4 and IPv6 lists for firewall policies                        |
| `FirewallPolicy`         | Zone-to-zone firewall policies                                         |
| `FirewallPolicyOrdering` | The evaluation order of a zone pair's policies                         |
| `DnsPolicy`              | Local DNS records (A, AAAA, CNAME, MX, SRV, TXT) and forwarded domains |

Zones, networks, Wi-Fi, lists and policies also have `lookup`s for things the stack references but doesn't manage, and `FirewallZone.INTERNAL`, `.EXTERNAL`, `.GATEWAY` and so on name the built-in zones. Existing objects can be adopted with `alchemy deploy --adopt`.

## Use

```ts
import * as UnifiNetwork from "@alchemy-unifi/network";
import * as Alchemy from "alchemy";
import * as Effect from "effect/Effect";

export default Alchemy.Stack(
	"HomeNetwork",
	{ providers: UnifiNetwork.providers(), state: UnifiNetwork.state() },
	Effect.gen(function* () {
		const cameras = yield* UnifiNetwork.FirewallZone("cameras", { name: "Cameras" });
		const cctv = yield* UnifiNetwork.Network("cctv", {
			management: "GATEWAY",
			name: "CCTV",
			vlanId: 30,
			enabled: true,
			cellularBackupEnabled: false,
			internetAccessEnabled: false,
			isolationEnabled: true,
			zone: cameras,
			ipv4Configuration: { autoScaleEnabled: false, hostIpAddress: "192.168.30.1", prefixLength: 24 },
		});
		yield* UnifiNetwork.FirewallPolicy("cameras-to-internal", {
			name: "Block cameras to internal",
			enabled: true,
			action: { type: "BLOCK" },
			source: { zone: cameras },
			destination: { zone: UnifiNetwork.FirewallZone.INTERNAL },
			ipProtocolScope: { ipVersion: "IPV4_AND_IPV6" },
			loggingEnabled: false,
		});
		return { cctv: cctv.networkId };
	}),
);
```

Then `npx alchemy plan` and `npx alchemy deploy`.

## Connecting to a console

Add the `UnifiNetwork` provider to an Alchemy profile:

```sh
npx alchemy profile edit --profile home --add UnifiNetwork
```

It asks how to reach the console:

- **Directly:** the console's URL (e.g. `https://192.168.1.1`) and a Network API key (the Network app's Settings → Integrations). It offers to pin the console's self-signed certificate.
- **Through ui.com:** a Site Manager API key from unifi.ui.com. It lists your consoles to pick from.

Then `npx alchemy profile show --profile home` connects and shows the Network version. In CI, set `UNIFI_URL` (or `UNIFI_CONSOLE_ID`) and `UNIFI_API_KEY` instead.

## State on the console

`UnifiNetwork.state()` keeps the stack's state in a disabled firewall policy on the console it manages, so a stack needs nothing but the console: no S3 bucket or other store. Every run locks the stage with a short-lived traffic-matching list. It suits UniFi-only stacks, and holds up to about 7.5 MiB of compressed state through ui.com or 16 MiB directly. Any other Alchemy state store works too.

## Requirements

- UniFi Network **10.6** (the provider tracks the latest stable release) with the zone-based firewall.
- Node 22 or later, Alchemy 2 (beta) and Effect 4.

## Docs

[github.com/HamishWHC/alchemy-unifi/docs](https://github.com/HamishWHC/alchemy-unifi/tree/main/docs): [connection and auth](https://github.com/HamishWHC/alchemy-unifi/blob/main/docs/connection.md), [resources](https://github.com/HamishWHC/alchemy-unifi/blob/main/docs/resources/README.md), [the state store](https://github.com/HamishWHC/alchemy-unifi/blob/main/docs/state.md). The raw SDK is [`@alchemy-unifi/network-sdk`](https://www.npmjs.com/package/@alchemy-unifi/network-sdk).

## License

MIT
