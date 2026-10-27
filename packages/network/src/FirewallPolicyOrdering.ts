import * as Sdk from "@alchemy-unifi/network-sdk";
import * as Provider from "alchemy/Provider";
import { Resource } from "alchemy/Resource";
import { UserFacingError } from "alchemy/UserFacingError";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import { withConnection } from "./Connection.ts";
import { type FirewallPolicyReference, isUserDefined, listFirewallPolicies } from "./FirewallPolicy.ts";
import { type FirewallZoneReference, resolveFirewallZone } from "./FirewallZone.ts";
import { captureServices } from "./internal/Services.ts";
import type { Providers } from "./Providers.ts";
import { checkSameSite, resolveSite, type Site } from "./Site.ts";
import { STATE_POLICY_PREFIX } from "./State.ts";

export interface FirewallPolicyOrderingProps {
	/** Site of the zones. @default the profile's site, else the console's only site */
	site?: string;
	source: FirewallZoneReference;
	destination: FirewallZoneReference;
	/** Policies evaluated before the system-defined ones, first match wins. */
	beforeSystemDefined?: ReadonlyArray<FirewallPolicyReference>;
	/** Policies evaluated after the system-defined ones. */
	afterSystemDefined?: ReadonlyArray<FirewallPolicyReference>;
	/**
	 * Fail instead of keeping policies in the zone pair that aren't listed
	 * (e.g. made in the UI). @default false
	 */
	exclusive?: boolean;
}

export interface FirewallPolicyOrderingAttributes {
	siteId: string;
	sourceFirewallZoneId: string;
	destinationFirewallZoneId: string;
	beforeSystemDefined: ReadonlyArray<string>;
	afterSystemDefined: ReadonlyArray<string>;
	/** The policies the props list, as opposed to unlisted ones kept in the order. */
	listedFirewallPolicyIds: ReadonlyArray<string>;
}

export interface FirewallPolicyOrdering extends Resource<
	"UnifiNetwork.FirewallPolicyOrdering",
	FirewallPolicyOrderingProps,
	FirewallPolicyOrderingAttributes,
	never,
	Providers
> {}

/** An ordering that can't be applied as given. */
export class InvalidFirewallPolicyOrdering extends Data.TaggedError("InvalidFirewallPolicyOrdering")<{
	readonly reason: string;
}> {
	readonly [UserFacingError]: true = true;
	override get message() {
		return `Can't apply the firewall policy ordering: ${this.reason}`;
	}
}

type Order = Sdk.OrderedFirewallPolicyIDs;

const sameOrder = (a: Order, b: Order) =>
	a.beforeSystemDefined.join() === b.beforeSystemDefined.join() &&
	a.afterSystemDefined.join() === b.afterSystemDefined.join();

const resolvePair = Effect.fn(function* (props: FirewallPolicyOrderingProps) {
	const site = yield* resolveSite(props.site);
	return {
		site,
		siteId: site.id,
		sourceFirewallZoneId: yield* resolveFirewallZone(props.source, site),
		destinationFirewallZoneId: yield* resolveFirewallZone(props.destination, site),
	};
});

const getOrder = ({ siteId, sourceFirewallZoneId, destinationFirewallZoneId }: Pair) =>
	withConnection(Sdk.getFirewallPolicyOrdering({ siteId, sourceFirewallZoneId, destinationFirewallZoneId })).pipe(
		Effect.map((ordering) => ordering.orderedFirewallPolicyIds),
	);

interface Pair {
	readonly siteId: string;
	readonly sourceFirewallZoneId: string;
	readonly destinationFirewallZoneId: string;
}

const toAttributes = (
	pair: Pair,
	order: Order,
	listedFirewallPolicyIds: ReadonlyArray<string>,
): FirewallPolicyOrderingAttributes => ({
	siteId: pair.siteId,
	sourceFirewallZoneId: pair.sourceFirewallZoneId,
	destinationFirewallZoneId: pair.destinationFirewallZoneId,
	beforeSystemDefined: order.beforeSystemDefined,
	afterSystemDefined: order.afterSystemDefined,
	listedFirewallPolicyIds,
});

const resolvePolicies = (references: ReadonlyArray<FirewallPolicyReference> | undefined, site: Site) =>
	Effect.forEach(references ?? [], (reference) =>
		checkSameSite("firewall policy", reference.siteId, site).pipe(Effect.as(reference.firewallPolicyId)),
	);

/** Why a listed policy isn't in the zone pair's ordering. */
const explainMissing = Effect.fn(function* (site: Site, firewallPolicyId: string, pair: Pair) {
	const policy = (yield* listFirewallPolicies(site.id)).find((p) => p.id === firewallPolicyId);
	if (policy === undefined) return `policy ${firewallPolicyId} doesn't exist`;
	if (!isUserDefined(policy)) return `"${policy.name}" isn't user-defined, so it can't be ordered`;
	if (
		policy.source.zoneId !== pair.sourceFirewallZoneId ||
		policy.destination.zoneId !== pair.destinationFirewallZoneId
	) {
		return `"${policy.name}" belongs to another zone pair`;
	}
	return `"${policy.name}" isn't in the zone pair's ordering`;
});

/**
 * The state store's policies (`UnifiNetwork.state()`) among `ids`. The store
 * may have created one since the run's policy list was read, so policies
 * missing from it are fetched.
 */
const statePolicies = Effect.fn(function* (site: Site, ids: ReadonlyArray<string>) {
	const policies = yield* listFirewallPolicies(site.id);
	const names = yield* Effect.forEach(ids, (id) => {
		const listed = policies.find((p) => p.id === id);
		return listed !== undefined
			? Effect.succeed(listed.name)
			: withConnection(Sdk.getFirewallPolicy({ siteId: site.id, firewallPolicyId: id })).pipe(
					Effect.map((policy): string | undefined => policy.name),
					Effect.catchTag("NotFound", () => Effect.undefined),
				);
	});
	return ids.filter((_, i) => names[i]?.startsWith(STATE_POLICY_PREFIX) === true);
});

const describePolicies = Effect.fn(function* (site: Site, ids: ReadonlyArray<string>) {
	const policies = yield* listFirewallPolicies(site.id);
	return ids.map((id) => `"${policies.find((p) => p.id === id)?.name ?? id}"`).join(", ");
});

/**
 * The order the policies from one zone to another are evaluated in, first
 * match wins. Each zone pair has two buckets, with the system policies
 * between them: `beforeSystemDefined` and `afterSystemDefined`. System
 * policies can't be reordered, and policies UniFi derives from UI objects
 * aren't ordered at all.
 *
 * The zone pair is the identity, so an existing ordering is adopted without
 * `--adopt`, and deleting the resource leaves the order as it is. Listing
 * policies makes the ordering depend on them, so it's applied after they're
 * created or moved.
 *
 * ### Ordering a zone pair
 *
 * **Example:** An allow before a block
 *
 * ```ts
 * import * as UnifiNetwork from "@alchemy-unifi/network";
 * import * as Alchemy from "alchemy";
 * import * as Effect from "effect/Effect";
 *
 * export default Alchemy.Stack(
 * 	"HomeNetwork",
 * 	{ providers: UnifiNetwork.providers(), state: UnifiNetwork.state() },
 * 	Effect.gen(function* () {
 * 		const { INTERNAL } = UnifiNetwork.FirewallZone;
 * 		const iot = yield* UnifiNetwork.FirewallZone("iot-zone", { name: "IoT" });
 * 		const policy = {
 * 			enabled: true,
 * 			source: { zone: INTERNAL },
 * 			destination: { zone: iot },
 * 			loggingEnabled: false,
 * 		} as const;
 * 		const allowHomeAssistant = yield* UnifiNetwork.FirewallPolicy("allow-ha", {
 * 			...policy,
 * 			name: "Allow Home Assistant",
 * 			action: { type: "ALLOW", allowReturnTraffic: true },
 * 			ipProtocolScope: { ipVersion: "IPV4_AND_IPV6" },
 * 		});
 * 		const blockTheRest = yield* UnifiNetwork.FirewallPolicy("block-rest", {
 * 			...policy,
 * 			name: "Block the rest",
 * 			action: { type: "BLOCK" },
 * 			ipProtocolScope: { ipVersion: "IPV4_AND_IPV6" },
 * 		});
 * 		yield* UnifiNetwork.FirewallPolicyOrdering("internal-to-iot", {
 * 			source: INTERNAL,
 * 			destination: iot,
 * 			beforeSystemDefined: [allowHomeAssistant, blockTheRest],
 * 		});
 * 	}),
 * );
 * ```
 *
 * ### Policies the ordering doesn't list
 *
 * UniFi rejects an ordering that leaves out any of the pair's policies, so
 * unlisted ones (e.g. made in the UI) are kept after the listed ones in each
 * bucket, in their current relative order, with a warning. Set
 * `exclusive: true` to fail instead.
 *
 * A policy the ordering listed before but no longer does is kept quietly,
 * even when exclusive: it's usually being deleted in the same deploy, which
 * runs after the ordering is applied. So removing a policy and its place in
 * the ordering in one deploy works.
 *
 * :::caution
 * A listed policy must be in the pair. One that's missing, in another pair,
 * or listed twice fails the deploy.
 * :::
 *
 * ### The state store's policies
 *
 * A Gateway → Gateway ordering keeps `UnifiNetwork.state()`'s policies where
 * they are, even when exclusive.
 *
 * @resource
 */
export const FirewallPolicyOrdering = Resource<FirewallPolicyOrdering>("UnifiNetwork.FirewallPolicyOrdering");

export const FirewallPolicyOrderingProvider = () =>
	Provider.effect(
		FirewallPolicyOrdering,
		Effect.gen(function* () {
			const run = yield* captureServices;

			return FirewallPolicyOrdering.Provider.of({
				// Orderings aren't objects of their own: there's nothing to list or nuke.
				list: () => Effect.succeed([]),

				read: ({ olds, output }) =>
					run(
						Effect.gen(function* () {
							if (output !== undefined) {
								return toAttributes(output, yield* getOrder(output), output.listedFirewallPolicyIds);
							}
							// One ordering per zone pair, so the existing one is this resource's.
							const pair = yield* resolvePair(olds);
							return toAttributes(pair, yield* getOrder(pair), []);
						}),
					),

				reconcile: ({ news, output }) =>
					run(
						Effect.gen(function* () {
							const pair = yield* resolvePair(news);
							const { site } = pair;
							const before = yield* resolvePolicies(news.beforeSystemDefined, site);
							const after = yield* resolvePolicies(news.afterSystemDefined, site);
							const listed = [...before, ...after];
							const duplicate = listed.find((id, i) => listed.indexOf(id) !== i);
							if (duplicate !== undefined) {
								const names = yield* describePolicies(site, [duplicate]);
								return yield* new InvalidFirewallPolicyOrdering({
									reason: `${names} is listed twice.`,
								});
							}

							const current = yield* getOrder(pair);
							const inPair = new Set([...current.beforeSystemDefined, ...current.afterSystemDefined]);
							const missing = listed.find((id) => !inPair.has(id));
							if (missing !== undefined) {
								return yield* new InvalidFirewallPolicyOrdering({
									reason: `${yield* explainMissing(site, missing, pair)}.`,
								});
							}

							const unlisted = (ids: ReadonlyArray<string>) => ids.filter((id) => !listed.includes(id));
							const formerlyListed = output?.listedFirewallPolicyIds ?? [];
							const unlistedNow = [
								...unlisted(current.beforeSystemDefined),
								...unlisted(current.afterSystemDefined),
							].filter((id) => !formerlyListed.includes(id));
							// The state store's policies are disabled and kept where they are, without a word.
							const stateIds = yield* statePolicies(site, unlistedNow);
							const unmanaged = unlistedNow.filter((id) => !stateIds.includes(id));
							if (unmanaged.length > 0) {
								const names = yield* describePolicies(site, unmanaged);
								if (news.exclusive === true) {
									return yield* new InvalidFirewallPolicyOrdering({
										reason: `the zone pair has policies the ordering doesn't list: ${names}. List them, delete them, or drop \`exclusive\`.`,
									});
								}
								yield* Effect.logWarning(
									`Firewall policy ordering: keeping unlisted policies after the listed ones: ${names}.`,
								);
							}

							const desired: Order = {
								beforeSystemDefined: [...before, ...unlisted(current.beforeSystemDefined)],
								afterSystemDefined: [...after, ...unlisted(current.afterSystemDefined)],
							};
							if (sameOrder(desired, current)) return toAttributes(pair, current, listed);
							const updated = yield* withConnection(
								Sdk.updateFirewallPolicyOrdering({
									siteId: pair.siteId,
									sourceFirewallZoneId: pair.sourceFirewallZoneId,
									destinationFirewallZoneId: pair.destinationFirewallZoneId,
									orderedFirewallPolicyIds: desired,
								}),
							);
							return toAttributes(pair, updated.orderedFirewallPolicyIds, listed);
						}),
					),

				// The order stays as it is; the policies themselves are deleted by their own resources.
				delete: () => Effect.void,
			});
		}),
	);
