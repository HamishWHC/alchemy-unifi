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
