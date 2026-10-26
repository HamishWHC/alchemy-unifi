import * as Sdk from "@alchemy-unifi/network-sdk";
import { useSite } from "@alchemy-unifi/test-controller/vitest";
import { expect } from "@effect/vitest";
import * as Test from "alchemy/Test/Vitest";
import * as Effect from "effect/Effect";
import * as UnifiNetwork from "../../src/index.ts";
import { sdk } from "./helpers.ts";

const current = useSite("firewall-policy-ordering");
const { test } = Test.make({ providers: UnifiNetwork.providers() });
const { INTERNAL, HOTSPOT, DMZ } = UnifiNetwork.FirewallZone;

const block = (name: string, destination: UnifiNetwork.FirewallZoneReference = INTERNAL) =>
	({
		name,
		enabled: true,
		action: { type: "BLOCK" },
		source: { zone: HOTSPOT },
		destination: { zone: destination },
		ipProtocolScope: { ipVersion: "IPV4_AND_IPV6" },
		loggingEnabled: false,
	}) satisfies UnifiNetwork.FirewallPolicyProps;

const zone = (name: string) =>
	UnifiNetwork.FirewallZone.lookup({ name }).pipe(Effect.map((found) => found.firewallZoneId));

type Bucket = "before" | "after";

/** Policies A and B from Hotspot to Internal, ordered as `order` says (by name and bucket). */
const ordered = (
	order: ReadonlyArray<readonly [name: "A" | "B", bucket: Bucket]>,
	options: { readonly exclusive?: boolean } = {},
) =>
	Effect.gen(function* () {
		const policies = {
			A: yield* UnifiNetwork.FirewallPolicy("a", block("A")),
			B: yield* UnifiNetwork.FirewallPolicy("b", block("B")),
		};
		const pick = (bucket: Bucket) => order.filter(([, b]) => b === bucket).map(([name]) => policies[name]);
		const ordering = yield* UnifiNetwork.FirewallPolicyOrdering("ordering", {
			source: HOTSPOT,
			destination: INTERNAL,
			beforeSystemDefined: pick("before"),
			afterSystemDefined: pick("after"),
			...options,
		});
		return { ...policies, ordering };
	});

const liveOrder = Effect.gen(function* () {
	const site = current().site;
	const ordering = yield* sdk(
		Sdk.getFirewallPolicyOrdering({
			siteId: site.id,
			sourceFirewallZoneId: yield* zone("Hotspot"),
			destinationFirewallZoneId: yield* zone("Internal"),
		}),
	);
	return ordering.orderedFirewallPolicyIds;
});

test.provider(
	"orders policies, reorders them, moves one after the system-defined ones, then plans no change",
	(stack) =>
		Effect.gen(function* () {
			const first = yield* stack.deploy(
				ordered([
					["B", "before"],
					["A", "before"],
				]),
			);
			const { A, B } = { A: first.A.firewallPolicyId, B: first.B.firewallPolicyId };
			expect(yield* liveOrder).toEqual({ beforeSystemDefined: [B, A], afterSystemDefined: [] });

			yield* stack.deploy(
				ordered([
					["A", "before"],
					["B", "before"],
				]),
			);
			expect(yield* liveOrder).toEqual({ beforeSystemDefined: [A, B], afterSystemDefined: [] });

			const moved = yield* stack.deploy(
				ordered([
					["A", "before"],
					["B", "after"],
				]),
			);
			expect(yield* liveOrder).toEqual({ beforeSystemDefined: [A], afterSystemDefined: [B] });
			expect(moved.ordering).toMatchObject({ beforeSystemDefined: [A], afterSystemDefined: [B] });
			expect(
				(yield* stack.plan(
					ordered([
						["A", "before"],
						["B", "after"],
					]),
				)).resources["ordering"]?.action,
			).toBe("noop");

			// Destroying the ordering leaves the order; the policies' own deletes empty the pair.
			yield* stack.destroy();
			expect(yield* liveOrder).toEqual({ beforeSystemDefined: [], afterSystemDefined: [] });
		}),
);

test.provider("keeps unlisted policies after the listed ones, or fails when exclusive", (stack) =>
	Effect.gen(function* () {
		const siteId = current().site.id;
		const fromUi = yield* sdk(
			Sdk.createFirewallPolicy({
				siteId,
				name: "From the UI",
				enabled: true,
				action: { type: "BLOCK" },
				source: { zoneId: yield* zone("Hotspot") },
				destination: { zoneId: yield* zone("Internal") },
				ipProtocolScope: { ipVersion: "IPV4_AND_IPV6" },
				loggingEnabled: false,
			}),
		);
		const deployed = yield* stack.deploy(
			ordered([
				["B", "before"],
				["A", "before"],
			]),
		);
		expect(yield* liveOrder).toEqual({
			beforeSystemDefined: [deployed.B.firewallPolicyId, deployed.A.firewallPolicyId, fromUi.id],
			afterSystemDefined: [],
		});

		const refused = yield* stack
			.deploy(
				ordered(
					[
						["A", "before"],
						["B", "before"],
					],
					{ exclusive: true },
				),
			)
			.pipe(Effect.flip);
		expect(String(refused)).toContain('"From the UI"');
		yield* sdk(Sdk.deleteFirewallPolicy({ siteId, firewallPolicyId: fromUi.id }));
	}),
);

test.provider("removes a policy and its place in an exclusive ordering in one deploy", (stack) =>
	Effect.gen(function* () {
		const both = yield* stack.deploy(
			ordered(
				[
					["A", "before"],
					["B", "before"],
				],
				{ exclusive: true },
			),
		);
		yield* stack.deploy(
			Effect.gen(function* () {
				const a = yield* UnifiNetwork.FirewallPolicy("a", block("A"));
				return {
					a,
					ordering: yield* UnifiNetwork.FirewallPolicyOrdering("ordering", {
						source: HOTSPOT,
						destination: INTERNAL,
						beforeSystemDefined: [a],
						exclusive: true,
					}),
				};
			}),
		);
		expect(yield* liveOrder).toEqual({ beforeSystemDefined: [both.A.firewallPolicyId], afterSystemDefined: [] });
	}),
);

test.provider("refuses a policy from another zone pair", (stack) =>
	Effect.gen(function* () {
		const refused = yield* stack
			.deploy(
				Effect.gen(function* () {
					const elsewhere = yield* UnifiNetwork.FirewallPolicy("elsewhere", block("Elsewhere", DMZ));
					return {
						ordering: yield* UnifiNetwork.FirewallPolicyOrdering("ordering", {
							source: HOTSPOT,
							destination: INTERNAL,
							beforeSystemDefined: [elsewhere],
						}),
					};
				}),
			)
			.pipe(Effect.flip);
		expect(String(refused)).toContain("belongs to another zone pair");
	}),
);
