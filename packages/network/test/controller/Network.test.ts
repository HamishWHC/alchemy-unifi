import * as Sdk from "@alchemy-unifi/network-sdk";
import { useSite } from "@alchemy-unifi/test-controller/vitest";
import { expect } from "@effect/vitest";
import { adopt } from "alchemy/AdoptPolicy";
import * as Test from "alchemy/Test/Vitest";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as UnifiNetwork from "../../src/index.ts";
import { defectOf, sdk } from "./helpers.ts";

const current = useSite("network");
const { test } = Test.make({ providers: UnifiNetwork.providers() });

const getNetwork = (networkId: string) => sdk(Sdk.getNetworkDetails({ siteId: current().site.id, networkId }));

const gateway = (vlanId: number, overrides: Partial<UnifiNetwork.GatewayNetworkProps> = {}) =>
	({
		management: "GATEWAY",
		name: `VLAN ${vlanId}`,
		vlanId,
		enabled: true,
		cellularBackupEnabled: false,
		internetAccessEnabled: true,
		isolationEnabled: false,
		zone: UnifiNetwork.FirewallZone.INTERNAL,
		ipv4Configuration: {
			autoScaleEnabled: false,
			hostIpAddress: `192.168.${vlanId}.1`,
			prefixLength: 24,
			dhcpConfiguration: {
				mode: "SERVER",
				ipAddressRange: { start: `192.168.${vlanId}.10`, stop: `192.168.${vlanId}.200` },
				leaseTimeSeconds: 86400,
				pingConflictDetectionEnabled: true,
			},
		},
		...overrides,
	}) satisfies UnifiNetwork.GatewayNetworkProps;

const network = (props: UnifiNetwork.NetworkProps) =>
	Effect.gen(function* () {
		return { network: yield* UnifiNetwork.Network("network", props) };
	});

test.provider("creates a gateway network in a built-in zone, then plans no change", (stack) =>
	Effect.gen(function* () {
		const siteId = current().site.id;
		const created = (yield* stack.deploy(network(gateway(50)))).network;
		const internal = yield* UnifiNetwork.FirewallZone.lookup({ name: "Internal" });
		expect(created).toMatchObject({ siteId, name: "VLAN 50", vlanId: 50, management: "GATEWAY", default: false });
		expect(created.zoneId).toBe(internal.firewallZoneId);
		expect(yield* getNetwork(created.networkId)).toMatchObject({
			ipv4Configuration: { dhcpConfiguration: { ipAddressRange: { start: "192.168.50.10" } } },
		});
		expect((yield* stack.plan(network(gateway(50)))).resources["network"]?.action).toBe("noop");

		yield* stack.destroy();
		expect((yield* getNetwork(created.networkId).pipe(Effect.flip))._tag).toBe("NotFound");
	}),
);

/** A zone and a network, optionally in that zone. */
const zoneAndNetwork = (zoned: boolean) =>
	Effect.gen(function* () {
		const zone = yield* UnifiNetwork.FirewallZone("zone", { name: "Lab" });
		const net = yield* UnifiNetwork.Network("network", { ...gateway(51), ...(zoned ? { zone } : {}) });
		return { zone, network: net };
	});

test.provider("moves a network into a zone from the same stack", (stack) =>
	Effect.gen(function* () {
		const before = yield* stack.deploy(zoneAndNetwork(false));
		expect(before.network.zoneId).not.toBe(before.zone.firewallZoneId);
		const after = yield* stack.deploy(zoneAndNetwork(true));
		expect(after.network.networkId).toBe(before.network.networkId);
		expect(after.network.zoneId).toBe(after.zone.firewallZoneId);
	}),
);

test.provider("puts back UI changes on the next update, including to fields props leave unset", (stack) =>
	Effect.gen(function* () {
		const siteId = current().site.id;
		const created = (yield* stack.deploy(network(gateway(52)))).network;
		expect(created.config).toMatchObject({ mdnsForwardingEnabled: true, isolationEnabled: false });
		// Behind the provider's back: one field props set, one they leave to the default.
		const live = yield* getNetwork(created.networkId);
		if (live.management !== "GATEWAY") throw new Error("expected a gateway network");
		const { id: _id, metadata: _metadata, default: _default, ...body } = live;
		yield* sdk(
			Sdk.updateNetwork({
				siteId,
				networkId: created.networkId,
				body: { ...body, isolationEnabled: true, mdnsForwardingEnabled: false },
			}),
		);
		// What `alchemy drift` compares: the attributes `read` builds now differ from the deployed ones.
		const observed = yield* UnifiNetwork.Network.lookup({ vlanId: 52 });
		expect(observed.config).not.toEqual(created.config);

		const repaired = (yield* stack.deploy(network(gateway(52, { name: "Renamed" })))).network;
		expect(yield* getNetwork(created.networkId)).toMatchObject({
			name: "Renamed",
			isolationEnabled: false,
			mdnsForwardingEnabled: true,
		});
		expect((yield* UnifiNetwork.Network.lookup({ vlanId: 52 })).config).toEqual(repaired.config);
	}),
);

test.provider("replaces a network whose management changes, deleting the old one first", (stack) =>
	Effect.gen(function* () {
		const before = (yield* stack.deploy(network(gateway(53)))).network;
		const after = (yield* stack.deploy(
			network({ management: "UNMANAGED", name: "VLAN 53", vlanId: 53, enabled: true }),
		)).network;
		expect(after).toMatchObject({ management: "UNMANAGED", vlanId: 53 });
		expect(after.networkId).not.toBe(before.networkId);
		expect((yield* getNetwork(before.networkId).pipe(Effect.flip))._tag).toBe("NotFound");
	}),
);

test.provider("recreates a network deleted behind its back", (stack) =>
	Effect.gen(function* () {
		const created = (yield* stack.deploy(network(gateway(54)))).network;
		yield* sdk(Sdk.deleteNetwork({ siteId: current().site.id, networkId: created.networkId }));
		const recreated = (yield* stack.deploy(network(gateway(54, { name: "Back again" })))).network;
		expect(recreated.networkId).not.toBe(created.networkId);
		expect((yield* getNetwork(recreated.networkId)).name).toBe("Back again");
	}),
);

test.provider("adopts the default network by VLAN ID and renames it, never replaces or deletes it", (stack) =>
	Effect.gen(function* () {
		const existing = yield* UnifiNetwork.Network.lookup({ vlanId: 1 });
		const live = yield* getNetwork(existing.networkId);
		if (live.management !== "GATEWAY") throw new Error("the default network should be gateway-managed");
		const management = {
			management: "GATEWAY",
			name: "Management",
			vlanId: 1,
			enabled: true,
			cellularBackupEnabled: live.cellularBackupEnabled,
			internetAccessEnabled: live.internetAccessEnabled,
			isolationEnabled: false,
			zone: UnifiNetwork.FirewallZone.INTERNAL,
			ipv4Configuration: live.ipv4Configuration,
		} satisfies UnifiNetwork.GatewayNetworkProps;
		const adopted = (yield* stack.deploy(network(management).pipe(adopt(true)))).network;
		expect(adopted).toMatchObject({ networkId: existing.networkId, name: "Management", default: true });
		expect((yield* getNetwork(existing.networkId)).name).toBe("Management");

		const refused = yield* stack
			.plan(network({ management: "UNMANAGED", name: "Management", vlanId: 1, enabled: true }))
			.pipe(Effect.flip);
		expect(String(refused)).toContain("can't be replaced");

		// An SSID referencing the default network is sent as NATIVE, the only form the console accepts.
		const withWifi = yield* stack.deploy(
			Effect.gen(function* () {
				const lan = yield* UnifiNetwork.Network("network", management);
				const wifi = yield* UnifiNetwork.WifiBroadcast("wifi", {
					type: "STANDARD",
					name: "On the default network",
					enabled: true,
					hideName: false,
					clientIsolationEnabled: false,
					multicastToUnicastConversionEnabled: false,
					uapsdEnabled: false,
					channel2gLockedTo6: false,
					dtimPeriod2gLockedTo3: false,
					advertiseDeviceName: false,
					arpProxyEnabled: false,
					bssTransitionEnabled: true,
					broadcastingFrequenciesGHz: [2.4, 5],
					securityConfiguration: {
						type: "WPA2_PERSONAL",
						passphrase: Redacted.make("correct-horse-battery"),
						fastRoamingEnabled: false,
					},
					network: lan,
				});
				return { wifi };
			}),
		);
		const broadcast = yield* sdk(
			Sdk.getWifiBroadcastDetails({ siteId: current().site.id, wifiBroadcastId: withWifi.wifi.wifiBroadcastId }),
		);
		expect(broadcast.network).toEqual({ type: "NATIVE" });

		yield* stack.destroy();
		expect((yield* getNetwork(existing.networkId)).name).toBe("Management");
	}),
);

test.provider("looks networks up by VLAN ID or name", () =>
	Effect.gen(function* () {
		const byVlan = yield* UnifiNetwork.Network.lookup({ vlanId: 1 });
		expect(byVlan).toMatchObject({ siteId: current().site.id, vlanId: 1, default: true });
		expect(yield* UnifiNetwork.Network.lookup({ name: byVlan.name })).toEqual(byVlan);
		expect(yield* defectOf(UnifiNetwork.Network.lookup({ vlanId: 4000 }))).toBeInstanceOf(
			UnifiNetwork.LookupNotFound,
		);
	}),
);
