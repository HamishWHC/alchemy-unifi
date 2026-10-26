import { describe, expect, it } from "@effect/vitest";
import * as Alchemy from "alchemy";
import * as State from "alchemy/State";
import * as Effect from "effect/Effect";
import * as UnifiNetwork from "../src/index.ts";

// Type-level check: a stack body may use lookups, resources and references
// together. Alchemy only lets stack bodies require stack and provider
// services, so this fails to compile if a lookup needs anything else.
const stack = Alchemy.Stack(
	"TypeCheck",
	{ providers: UnifiNetwork.providers(), state: State.localState() },
	Effect.gen(function* () {
		const iot = yield* UnifiNetwork.FirewallZone.lookup({ name: "IoT" });
		const cameras = yield* UnifiNetwork.FirewallZone("cameras", { name: "Cameras" });
		const lan = yield* UnifiNetwork.Network.lookup({ vlanId: 1 });
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
		return { iot: iot.firewallZoneId, lan: lan.networkId, cctv: cctv.networkId };
	}),
);

describe("stacks", () => {
	it("accept UniFi resources and lookups", () => {
		expect(stack).toBeDefined();
	});
});
