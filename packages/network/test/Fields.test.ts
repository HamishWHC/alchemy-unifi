import { describe, expect, it } from "vitest";
import * as Redacted from "effect/Redacted";
import { isCurrent, omitKeys } from "../src/internal/Fields.ts";

const observed = {
	name: "Guest",
	vlanId: 12,
	mdnsForwardingEnabled: true,
	ipv4Configuration: { hostIpAddress: "192.168.12.1", dhcpConfiguration: { mode: "SERVER", domainName: "" } },
};

describe("isCurrent", () => {
	it("needs every field to match, recursively, in any key order", () => {
		expect(
			isCurrent(
				{
					ipv4Configuration: {
						dhcpConfiguration: { domainName: "", mode: "SERVER" },
						hostIpAddress: "192.168.12.1",
					},
					mdnsForwardingEnabled: true,
					vlanId: 12,
					name: "Guest",
				},
				observed,
			),
		).toBe(true);
		expect(isCurrent({ ...observed, mdnsForwardingEnabled: false }, observed)).toBe(false);
	});

	it("treats a field the console has but the body lacks as a difference", () => {
		const { mdnsForwardingEnabled: _, ...withoutMdns } = observed;
		expect(isCurrent(withoutMdns, observed)).toBe(false);
	});

	it("treats unset fields as absent", () => {
		expect(isCurrent({ ...observed, dhcpGuarding: undefined }, observed)).toBe(true);
	});

	it("compares redacted values by contents", () => {
		expect(isCurrent({ passphrase: Redacted.make("x") }, { passphrase: "x" })).toBe(true);
		expect(isCurrent({ keys: [{ passphrase: "x" }] }, { keys: [{ passphrase: Redacted.make("y") }] })).toBe(false);
	});
});

describe("omitKeys", () => {
	it("drops the given top-level keys", () => {
		expect(omitKeys({ id: "1", metadata: {}, name: "a" }, ["id", "metadata"])).toEqual({ name: "a" });
	});
});
