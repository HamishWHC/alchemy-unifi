import { describe, expect, it } from "vitest";
import * as Redacted from "effect/Redacted";
import { matches, mergeOver } from "../src/internal/Fields.ts";

const observed = {
	name: "Guest",
	vlanId: 12,
	mdnsForwardingEnabled: true,
	ipv4Configuration: {
		hostIpAddress: "192.168.12.1",
		dhcpConfiguration: { mode: "SERVER", leaseTimeSeconds: 86400, domainName: "" },
	},
	tags: ["a", "b"],
};

describe("matches", () => {
	it("compares only what's set, recursively", () => {
		expect(matches({ name: "Guest", ipv4Configuration: { hostIpAddress: "192.168.12.1" } }, observed)).toBe(true);
		expect(matches({ name: "Guest", mdnsForwardingEnabled: undefined }, observed)).toBe(true);
		expect(matches({ ipv4Configuration: { dhcpConfiguration: { leaseTimeSeconds: 3600 } } }, observed)).toBe(false);
	});

	it("compares arrays element by element, with equal lengths", () => {
		expect(matches({ tags: ["a", "b"] }, observed)).toBe(true);
		expect(matches({ tags: ["a"] }, observed)).toBe(false);
	});

	it("compares redacted values by contents", () => {
		expect(matches({ passphrase: Redacted.make("x") }, { passphrase: "x" })).toBe(true);
		expect(matches({ passphrase: "x" }, { passphrase: Redacted.make("y") })).toBe(false);
	});
});

describe("mergeOver", () => {
	it("keeps observed values for unset fields", () => {
		expect(
			mergeOver(
				{ name: "Guests", ipv4Configuration: { hostIpAddress: "192.168.13.1" }, zoneId: undefined },
				observed,
			),
		).toEqual({
			...observed,
			name: "Guests",
			ipv4Configuration: { ...observed.ipv4Configuration, hostIpAddress: "192.168.13.1" },
		});
	});

	it("replaces arrays and objects of another union variant", () => {
		const relay = { mode: "RELAY", dhcpServerIpAddresses: ["10.0.0.1"] };
		expect(mergeOver({ tags: ["c"], ipv4Configuration: { dhcpConfiguration: relay } }, observed)).toMatchObject({
			tags: ["c"],
			ipv4Configuration: { hostIpAddress: "192.168.12.1", dhcpConfiguration: relay },
		});
	});
});
