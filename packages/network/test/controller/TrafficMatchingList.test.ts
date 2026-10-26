import * as Sdk from "@alchemy-unifi/network-sdk";
import { useSite } from "@alchemy-unifi/test-controller/vitest";
import { expect } from "@effect/vitest";
import { adopt } from "alchemy/AdoptPolicy";
import * as Test from "alchemy/Test/Vitest";
import * as Effect from "effect/Effect";
import * as UnifiNetwork from "../../src/index.ts";
import { defectOf, sdk } from "./helpers.ts";

const current = useSite("traffic-matching-list");
const { test } = Test.make({ providers: UnifiNetwork.providers() });

const list = (props: UnifiNetwork.TrafficMatchingListProps) =>
	Effect.gen(function* () {
		return { list: yield* UnifiNetwork.TrafficMatchingList("list", props) };
	});

const hosts = (name: string) =>
	({
		type: "IPV4_ADDRESSES",
		name,
		items: [
			{ type: "IP_ADDRESS", value: "192.168.10.5" },
			{ type: "SUBNET", value: "192.168.2.0/24" },
		],
	}) satisfies UnifiNetwork.TrafficMatchingListProps;

const zone = (name: string) =>
	UnifiNetwork.FirewallZone.lookup({ name }).pipe(Effect.map((found) => found.firewallZoneId));

const getList = (trafficMatchingListId: string) =>
	sdk(Sdk.getTrafficMatchingList({ siteId: current().site.id, trafficMatchingListId }));

test.provider("creates a list, plans no change, changes its type in place and deletes it", (stack) =>
	Effect.gen(function* () {
		const created = (yield* stack.deploy(list(hosts("Hosts")))).list;
		expect(created).toMatchObject({ siteId: current().site.id, name: "Hosts", type: "IPV4_ADDRESSES" });
		expect((yield* stack.plan(list(hosts("Hosts")))).resources["list"]?.action).toBe("noop");

		const ports = (yield* stack.deploy(
			list({ type: "PORTS", name: "Hosts", items: [{ type: "PORT_NUMBER_RANGE", start: 8008, stop: 8009 }] }),
		)).list;
		expect(ports).toMatchObject({ trafficMatchingListId: created.trafficMatchingListId, type: "PORTS" });
		expect((yield* getList(created.trafficMatchingListId)).items).toEqual([
			{ type: "PORT_NUMBER_RANGE", start: 8008, stop: 8009 },
		]);

		yield* stack.destroy();
		expect((yield* getList(created.trafficMatchingListId).pipe(Effect.flip))._tag).toBe("NotFound");
	}),
);

test.provider("adopts an existing list by name only when asked to, and looks it up", (stack) =>
	Effect.gen(function* () {
		const existing = yield* sdk(
			Sdk.createTrafficMatchingList({ siteId: current().site.id, body: hosts("Pre-existing") }),
		);
		expect((yield* UnifiNetwork.TrafficMatchingList.lookup({ name: "Pre-existing" })).trafficMatchingListId).toBe(
			existing.id,
		);
		expect(String(yield* stack.deploy(list(hosts("Pre-existing"))).pipe(Effect.flip))).toContain("adopt");
		const adopted = (yield* stack.deploy(list(hosts("Pre-existing")).pipe(adopt(true)))).list;
		expect(adopted.trafficMatchingListId).toBe(existing.id);
		expect(yield* defectOf(UnifiNetwork.TrafficMatchingList.lookup({ name: "Nope" }))).toBeInstanceOf(
			UnifiNetwork.LookupNotFound,
		);
	}),
);

test.provider("explains a delete blocked by a policy outside the stack", (stack) =>
	Effect.gen(function* () {
		const siteId = current().site.id;
		const created = (yield* stack.deploy(list(hosts("In use")))).list;
		const fromUi = yield* sdk(
			Sdk.createFirewallPolicy({
				siteId,
				name: "Made in the UI",
				// Only enabled policies hold a list: deleting it under a disabled one succeeds.
				enabled: true,
				action: { type: "BLOCK" },
				source: { zoneId: yield* zone("Hotspot") },
				destination: {
					zoneId: yield* zone("Internal"),
					trafficFilter: {
						type: "IP_ADDRESS",
						ipAddressFilter: {
							type: "TRAFFIC_MATCHING_LIST",
							matchOpposite: false,
							trafficMatchingListId: created.trafficMatchingListId,
						},
					},
				},
				ipProtocolScope: { ipVersion: "IPV4_AND_IPV6" },
				loggingEnabled: false,
			}),
		);
		const refused = yield* stack.destroy().pipe(Effect.flip);
		expect(String(refused)).toContain('referenced by firewall policies "Made in the UI"');
		yield* sdk(Sdk.deleteFirewallPolicy({ siteId, firewallPolicyId: fromUi.id }));
	}),
);

test.provider("puts back items changed in the UI on the next update", (stack) =>
	Effect.gen(function* () {
		const siteId = current().site.id;
		const created = (yield* stack.deploy(list(hosts("Drifting")))).list;
		yield* sdk(
			Sdk.updateTrafficMatchingList({
				siteId,
				trafficMatchingListId: created.trafficMatchingListId,
				body: { type: "IPV4_ADDRESSES", name: "Drifting", items: [{ type: "IP_ADDRESS", value: "10.0.0.1" }] },
			}),
		);
		// What `alchemy drift` compares: the attributes `read` builds now differ from the deployed ones.
		expect((yield* UnifiNetwork.TrafficMatchingList.lookup({ name: "Drifting" })).config).not.toEqual(
			created.config,
		);
		const repaired = (yield* stack.deploy(list(hosts("Drifted")))).list;
		expect(repaired.config).toEqual({ ...hosts("Drifted") });
	}),
);
