import * as Sdk from "@alchemy-unifi/network-sdk";
import { useSite } from "@alchemy-unifi/test-controller/vitest";
import { expect } from "@effect/vitest";
import { adopt } from "alchemy/AdoptPolicy";
import * as Test from "alchemy/Test/Vitest";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as UnifiNetwork from "../../src/index.ts";
import { defectOf, sdk } from "./helpers.ts";

const current = useSite("firewall-policy");
const { test } = Test.make({ providers: UnifiNetwork.providers() });
const { INTERNAL, HOTSPOT, DMZ } = UnifiNetwork.FirewallZone;

const block = (name: string, overrides: Partial<UnifiNetwork.FirewallPolicyProps> = {}) =>
	({
		name,
		enabled: true,
		action: { type: "BLOCK" },
		source: { zone: HOTSPOT },
		destination: { zone: INTERNAL },
		ipProtocolScope: { ipVersion: "IPV4_AND_IPV6" },
		loggingEnabled: false,
		...overrides,
	}) satisfies UnifiNetwork.FirewallPolicyProps;

const policy = (props: UnifiNetwork.FirewallPolicyProps) =>
	Effect.gen(function* () {
		return { policy: yield* UnifiNetwork.FirewallPolicy("policy", props) };
	});

const getPolicy = (firewallPolicyId: string) =>
	sdk(Sdk.getFirewallPolicy({ siteId: current().site.id, firewallPolicyId }));

const zoneId = (name: string) =>
	UnifiNetwork.FirewallZone.lookup({ name }).pipe(Effect.map((zone) => zone.firewallZoneId));

/** A list, a network and a policy filtering on both. */
const filtered = (withFilter: boolean) =>
	Effect.gen(function* () {
		const hosts = yield* UnifiNetwork.TrafficMatchingList("hosts", {
			type: "IPV4_ADDRESSES",
			name: "Hosts",
			items: [{ type: "IP_ADDRESS", value: "192.168.10.5" }],
		});
		// Network filters need gateway networks: the console fails with a 500 on unmanaged ones.
		const guests = yield* UnifiNetwork.Network("guests", {
			management: "GATEWAY",
			name: "Guests",
			vlanId: 70,
			enabled: true,
			cellularBackupEnabled: false,
			internetAccessEnabled: true,
			isolationEnabled: false,
			zone: HOTSPOT,
			ipv4Configuration: { autoScaleEnabled: false, hostIpAddress: "192.168.70.1", prefixLength: 24 },
		});
		const filteredPolicy = yield* UnifiNetwork.FirewallPolicy("policy", {
			name: "Filtered",
			enabled: true,
			action: { type: "BLOCK" },
			source: {
				zone: HOTSPOT,
				trafficFilter: { type: "NETWORK", networkFilter: { matchOpposite: false, networks: [guests] } },
			},
			destination: {
				zone: INTERNAL,
				...(withFilter
					? {
							trafficFilter: {
								type: "IP_ADDRESS",
								ipAddressFilter: {
									type: "TRAFFIC_MATCHING_LIST",
									matchOpposite: false,
									trafficMatchingList: hosts,
								},
								portFilter: {
									type: "PORTS",
									matchOpposite: false,
									items: [{ type: "PORT_NUMBER", value: 8123 }],
								},
							},
						}
					: {}),
			},
			ipProtocolScope: { ipVersion: "IPV4_AND_IPV6" },
			loggingEnabled: false,
		});
		return { hosts, guests, policy: filteredPolicy };
	});

test.provider("creates a policy with list and network references, plans no change and deletes it", (stack) =>
	Effect.gen(function* () {
		const created = yield* stack.deploy(filtered(true));
		const live = yield* getPolicy(created.policy.firewallPolicyId);
		expect(live).toMatchObject({
			name: "Filtered",
			source: {
				zoneId: yield* zoneId("Hotspot"),
				trafficFilter: { networkFilter: { networkIds: [created.guests.networkId] } },
			},
			destination: {
				zoneId: yield* zoneId("Internal"),
				trafficFilter: {
					ipAddressFilter: { trafficMatchingListId: created.hosts.trafficMatchingListId },
					portFilter: { items: [{ type: "PORT_NUMBER", value: 8123 }] },
				},
			},
		});
		expect((yield* stack.plan(filtered(true))).resources["policy"]?.action).toBe("noop");

		yield* stack.destroy();
		expect((yield* getPolicy(created.policy.firewallPolicyId).pipe(Effect.flip))._tag).toBe("NotFound");
	}),
);

test.provider("removes criteria left out of props, and moves zones in place", (stack) =>
	Effect.gen(function* () {
		const created = (yield* stack.deploy(filtered(true))).policy;
		yield* stack.deploy(filtered(false));
		expect((yield* getPolicy(created.firewallPolicyId)).destination.trafficFilter).toBeUndefined();

		const moved = (yield* stack.deploy(policy(block("Filtered", { destination: { zone: DMZ } })))).policy;
		expect(moved).toMatchObject({
			firewallPolicyId: created.firewallPolicyId,
			destinationFirewallZoneId: yield* zoneId("Dmz"),
		});
		expect((yield* getPolicy(created.firewallPolicyId)).source.trafficFilter).toBeUndefined();
	}),
);

test.provider("puts back a policy changed in the UI on the next update", (stack) =>
	Effect.gen(function* () {
		const siteId = current().site.id;
		const created = (yield* stack.deploy(policy(block("Drifted")))).policy;
		const { id, metadata: _metadata, index: _index, ...body } = yield* getPolicy(created.firewallPolicyId);
		yield* sdk(
			Sdk.updateFirewallPolicy({
				...body,
				siteId,
				firewallPolicyId: id,
				connectionStateFilter: ["NEW"],
				description: "kept",
			}),
		);
		yield* stack.deploy(policy(block("Drifted", { loggingEnabled: true })));
		const repaired = yield* getPolicy(created.firewallPolicyId);
		expect(repaired.loggingEnabled).toBe(true);
		expect(repaired.connectionStateFilter).toBeUndefined();
		expect(repaired.description).toBeUndefined();
		expect(
			(yield* stack.plan(policy(block("Drifted", { loggingEnabled: true })))).resources["policy"]?.action,
		).toBe("noop");
	}),
);

test.provider("adopts by name and zone pair, never a duplicate name or a derived policy", (stack) =>
	Effect.gen(function* () {
		const siteId = current().site.id;
		const create = (name: string) =>
			Effect.gen(function* () {
				return yield* sdk(
					Sdk.createFirewallPolicy({
						siteId,
						name,
						enabled: true,
						action: { type: "BLOCK" },
						source: { zoneId: yield* zoneId("Hotspot") },
						destination: { zoneId: yield* zoneId("Internal") },
						ipProtocolScope: { ipVersion: "IPV4_AND_IPV6" },
						loggingEnabled: false,
					}),
				);
			});
		const single = yield* create("Single");
		yield* create("Twice");
		yield* create("Twice");
		const deployed = yield* stack.deploy(
			Effect.gen(function* () {
				return {
					single: yield* UnifiNetwork.FirewallPolicy("single", block("Single")),
					twice: yield* UnifiNetwork.FirewallPolicy("twice", block("Twice")),
				};
			}).pipe(adopt(true)),
		);
		expect(deployed.single.firewallPolicyId).toBe(single.id);
		const twice = (yield* sdk(Stream.runCollect(Sdk.getFirewallPolicies.items({ siteId })))).filter(
			(p) => p.name === "Twice",
		);
		expect(twice).toHaveLength(3);
		expect(yield* defectOf(UnifiNetwork.FirewallPolicy.lookup({ name: "Twice" }))).toBeInstanceOf(
			UnifiNetwork.LookupAmbiguous,
		);

		// Fresh sites have derived policies (Internal -> Gateway); the provider never lists them.
		const all = yield* sdk(Stream.runCollect(Sdk.getFirewallPolicies.items({ siteId })));
		expect(all.some((p) => p.metadata.origin === "DERIVED")).toBe(true);
		const listed = yield* UnifiNetwork.FirewallPolicy.lookup({ name: "Single" });
		expect(listed.firewallPolicyId).toBe(single.id);
	}),
);
