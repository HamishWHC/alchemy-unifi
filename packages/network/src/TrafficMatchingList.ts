import * as Sdk from "@alchemy-unifi/network-sdk";
import { Unowned } from "alchemy/AdoptPolicy";
import type { Diff } from "alchemy/Diff";
import * as Provider from "alchemy/Provider";
import { Resource } from "alchemy/Resource";
import { UserFacingError } from "alchemy/UserFacingError";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { withConnection } from "./Connection.ts";
import { type DistributiveOmit, isCurrent, omitKeys } from "./internal/Fields.ts";
import { plannedString, UNKNOWN } from "./internal/Plan.ts";
import { captureServices } from "./internal/Services.ts";
import { describeQuery, LookupNotFound } from "./Lookup.ts";
import type { Providers } from "./Providers.ts";
import * as ReadCache from "./ReadCache.ts";
import { checkSameSite, resolveSite, type Site } from "./Site.ts";

/**
 * Props are the Integration API's list body plus `site`. `type` picks what
 * it holds: `"IPV4_ADDRESSES"`, `"IPV6_ADDRESSES"` or `"PORTS"` (no MACs).
 */
export type TrafficMatchingListProps = Sdk.CreateOrUpdateTrafficMatchingList & {
	/** Site to create the list in. @default the profile's site, else the console's only site */
	site?: string;
};

/** A list: a `TrafficMatchingList` resource, a {@link TrafficMatchingList.lookup} result, or `{ trafficMatchingListId }`. */
export interface TrafficMatchingListReference {
	readonly trafficMatchingListId: string;
	readonly siteId?: string | undefined;
}

export interface TrafficMatchingListAttributes {
	siteId: string;
	trafficMatchingListId: string;
	name: string;
	type: TrafficMatchingListProps["type"];
	/** The whole list as the console reports it, so `alchemy drift` sees any change. */
	config: DistributiveOmit<Sdk.TrafficMatchingList, "id">;
}

export interface TrafficMatchingList extends Resource<
	"UnifiNetwork.TrafficMatchingList",
	TrafficMatchingListProps,
	TrafficMatchingListAttributes,
	never,
	Providers
> {}

const loadLists = (siteId: string) => withConnection(Stream.runCollect(Sdk.getTrafficMatchingLists.items({ siteId })));
const listsKey = ReadCache.key<ReadonlyArray<Sdk.TrafficMatchingList>, Effect.Error<ReturnType<typeof loadLists>>>(
	"trafficMatchingLists",
);

/** A site's traffic-matching lists, listed once per run. */
export const listTrafficMatchingLists = (siteId: string) => ReadCache.cached(listsKey, siteId, loadLists(siteId));

const toAttributes = (siteId: string, list: Sdk.TrafficMatchingList): TrafficMatchingListAttributes => {
	const { id, ...config } = list;
	return { siteId, trafficMatchingListId: id, name: list.name, type: list.type, config };
};

/** Fields the console reports but rejects in request bodies. */
const READ_ONLY = ["id"];

/** A list can't be deleted while something references it. */
export class TrafficMatchingListInUse extends Data.TaggedError("TrafficMatchingListInUse")<{
	readonly listName: string;
	/** Names of the firewall policies referencing it, as far as they could be found. */
	readonly referencedBy: ReadonlyArray<string>;
	readonly detail: string;
}> {
	readonly [UserFacingError]: true = true;
	override get message() {
		const by =
			this.referencedBy.length > 0
				? `firewall policies ${this.referencedBy.map((name) => `"${name}"`).join(", ")}`
				: `something the provider couldn't identify (${this.detail})`;
		return `Can't delete traffic-matching list "${this.listName}": it's still referenced by ${by}. Those references aren't managed by this stack (e.g. made in the UI); remove them, then deploy again.`;
	}
}

/** User-defined firewall policies that mention `trafficMatchingListId` in a filter. */
const policiesReferencing = (siteId: string, trafficMatchingListId: string) =>
	withConnection(Stream.runCollect(Sdk.getFirewallPolicies.items({ siteId }))).pipe(
		Effect.map((policies) =>
			policies
				.filter(
					(p) =>
						p.metadata.origin === "USER_DEFINED" &&
						JSON.stringify([p.source, p.destination]).includes(trafficMatchingListId),
				)
				.map((p) => p.name),
		),
		Effect.orElseSucceed((): ReadonlyArray<string> => []),
	);

/** The list ID a reference means in `site`. */
export const resolveTrafficMatchingList = (reference: TrafficMatchingListReference, site: Site) =>
	checkSameSite("traffic-matching list", reference.siteId, site).pipe(Effect.as(reference.trafficMatchingListId));

/** A list by ID, from the run's cached lists, which come whole (one request for every list in a plan). */
const getList = (siteId: string, trafficMatchingListId: string) =>
	listTrafficMatchingLists(siteId).pipe(Effect.map((lists) => lists.find((l) => l.id === trafficMatchingListId)));

/**
 * A named list of ports, IPv4 addresses or IPv6 addresses, which
 * `FirewallPolicy` filters reference instead of repeating values inline.
 * `type` is `"PORTS"`, `"IPV4_ADDRESSES"` or `"IPV6_ADDRESSES"`. Names are
 * unique per site, so existing lists are adopted by name with `--adopt`.
 * Changing `type` updates the list in place.
 *
 * ### Creating a list
 *
 * **Example:** Port and address lists
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
 * 		yield* UnifiNetwork.TrafficMatchingList("web-ports", {
 * 			type: "PORTS",
 * 			name: "Web",
 * 			items: [
 * 				{ type: "PORT_NUMBER", value: 443 },
 * 				{ type: "PORT_NUMBER_RANGE", start: 8000, stop: 8099 },
 * 			],
 * 		});
 * 		yield* UnifiNetwork.TrafficMatchingList("servers", {
 * 			type: "IPV4_ADDRESSES",
 * 			name: "Servers",
 * 			items: [
 * 				{ type: "IP_ADDRESS", value: "192.168.10.5" },
 * 				{ type: "IP_ADDRESS_RANGE", start: "192.168.10.20", stop: "192.168.10.29" },
 * 				{ type: "SUBNET", value: "192.168.11.0/24" },
 * 			],
 * 		});
 * 	}),
 * );
 * ```
 *
 * :::note
 * There are no MAC lists. Firewall policies match MAC addresses inline, so
 * share them as a constant in your code instead.
 * :::
 *
 * ### Using a list in a policy
 *
 * **Example:** A policy's address filter
 *
 * ```ts
 * import * as UnifiNetwork from "@alchemy-unifi/network";
 * import * as Effect from "effect/Effect";
 *
 * export const allowServers = Effect.gen(function* () {
 * 	const servers = yield* UnifiNetwork.TrafficMatchingList("servers", {
 * 		type: "IPV4_ADDRESSES",
 * 		name: "Servers",
 * 		items: [{ type: "IP_ADDRESS", value: "192.168.10.5" }],
 * 	});
 * 	yield* UnifiNetwork.FirewallPolicy("guests-to-servers", {
 * 		name: "Allow guests to the servers",
 * 		enabled: true,
 * 		action: { type: "ALLOW", allowReturnTraffic: true },
 * 		source: { zone: UnifiNetwork.FirewallZone.HOTSPOT },
 * 		destination: {
 * 			zone: UnifiNetwork.FirewallZone.INTERNAL,
 * 			trafficFilter: {
 * 				type: "IP_ADDRESS",
 * 				ipAddressFilter: { type: "TRAFFIC_MATCHING_LIST", matchOpposite: false, trafficMatchingList: servers },
 * 			},
 * 		},
 * 		ipProtocolScope: { ipVersion: "IPV4_AND_IPV6" },
 * 		loggingEnabled: false,
 * 	});
 * });
 * ```
 *
 * ### Looking up a list
 *
 * `TrafficMatchingList.lookup({ name })` finds a list the stack uses but
 * doesn't manage.
 *
 * ### Deleting a list
 *
 * :::caution
 * A list something outside the stack uses (e.g. a policy made in the UI)
 * can't be deleted. The deploy fails with an error naming the policies that
 * use it.
 * :::
 *
 * Disabled policies don't hold a list: deleting a list one uses succeeds, and
 * that policy then can't be re-enabled until its filter is fixed.
 *
 * @resource
 */
export const TrafficMatchingList = Resource<TrafficMatchingList>("UnifiNetwork.TrafficMatchingList")({
	/**
	 * A list in the site by name. Dies with a user-facing `LookupNotFound`:
	 * stack bodies can't fail with typed errors.
	 */
	lookup: Effect.fn("UnifiNetwork.TrafficMatchingList.lookup")(function* (query: {
		readonly name: string;
		readonly site?: string;
	}) {
		const site = yield* resolveSite(query.site);
		const list = (yield* listTrafficMatchingLists(site.id)).find((l) => l.name === query.name);
		if (list === undefined) {
			return yield* new LookupNotFound({ resource: "traffic-matching list", query: describeQuery(query), site });
		}
		return toAttributes(site.id, list);
	}, Effect.orDie),
});

export const TrafficMatchingListProvider = () =>
	Provider.effect(
		TrafficMatchingList,
		Effect.gen(function* () {
			const run = yield* captureServices;

			return TrafficMatchingList.Provider.of({
				list: () =>
					run(
						Effect.gen(function* () {
							const site = yield* resolveSite();
							return (yield* listTrafficMatchingLists(site.id)).map((list) =>
								toAttributes(site.id, list),
							);
						}),
					),

				read: ({ olds, output }) =>
					run(
						Effect.gen(function* () {
							if (output !== undefined) {
								const list = yield* getList(output.siteId, output.trafficMatchingListId);
								return list === undefined ? undefined : toAttributes(output.siteId, list);
							}
							const site = yield* resolveSite(olds.site);
							const list = (yield* listTrafficMatchingLists(site.id)).find((l) => l.name === olds.name);
							return list === undefined ? undefined : Unowned(toAttributes(site.id, list));
						}),
					),

				diff: ({ news, output }) =>
					run(
						Effect.gen(function* () {
							const siteProp = plannedString(news, "site");
							if (output === undefined || siteProp === UNKNOWN) return undefined;
							const site = yield* resolveSite(siteProp);
							if (site.id !== output.siteId) return { action: "replace" } satisfies Diff;
							return undefined;
						}),
					),

				reconcile: ({ news, output }) =>
					run(
						Effect.gen(function* () {
							const site = yield* resolveSite(news.site);
							const { site: _site, ...body } = news;
							const observed =
								output !== undefined && output.siteId === site.id
									? yield* getList(site.id, output.trafficMatchingListId)
									: undefined;
							const write = ReadCache.invalidating(listsKey, site.id);
							if (observed === undefined) {
								const created = yield* withConnection(
									Sdk.createTrafficMatchingList({ siteId: site.id, body }),
								).pipe(write);
								return toAttributes(site.id, created);
							}
							if (isCurrent(body, omitKeys(observed, READ_ONLY))) return toAttributes(site.id, observed);
							const updated = yield* withConnection(
								Sdk.updateTrafficMatchingList({
									siteId: site.id,
									trafficMatchingListId: observed.id,
									body,
								}),
							).pipe(write);
							return toAttributes(site.id, updated);
						}),
					),

				delete: ({ output }) =>
					run(
						withConnection(
							Sdk.deleteTrafficMatchingList({
								siteId: output.siteId,
								trafficMatchingListId: output.trafficMatchingListId,
							}),
						).pipe(
							Effect.asVoid,
							Effect.catchTags({
								NotFound: () => Effect.void,
								// 422 "Selected traffic matching list is referenced by other resources".
								UnprocessableEntity: (error) =>
									policiesReferencing(output.siteId, output.trafficMatchingListId).pipe(
										Effect.flatMap((referencedBy) =>
											Effect.fail(
												new TrafficMatchingListInUse({
													listName: output.name,
													referencedBy,
													detail: error.message,
												}),
											),
										),
									),
							}),
							ReadCache.invalidating(listsKey, output.siteId),
						),
					),
			});
		}),
	);
