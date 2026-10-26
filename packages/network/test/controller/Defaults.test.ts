import { useSite } from "@alchemy-unifi/test-controller/vitest";
import { expect } from "@effect/vitest";
import * as Test from "alchemy/Test/Vitest";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as UnifiNetwork from "../../src/index.ts";
import { unredacted } from "./helpers.ts";

/**
 * Pins the defaults the provider fills in for unset props to what the
 * console itself sets: each resource is created from minimal props, and the
 * console's object must equal those props plus the documented defaults,
 * exactly. A UniFi release that changes a default fails here rather than
 * leaving deployed objects drifting.
 */
useSite("defaults");
const { test } = Test.make({ providers: UnifiNetwork.providers() });
const { INTERNAL, HOTSPOT } = UnifiNetwork.FirewallZone;

const zoneId = (name: string) =>
	UnifiNetwork.FirewallZone.lookup({ name }).pipe(Effect.map((zone) => zone.firewallZoneId));

const gatewayNetwork = {
	management: "GATEWAY",
	name: "Minimal gateway",
	vlanId: 80,
	enabled: true,
	cellularBackupEnabled: false,
	internetAccessEnabled: true,
	isolationEnabled: false,
	ipv4Configuration: { autoScaleEnabled: false, hostIpAddress: "192.168.80.1", prefixLength: 24 },
} as const;

const dhcpServer = {
	mode: "SERVER",
	ipAddressRange: { start: "192.168.81.6", stop: "192.168.81.254" },
	leaseTimeSeconds: 86400,
	pingConflictDetectionEnabled: true,
} as const;

test.provider("networks: mDNS forwarding on, and a DHCP server's blank domain name", (stack) =>
	Effect.gen(function* () {
		const deployed = yield* stack.deploy(
			Effect.gen(function* () {
				return {
					gateway: yield* UnifiNetwork.Network("gateway", { ...gatewayNetwork, zone: INTERNAL }),
					dhcp: yield* UnifiNetwork.Network("dhcp", {
						...gatewayNetwork,
						name: "Minimal DHCP",
						vlanId: 81,
						zone: INTERNAL,
						ipv4Configuration: {
							autoScaleEnabled: false,
							hostIpAddress: "192.168.81.1",
							prefixLength: 24,
							dhcpConfiguration: dhcpServer,
						},
					}),
					unmanaged: yield* UnifiNetwork.Network("unmanaged", {
						management: "UNMANAGED",
						name: "Minimal unmanaged",
						vlanId: 82,
						enabled: true,
					}),
				};
			}),
		);
		const internal = yield* zoneId("Internal");
		expect(deployed.gateway.config).toEqual({ ...gatewayNetwork, zoneId: internal, mdnsForwardingEnabled: true });
		expect(deployed.dhcp.config).toEqual({
			...gatewayNetwork,
			name: "Minimal DHCP",
			vlanId: 81,
			zoneId: internal,
			mdnsForwardingEnabled: true,
			ipv4Configuration: {
				autoScaleEnabled: false,
				hostIpAddress: "192.168.81.1",
				prefixLength: 24,
				dhcpConfiguration: { ...dhcpServer, domainName: "" },
			},
		});
		expect(deployed.unmanaged.config).toEqual({
			management: "UNMANAGED",
			name: "Minimal unmanaged",
			vlanId: 82,
			enabled: true,
		});
	}),
);

const radio = {
	enabled: true,
	hideName: false,
	clientIsolationEnabled: false,
	multicastToUnicastConversionEnabled: false,
	uapsdEnabled: false,
	channel2gLockedTo6: false,
	dtimPeriod2gLockedTo3: false,
} as const;

test.provider("Wi-Fi: band steering off, bands sorted", (stack) =>
	Effect.gen(function* () {
		const deployed = yield* stack.deploy(
			Effect.gen(function* () {
				const lan = yield* UnifiNetwork.Network("lan", {
					...gatewayNetwork,
					vlanId: 83,
					name: "Wi-Fi LAN",
					zone: INTERNAL,
					ipv4Configuration: { ...gatewayNetwork.ipv4Configuration, hostIpAddress: "192.168.83.1" },
				});
				return {
					lan,
					standard: yield* UnifiNetwork.WifiBroadcast("standard", {
						...radio,
						type: "STANDARD",
						name: "Minimal standard",
						advertiseDeviceName: false,
						arpProxyEnabled: false,
						bssTransitionEnabled: true,
						broadcastingFrequenciesGHz: [5, 2.4],
						network: lan,
						securityConfiguration: {
							type: "WPA2_PERSONAL",
							passphrase: Redacted.make("standard-passphrase"),
							fastRoamingEnabled: false,
						},
					}),
					iot: yield* UnifiNetwork.WifiBroadcast("iot", {
						...radio,
						type: "IOT_OPTIMIZED",
						name: "Minimal IoT",
						network: lan,
						securityConfiguration: { type: "WPA2_PERSONAL", passphrase: Redacted.make("iot-passphrase") },
					}),
				};
			}),
		);
		const network = { type: "SPECIFIC", networkId: deployed.lan.networkId };
		expect(unredacted(deployed.standard.config)).toEqual({
			...radio,
			type: "STANDARD",
			name: "Minimal standard",
			advertiseDeviceName: false,
			arpProxyEnabled: false,
			bssTransitionEnabled: true,
			bandSteeringEnabled: false,
			broadcastingFrequenciesGHz: [2.4, 5],
			network,
			securityConfiguration: {
				type: "WPA2_PERSONAL",
				passphrase: "standard-passphrase",
				fastRoamingEnabled: false,
			},
		});
		expect(unredacted(deployed.iot.config)).toEqual({
			...radio,
			type: "IOT_OPTIMIZED",
			name: "Minimal IoT",
			network,
			securityConfiguration: { type: "WPA2_PERSONAL", passphrase: "iot-passphrase" },
		});
	}),
);

test.provider("lists, DNS policies and firewall policies: no defaults", (stack) =>
	Effect.gen(function* () {
		const list = {
			type: "PORTS",
			name: "Minimal list",
			items: [{ type: "PORT_NUMBER", value: 8123 }],
		} satisfies UnifiNetwork.TrafficMatchingListProps;
		const record = {
			type: "A_RECORD",
			enabled: true,
			domain: "minimal.home.arpa",
			ipv4Address: "192.168.80.5",
			ttlSeconds: 300,
		} as const;
		const policy = {
			name: "Minimal policy",
			enabled: true,
			action: { type: "BLOCK" },
			ipProtocolScope: { ipVersion: "IPV4_AND_IPV6" },
			loggingEnabled: false,
		} as const;
		const deployed = yield* stack.deploy(
			Effect.gen(function* () {
				return {
					list: yield* UnifiNetwork.TrafficMatchingList("list", list),
					record: yield* UnifiNetwork.DnsPolicy("record", record),
					policy: yield* UnifiNetwork.FirewallPolicy("policy", {
						...policy,
						source: { zone: HOTSPOT },
						destination: { zone: INTERNAL },
					}),
				};
			}),
		);
		expect(deployed.list.config).toEqual(list);
		expect(deployed.record.config).toEqual(record);
		expect(deployed.policy.config).toEqual({
			...policy,
			source: { zoneId: yield* zoneId("Hotspot") },
			destination: { zoneId: yield* zoneId("Internal") },
		});
	}),
);
