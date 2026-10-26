import * as Sdk from "@alchemy-unifi/network-sdk";
import { useSite } from "@alchemy-unifi/test-controller/vitest";
import { expect } from "@effect/vitest";
import { adopt } from "alchemy/AdoptPolicy";
import * as Test from "alchemy/Test/Vitest";
import * as Effect from "effect/Effect";
import * as UnifiNetwork from "../../src/index.ts";
import { defectOf, sdk } from "./helpers.ts";

const current = useSite("firewall-zone");
const { test } = Test.make({ providers: UnifiNetwork.providers() });

const zone = (name: string) =>
	Effect.gen(function* () {
		return { zone: yield* UnifiNetwork.FirewallZone("zone", { name }) };
	});

const getZone = (firewallZoneId: string) => sdk(Sdk.getFirewallZone({ siteId: current().site.id, firewallZoneId }));

test.provider("creates, plans no change, renames and deletes a zone", (stack) =>
	Effect.gen(function* () {
		const created = (yield* stack.deploy(zone("Cameras"))).zone;
		expect(created).toMatchObject({ siteId: current().site.id, name: "Cameras" });
		expect((yield* getZone(created.firewallZoneId)).name).toBe("Cameras");

		const plan = yield* stack.plan(zone("Cameras"));
		expect(plan.resources["zone"]?.action).toBe("noop");

		const renamed = (yield* stack.deploy(zone("CCTV"))).zone;
		expect(renamed.firewallZoneId).toBe(created.firewallZoneId);
		expect((yield* getZone(created.firewallZoneId)).name).toBe("CCTV");

		yield* stack.destroy();
		expect((yield* getZone(created.firewallZoneId).pipe(Effect.flip))._tag).toBe("NotFound");
	}),
);

test.provider("keeps member networks when renamed, and recreates a zone deleted behind its back", (stack) =>
	Effect.gen(function* () {
		const siteId = current().site.id;
		const created = (yield* stack.deploy(zone("Members"))).zone;
		const network = yield* sdk(
			Sdk.createNetwork({
				siteId,
				body: {
					management: "GATEWAY",
					name: "Zone member",
					vlanId: 40,
					enabled: true,
					cellularBackupEnabled: false,
					internetAccessEnabled: true,
					isolationEnabled: false,
					zoneId: created.firewallZoneId,
					ipv4Configuration: { autoScaleEnabled: false, hostIpAddress: "192.168.40.1", prefixLength: 24 },
				},
			}),
		);
		yield* stack.deploy(zone("Members renamed"));
		expect((yield* getZone(created.firewallZoneId)).networkIds).toEqual([network.id]);

		yield* sdk(Sdk.deleteFirewallZone({ siteId, firewallZoneId: created.firewallZoneId }));
		const recreated = (yield* stack.deploy(zone("Members again"))).zone;
		expect(recreated.firewallZoneId).not.toBe(created.firewallZoneId);
		expect((yield* getZone(recreated.firewallZoneId)).name).toBe("Members again");
	}),
);

test.provider("adopts an existing zone by name only when asked to", (stack) =>
	Effect.gen(function* () {
		const existing = yield* sdk(
			Sdk.createFirewallZone({ siteId: current().site.id, name: "Pre-existing", networkIds: [] }),
		);
		const refused = yield* stack.deploy(zone("Pre-existing")).pipe(Effect.flip);
		expect(String(refused)).toContain("adopt");
		const adopted = (yield* stack.deploy(zone("Pre-existing").pipe(adopt(true)))).zone;
		expect(adopted.firewallZoneId).toBe(existing.id);
	}),
);

test.provider("looks up built-in and custom zones by name", () =>
	Effect.gen(function* () {
		const siteId = current().site.id;
		const zones = yield* sdk(Sdk.getFirewallZones({ siteId }));
		const internal = zones.data.find((z) => z.name === "Internal");
		expect(yield* UnifiNetwork.FirewallZone.lookup({ name: "Internal" })).toEqual({
			siteId,
			firewallZoneId: internal?.id,
			name: "Internal",
		});
		const missing = yield* defectOf(UnifiNetwork.FirewallZone.lookup({ name: "Nope" }));
		expect(missing).toBeInstanceOf(UnifiNetwork.LookupNotFound);
	}),
);
