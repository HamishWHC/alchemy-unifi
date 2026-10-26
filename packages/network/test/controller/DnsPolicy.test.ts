import * as Sdk from "@alchemy-unifi/network-sdk";
import { useSite } from "@alchemy-unifi/test-controller/vitest";
import { expect } from "@effect/vitest";
import { adopt } from "alchemy/AdoptPolicy";
import * as Test from "alchemy/Test/Vitest";
import * as Effect from "effect/Effect";
import * as UnifiNetwork from "../../src/index.ts";
import { sdk } from "./helpers.ts";

const current = useSite("dns-policy");
const { test } = Test.make({ providers: UnifiNetwork.providers() });

const policy = (props: UnifiNetwork.DnsPolicyProps) =>
	Effect.gen(function* () {
		return { policy: yield* UnifiNetwork.DnsPolicy("policy", props) };
	});

const aRecord = (domain: string, ipv4Address: string) =>
	({ type: "A_RECORD", enabled: true, domain, ipv4Address, ttlSeconds: 300 }) satisfies UnifiNetwork.DnsPolicyProps;

const getPolicy = (dnsPolicyId: string) => sdk(Sdk.getDnsPolicy({ siteId: current().site.id, dnsPolicyId }));

test.provider("creates a record, plans no change, changes its type in place and deletes it", (stack) =>
	Effect.gen(function* () {
		const created = (yield* stack.deploy(policy(aRecord("ha.home.arpa", "192.168.2.20")))).policy;
		expect(created).toMatchObject({ siteId: current().site.id, type: "A_RECORD", domain: "ha.home.arpa" });
		expect((yield* stack.plan(policy(aRecord("ha.home.arpa", "192.168.2.20")))).resources["policy"]?.action).toBe(
			"noop",
		);

		const aaaa = (yield* stack.deploy(
			policy({
				type: "AAAA_RECORD",
				enabled: true,
				domain: "ha.home.arpa",
				ipv6Address: "fd00::20",
				ttlSeconds: 300,
			}),
		)).policy;
		expect(aaaa).toMatchObject({ dnsPolicyId: created.dnsPolicyId, type: "AAAA_RECORD" });
		expect(yield* getPolicy(created.dnsPolicyId)).toMatchObject({ ipv6Address: "fd00::20" });

		yield* stack.destroy();
		expect((yield* getPolicy(created.dnsPolicyId).pipe(Effect.flip))._tag).toBe("NotFound");
	}),
);

test.provider("adopts by type and domain, using the value when a domain has several records", (stack) =>
	Effect.gen(function* () {
		const siteId = current().site.id;
		yield* sdk(Sdk.createDnsPolicy({ siteId, body: aRecord("nas.home.arpa", "192.168.2.30") }));
		const second = yield* sdk(Sdk.createDnsPolicy({ siteId, body: aRecord("nas.home.arpa", "192.168.2.31") }));
		const forward = yield* sdk(
			Sdk.createDnsPolicy({
				siteId,
				body: { type: "FORWARD_DOMAIN", enabled: true, domain: "lab.home.arpa", ipAddress: "192.168.2.53" },
			}),
		);
		const adopted = yield* stack.deploy(
			Effect.gen(function* () {
				return {
					record: yield* UnifiNetwork.DnsPolicy("record", aRecord("nas.home.arpa", "192.168.2.31")),
					// Changed value: still the only forward rule for the domain, so it's adopted and updated.
					forward: yield* UnifiNetwork.DnsPolicy("forward", {
						type: "FORWARD_DOMAIN",
						enabled: true,
						domain: "lab.home.arpa",
						ipAddress: "192.168.2.54",
					}),
				};
			}).pipe(adopt(true)),
		);
		expect(adopted.record.dnsPolicyId).toBe(second.id);
		expect(adopted.forward.dnsPolicyId).toBe(forward.id);
		expect(yield* getPolicy(forward.id)).toMatchObject({ ipAddress: "192.168.2.54" });
	}),
);

test.provider("puts back a record changed in the UI on the next update", (stack) =>
	Effect.gen(function* () {
		const created = (yield* stack.deploy(policy(aRecord("drift.home.arpa", "192.168.2.40")))).policy;
		yield* sdk(
			Sdk.updateDnsPolicy({
				siteId: current().site.id,
				dnsPolicyId: created.dnsPolicyId,
				body: { ...aRecord("drift.home.arpa", "192.168.2.41"), ttlSeconds: 60 },
			}),
		);
		expect(yield* getPolicy(created.dnsPolicyId)).toMatchObject({ ttlSeconds: 60 });
		const repaired = (yield* stack.deploy(
			policy({ ...aRecord("drift.home.arpa", "192.168.2.40"), enabled: false }),
		)).policy;
		expect(repaired.config).toEqual({ ...aRecord("drift.home.arpa", "192.168.2.40"), enabled: false });
	}),
);
