import * as Sdk from "@alchemy-unifi/network-sdk";
import { useSite } from "@alchemy-unifi/test-controller/vitest";
import { expect } from "@effect/vitest";
import { adopt } from "alchemy/AdoptPolicy";
import * as Test from "alchemy/Test/Vitest";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as UnifiNetwork from "../../src/index.ts";
import { sdk } from "./helpers.ts";

const current = useSite("wifi");
const { test } = Test.make({ providers: UnifiNetwork.providers() });

const getBroadcast = (wifiBroadcastId: string) =>
	sdk(Sdk.getWifiBroadcastDetails({ siteId: current().site.id, wifiBroadcastId }));

const passphraseOf = (broadcast: Sdk.WifiBroadcastDetails) => {
	const security = broadcast.securityConfiguration;
	const passphrase = "passphrase" in security ? security.passphrase : undefined;
	return Redacted.isRedacted(passphrase) ? Redacted.value(passphrase) : passphrase;
};

const standard = (name: string, passphrase: string) =>
	({
		type: "STANDARD",
		name,
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
			passphrase: Redacted.make(passphrase),
			fastRoamingEnabled: false,
		},
	}) satisfies UnifiNetwork.StandardWifiBroadcastProps;

/** A network and a broadcast on it. */
const wifi = (props: UnifiNetwork.WifiBroadcastProps) =>
	Effect.gen(function* () {
		const network = yield* UnifiNetwork.Network("network", {
			management: "UNMANAGED",
			name: "Wi-Fi clients",
			vlanId: 60,
			enabled: true,
		});
		return { network, wifi: yield* UnifiNetwork.WifiBroadcast("wifi", { ...props, network }) };
	});

test.provider("creates a broadcast on a network from the same stack, then plans no change", (stack) =>
	Effect.gen(function* () {
		const created = yield* stack.deploy(wifi(standard("Probe", "correct-horse-battery")));
		expect(created.wifi).toMatchObject({
			siteId: current().site.id,
			name: "Probe",
			type: "STANDARD",
			networkId: created.network.networkId,
		});
		expect(passphraseOf(yield* getBroadcast(created.wifi.wifiBroadcastId))).toBe("correct-horse-battery");
		expect((yield* stack.plan(wifi(standard("Probe", "correct-horse-battery")))).resources["wifi"]?.action).toBe(
			"noop",
		);

		yield* stack.destroy();
		expect((yield* getBroadcast(created.wifi.wifiBroadcastId).pipe(Effect.flip))._tag).toBe("NotFound");
	}),
);

test.provider("puts back a passphrase changed in the UI on the next update", (stack) =>
	Effect.gen(function* () {
		const created = (yield* stack.deploy(wifi(standard("Drift", "first-passphrase")))).wifi;
		const live = yield* getBroadcast(created.wifiBroadcastId);
		if (live.type !== "STANDARD") throw new Error("expected a standard broadcast");
		const { id: _id, metadata: _metadata, ...body } = live;
		yield* sdk(
			Sdk.updateWifiBroadcast({
				siteId: current().site.id,
				wifiBroadcastId: created.wifiBroadcastId,
				body: {
					...body,
					securityConfiguration: {
						type: "WPA2_PERSONAL",
						passphrase: "changed-in-the-ui",
						fastRoamingEnabled: false,
					},
				},
			}),
		);
		yield* stack.deploy(wifi({ ...standard("Drift", "first-passphrase"), hideName: true }));
		const repaired = yield* getBroadcast(created.wifiBroadcastId);
		expect(passphraseOf(repaired)).toBe("first-passphrase");
		expect(repaired.hideName).toBe(true);
	}),
);

test.provider("replaces a broadcast whose type changes", (stack) =>
	Effect.gen(function* () {
		const before = (yield* stack.deploy(wifi(standard("Things", "iot-passphrase")))).wifi;
		const after = (yield* stack.deploy(
			wifi({
				type: "IOT_OPTIMIZED",
				name: "Things",
				enabled: true,
				hideName: false,
				clientIsolationEnabled: false,
				multicastToUnicastConversionEnabled: false,
				uapsdEnabled: false,
				channel2gLockedTo6: false,
				dtimPeriod2gLockedTo3: false,
				securityConfiguration: { type: "WPA2_PERSONAL", passphrase: Redacted.make("iot-passphrase") },
			}),
		)).wifi;
		expect(after).toMatchObject({ type: "IOT_OPTIMIZED", name: "Things" });
		expect(after.wifiBroadcastId).not.toBe(before.wifiBroadcastId);
		expect((yield* getBroadcast(before.wifiBroadcastId).pipe(Effect.flip))._tag).toBe("NotFound");
	}),
);

test.provider("adopts an existing broadcast by name with --adopt, and looks it up", (stack) =>
	Effect.gen(function* () {
		const existing = yield* sdk(
			Sdk.createWifiBroadcast({
				siteId: current().site.id,
				body: { ...standard("Existing", "existing-passphrase"), network: { type: "NATIVE" } },
			}),
		);
		expect((yield* UnifiNetwork.WifiBroadcast.lookup({ name: "Existing" })).wifiBroadcastId).toBe(existing.id);
		const adopted = yield* stack.deploy(
			Effect.gen(function* () {
				return {
					wifi: yield* UnifiNetwork.WifiBroadcast("wifi", {
						...standard("Existing", "existing-passphrase"),
						network: UnifiNetwork.WifiBroadcast.NATIVE_NETWORK,
					}).pipe(adopt(true)),
				};
			}),
		);
		expect(adopted.wifi).toMatchObject({ wifiBroadcastId: existing.id, networkId: undefined });
	}),
);
