# Getting started

## Install

In an Alchemy project (or a new one: `npm init -y`, then set `"type": "module"`):

```sh
npm install @alchemy-unifi/network alchemy effect @effect/platform-node
```

`alchemy`, `effect` and `@effect/platform-node` are peer dependencies, so your project has one copy of each.

## Connect to your console

Add the `UnifiNetwork` provider to Alchemy's default profile:

```sh
npx alchemy profile edit --add UnifiNetwork
```

Choose **Directly** and give the console's URL (e.g. `https://192.168.1.1`) and a Network API key, which you create in the Network app under Settings → Integrations. Or choose **Through ui.com** and give a Site Manager API key from [unifi.ui.com](https://unifi.ui.com), then pick the console. Check it works:

```sh
npx alchemy profile show
```

This guide uses the default profile throughout. You can create others, for example one per console, or a direct and a ui.com one for the same console, and pick one with `--profile`. See [Connecting to a console](connecting.md).

## Write a stack

`alchemy.run.ts`:

```ts
import * as UnifiNetwork from "@alchemy-unifi/network";
import * as Alchemy from "alchemy";
import * as Effect from "effect/Effect";

export default Alchemy.Stack(
	"HomeNetwork",
	{ providers: UnifiNetwork.providers(), state: UnifiNetwork.state() },
	Effect.gen(function* () {
		const iot = yield* UnifiNetwork.FirewallZone("iot-zone", { name: "IoT" });
		const network = yield* UnifiNetwork.Network("iot", {
			management: "GATEWAY",
			name: "IoT",
			vlanId: 20,
			enabled: true,
			cellularBackupEnabled: false,
			internetAccessEnabled: true,
			isolationEnabled: false,
			zone: iot,
			ipv4Configuration: { autoScaleEnabled: false, hostIpAddress: "192.168.20.1", prefixLength: 24 },
		});
		yield* UnifiNetwork.FirewallPolicy("iot-to-internal", {
			name: "Block IoT to internal",
			enabled: true,
			action: { type: "BLOCK" },
			source: { zone: iot },
			destination: { zone: UnifiNetwork.FirewallZone.INTERNAL },
			ipProtocolScope: { ipVersion: "IPV4_AND_IPV6" },
			loggingEnabled: false,
		});
		return { iotNetworkId: network.networkId };
	}),
);
```

- `UnifiNetwork.providers()` registers the resources and the `UnifiNetwork` auth provider.
- `UnifiNetwork.state()` keeps the stack's state on the console itself ([details](state.md)). Any Alchemy state store works instead, e.g. `Alchemy.localState()` for a file in the project.
- Resources reference each other directly (`zone: iot`), so Alchemy creates them in the right order. See [Concepts](concepts.md).

## Plan and deploy

```sh
npx alchemy plan --stage home
npx alchemy deploy --stage home
```

The stage names this deployment of the stack. Use one stage per site, e.g. `home` and `office`, each with a profile pointing at that site's console.

## Bring an existing setup under management

Most consoles already have networks, Wi-Fi and policies. Declare them as resources with the same names (VLAN IDs for networks), then let Alchemy adopt them instead of creating duplicates:

```sh
npx alchemy plan --stage home --adopt     # check what would be adopted, updated and created
npx alchemy deploy --stage home --adopt
```

Adoption matches each resource by its natural key (see each resource's page), then updates it to match your props. Without `--adopt`, a resource that already exists fails the deploy rather than being taken over silently. The default network (VLAN 1) is adopted the same way: declare a `Network` with `vlanId: 1`.

## Next

- [Concepts](concepts.md): what happens to changes made in the UI, and how lookups work.
- The [resource pages](README.md#resources), each with examples and gotchas.
