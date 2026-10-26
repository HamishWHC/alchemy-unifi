import * as Sdk from "@alchemy-unifi/network-sdk";
import { Unowned } from "alchemy/AdoptPolicy";
import type { Diff } from "alchemy/Diff";
import * as Provider from "alchemy/Provider";
import { Resource } from "alchemy/Resource";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { withConnection } from "./Connection.ts";
import { type FirewallZoneReference, resolveFirewallZone } from "./FirewallZone.ts";
import { matches } from "./internal/Fields.ts";
import { plannedString, UNKNOWN } from "./internal/Plan.ts";
import { captureServices } from "./internal/Services.ts";
import { describeQuery, LookupAmbiguous, LookupNotFound } from "./Lookup.ts";
import { type NetworkReference, resolveNetwork } from "./Network.ts";
import type { Providers } from "./Providers.ts";
import * as ReadCache from "./ReadCache.ts";
import { resolveSite, type Site } from "./Site.ts";
import { resolveTrafficMatchingList, type TrafficMatchingListReference } from "./TrafficMatchingList.ts";

/** Match the addresses or ports in a traffic-matching list (a `TrafficMatchingList` resource or reference). */
export interface TrafficMatchingListFilter {
	readonly type: "TRAFFIC_MATCHING_LIST";
	/** Match everything except the list's entries. */
	readonly matchOpposite: boolean;
	readonly trafficMatchingList: TrafficMatchingListReference;
}

/** IP addresses, ranges or subnets to match: inline, or from a list. */
export type IpAddressFilter = Sdk.IntegrationFirewallPolicySpecificIpAddressFilterDto | TrafficMatchingListFilter;

/** Ports or port ranges to match: inline, or from a list. */
export type PortFilter = Sdk.IntegrationFirewallPolicyPortValueFilterDto | TrafficMatchingListFilter;

/** Networks to match (`Network` resources or references). */
export interface NetworkFilter {
	/** Match every network except these. */
	readonly matchOpposite: boolean;
	readonly networks: ReadonlyArray<NetworkReference>;
}

/** An API traffic filter with its ID fields replaced by references. */
type WithReferences<F> = {
	[K in keyof F]: K extends "ipAddressFilter"
		? IpAddressFilter
		: K extends "portFilter"
			? PortFilter
			: K extends "networkFilter"
				? NetworkFilter
				: F[K];
};
type Distribute<F> = F extends unknown ? WithReferences<F> : never;

/** What a policy matches at its source, besides the zone. `type` picks the kind. */
export type FirewallPolicySourceFilter = Distribute<Sdk.FirewallPolicySourceTrafficFilter>;

/** What a policy matches at its destination, besides the zone. `type` picks the kind. */
export type FirewallPolicyDestinationFilter = Distribute<Sdk.FirewallPolicyDestinationTrafficFilter>;

export interface FirewallPolicyEndpoint<Filter> {
	/** A `FirewallZone` resource or lookup, `{ firewallZoneId }`, or a built-in constant such as `FirewallZone.INTERNAL`. */
	readonly zone: FirewallZoneReference;
	/** Narrows the zone's traffic. Unset matches all of it. */
	readonly trafficFilter?: Filter;
}

/**
 * Props are the Integration API's policy body, with zones, networks and
 * traffic-matching lists as references, plus `site`.
 *
 * Unlike other resources' props, unset optional fields get an explicit
 * default rather than keeping the console's value: leaving out
 * `trafficFilter`, `connectionStateFilter`, `ipsecFilter` or `schedule` means
 * "none", and leaving out `description` means blank, even if the policy has
 * one in the console.
 */
export interface FirewallPolicyProps extends Omit<
	Sdk.CreateFirewallPolicyRequest,
	"siteId" | "source" | "destination"
> {
	/** Site to create the policy in. @default the profile's site, else the console's only site */
	site?: string;
	source: FirewallPolicyEndpoint<FirewallPolicySourceFilter>;
	destination: FirewallPolicyEndpoint<FirewallPolicyDestinationFilter>;
}

/** A policy: a `FirewallPolicy` resource, a {@link FirewallPolicy.lookup} result, or `{ firewallPolicyId }`. */
export interface FirewallPolicyReference {
	readonly firewallPolicyId: string;
	readonly siteId?: string | undefined;
}

export interface FirewallPolicyAttributes {
	siteId: string;
	firewallPolicyId: string;
	name: string;
	sourceFirewallZoneId: string;
	destinationFirewallZoneId: string;
}

export interface FirewallPolicy extends Resource<
	"UnifiNetwork.FirewallPolicy",
	FirewallPolicyProps,
	FirewallPolicyAttributes,
	never,
	Providers
> {}

const loadPolicies = (siteId: string) => withConnection(Stream.runCollect(Sdk.getFirewallPolicies.items({ siteId })));
const policiesKey = ReadCache.key<ReadonlyArray<Sdk.FirewallPolicy>, Effect.Error<ReturnType<typeof loadPolicies>>>(
	"firewallPolicies",
);

/**
 * A site's firewall policies, listed once per run: all of them, including
 * system-defined ones and ones UniFi derives from UI Objects.
 */
export const listFirewallPolicies = (siteId: string) => ReadCache.cached(policiesKey, siteId, loadPolicies(siteId));

/** Policies the user made, as opposed to system-defined ones and ones UniFi derives (from UI Objects, say), which the provider never touches. */
export const isUserDefined = (policy: Sdk.FirewallPolicy) => policy.metadata.origin === "USER_DEFINED";

const toAttributes = (siteId: string, policy: Sdk.FirewallPolicy): FirewallPolicyAttributes => ({
	siteId,
	firewallPolicyId: policy.id,
	name: policy.name,
	sourceFirewallZoneId: policy.source.zoneId,
	destinationFirewallZoneId: policy.destination.zoneId,
});

const resolvePortFilter = Effect.fn(function* (filter: PortFilter, site: Site) {
	if (filter.type === "PORTS") return filter satisfies Sdk.FirewallPolicyPortFilter;
	const trafficMatchingListId = yield* resolveTrafficMatchingList(filter.trafficMatchingList, site);
	return {
		type: "TRAFFIC_MATCHING_LIST",
		matchOpposite: filter.matchOpposite,
		trafficMatchingListId,
	} satisfies Sdk.FirewallPolicyPortFilter;
});

const resolveIpAddressFilter = Effect.fn(function* (filter: IpAddressFilter, site: Site) {
	if (filter.type === "IP_ADDRESSES") return filter satisfies Sdk.FirewallPolicyIPAddressFilter;
	const trafficMatchingListId = yield* resolveTrafficMatchingList(filter.trafficMatchingList, site);
	return {
		type: "TRAFFIC_MATCHING_LIST",
		matchOpposite: filter.matchOpposite,
		trafficMatchingListId,
	} satisfies Sdk.FirewallPolicyIPAddressFilter;
});

const resolveNetworkFilter = (filter: NetworkFilter, site: Site) =>
	Effect.forEach(filter.networks, (network) => resolveNetwork(network, site)).pipe(
		Effect.map((networkIds): Sdk.FirewallPolicyNetworkFilter => ({
			matchOpposite: filter.matchOpposite,
			networkIds,
		})),
	);

/** `filter` with its optional `portFilter` resolved (left out when unset). */
const withPortFilter = Effect.fn(function* <F extends { readonly portFilter?: PortFilter }>(filter: F, site: Site) {
	const { portFilter, ...rest } = filter;
	if (portFilter === undefined) return rest;
	return { ...rest, portFilter: yield* resolvePortFilter(portFilter, site) };
});

const resolveSourceFilter = Effect.fn(function* (filter: FirewallPolicySourceFilter, site: Site) {
	switch (filter.type) {
		case "IP_ADDRESS": {
			const { ipAddressFilter, ...rest } = yield* withPortFilter(filter, site);
			return {
				...rest,
				ipAddressFilter: yield* resolveIpAddressFilter(ipAddressFilter, site),
			} satisfies Sdk.FirewallPolicySourceTrafficFilter;
		}
		case "NETWORK": {
			const { networkFilter, ...rest } = yield* withPortFilter(filter, site);
			return {
				...rest,
				networkFilter: yield* resolveNetworkFilter(networkFilter, site),
			} satisfies Sdk.FirewallPolicySourceTrafficFilter;
		}
		case "PORT":
			return {
				...filter,
				portFilter: yield* resolvePortFilter(filter.portFilter, site),
			} satisfies Sdk.FirewallPolicySourceTrafficFilter;
		case "IPV6_IID":
			return (yield* withPortFilter(filter, site)) satisfies Sdk.FirewallPolicySourceTrafficFilter;
		case "MAC_ADDRESS":
			return (yield* withPortFilter(filter, site)) satisfies Sdk.FirewallPolicySourceTrafficFilter;
		case "REGION":
			return (yield* withPortFilter(filter, site)) satisfies Sdk.FirewallPolicySourceTrafficFilter;
		case "SITE_TO_SITE_VPN_TUNNEL":
			return (yield* withPortFilter(filter, site)) satisfies Sdk.FirewallPolicySourceTrafficFilter;
		case "VPN_SERVER":
			return (yield* withPortFilter(filter, site)) satisfies Sdk.FirewallPolicySourceTrafficFilter;
	}
});

const resolveDestinationFilter = Effect.fn(function* (filter: FirewallPolicyDestinationFilter, site: Site) {
	switch (filter.type) {
		case "IP_ADDRESS": {
			const { ipAddressFilter, ...rest } = yield* withPortFilter(filter, site);
			return {
				...rest,
				ipAddressFilter: yield* resolveIpAddressFilter(ipAddressFilter, site),
			} satisfies Sdk.FirewallPolicyDestinationTrafficFilter;
		}
		case "NETWORK": {
			const { networkFilter, ...rest } = yield* withPortFilter(filter, site);
			return {
				...rest,
				networkFilter: yield* resolveNetworkFilter(networkFilter, site),
			} satisfies Sdk.FirewallPolicyDestinationTrafficFilter;
		}
		case "PORT":
			return {
				...filter,
				portFilter: yield* resolvePortFilter(filter.portFilter, site),
			} satisfies Sdk.FirewallPolicyDestinationTrafficFilter;
		case "APPLICATION":
			return (yield* withPortFilter(filter, site)) satisfies Sdk.FirewallPolicyDestinationTrafficFilter;
		case "APPLICATION_CATEGORY":
			return (yield* withPortFilter(filter, site)) satisfies Sdk.FirewallPolicyDestinationTrafficFilter;
		case "DOMAIN":
			return (yield* withPortFilter(filter, site)) satisfies Sdk.FirewallPolicyDestinationTrafficFilter;
		case "IPV6_IID":
			return (yield* withPortFilter(filter, site)) satisfies Sdk.FirewallPolicyDestinationTrafficFilter;
		case "REGION":
			return (yield* withPortFilter(filter, site)) satisfies Sdk.FirewallPolicyDestinationTrafficFilter;
		case "SITE_TO_SITE_VPN_TUNNEL":
			return (yield* withPortFilter(filter, site)) satisfies Sdk.FirewallPolicyDestinationTrafficFilter;
		case "VPN_SERVER":
			return (yield* withPortFilter(filter, site)) satisfies Sdk.FirewallPolicyDestinationTrafficFilter;
	}
});

/** The request body for `props` (without `siteId`), with references resolved to IDs. */
const toBody = Effect.fn(function* (props: FirewallPolicyProps, site: Site) {
	const { site: _site, source, destination, ...rest } = props;
	const sourceFilter = source.trafficFilter;
	const destinationFilter = destination.trafficFilter;
	return {
		...rest,
		description: rest.description ?? "",
		source: {
			zoneId: yield* resolveFirewallZone(source.zone, site),
			...(sourceFilter === undefined ? {} : { trafficFilter: yield* resolveSourceFilter(sourceFilter, site) }),
		},
		destination: {
			zoneId: yield* resolveFirewallZone(destination.zone, site),
			...(destinationFilter === undefined
				? {}
				: { trafficFilter: yield* resolveDestinationFilter(destinationFilter, site) }),
		},
	} satisfies Omit<Sdk.CreateFirewallPolicyRequest, "siteId">;
});

type Body = Effect.Success<ReturnType<typeof toBody>>;

/** Whether the console's policy is what `body` describes, fields left out of `body` included (they must be absent). */
const isCurrent = ({ description, ...body }: Body, observed: Sdk.FirewallPolicy) =>
	matches(body, observed) &&
	// The console omits a blank description.
	(observed.description ?? "") === description &&
	(body.connectionStateFilter !== undefined || observed.connectionStateFilter === undefined) &&
	(body.ipsecFilter !== undefined || observed.ipsecFilter === undefined) &&
	(body.schedule !== undefined || observed.schedule === undefined) &&
	(body.source.trafficFilter !== undefined || observed.source.trafficFilter === undefined) &&
	(body.destination.trafficFilter !== undefined || observed.destination.trafficFilter === undefined);

const getPolicy = (siteId: string, firewallPolicyId: string) =>
	withConnection(Sdk.getFirewallPolicy({ siteId, firewallPolicyId })).pipe(
		Effect.catchTag("NotFound", () => Effect.undefined),
	);

/** User-defined policies named `name` from `source` to `destination`. Names aren't unique, even within a zone pair. */
const findByName = Effect.fn(function* (
	site: Site,
	name: string,
	source: FirewallZoneReference | undefined,
	destination: FirewallZoneReference | undefined,
) {
	const sourceId = source === undefined ? undefined : yield* resolveFirewallZone(source, site);
	const destinationId = destination === undefined ? undefined : yield* resolveFirewallZone(destination, site);
	return (yield* listFirewallPolicies(site.id)).filter(
		(p) =>
			isUserDefined(p) &&
			p.name === name &&
			(sourceId === undefined || p.source.zoneId === sourceId) &&
			(destinationId === undefined || p.destination.zoneId === destinationId),
	);
});

/**
 * A zone-based firewall policy: allow, block or reject traffic from one
 * zone to another, optionally narrowed by traffic filters. Changing its
 * zones updates it in place and moves it to the new zone pair's ordering
 * (see `FirewallPolicyOrdering`).
 *
 * Existing user-defined policies are adopted with `--adopt` by name and zone
 * pair (names aren't unique, so several matches adopt nothing). Policies
 * UniFi derives, e.g. from UI Objects, are invisible: never listed, adopted
 * or ordered.
 *
 * @example
 * ```ts
 * yield* UnifiNetwork.FirewallPolicy("block-iot-to-internal", {
 *   name: "Block IoT to Internal",
 *   enabled: true,
 *   action: { type: "BLOCK" },
 *   source: { zone: iotZone },
 *   destination: { zone: UnifiNetwork.FirewallZone.INTERNAL },
 *   ipProtocolScope: { ipVersion: "IPV4_AND_IPV6" },
 *   loggingEnabled: false,
 * });
 * ```
 */
export const FirewallPolicy = Resource<FirewallPolicy>("UnifiNetwork.FirewallPolicy")({
	/**
	 * A user-defined policy by name, optionally narrowed to a zone pair. Dies
	 * with a user-facing `LookupNotFound` or `LookupAmbiguous`: stack bodies
	 * can't fail with typed errors.
	 */
	lookup: Effect.fn("UnifiNetwork.FirewallPolicy.lookup")(function* (query: {
		readonly name: string;
		readonly source?: FirewallZoneReference;
		readonly destination?: FirewallZoneReference;
		readonly site?: string;
	}) {
		const site = yield* resolveSite(query.site);
		const policies = yield* findByName(site, query.name, query.source, query.destination);
		const [policy] = policies;
		const described = describeQuery({ name: query.name });
		if (policy === undefined) {
			return yield* new LookupNotFound({ resource: "firewall policy", query: described, site });
		}
		if (policies.length > 1) {
			return yield* new LookupAmbiguous({
				resource: "firewall policy",
				query: described,
				site,
				count: policies.length,
			});
		}
		return toAttributes(site.id, policy);
	}, Effect.orDie),
});

export const FirewallPolicyProvider = () =>
	Provider.effect(
		FirewallPolicy,
		Effect.gen(function* () {
			const run = yield* captureServices;

			return FirewallPolicy.Provider.of({
				list: () =>
					run(
						Effect.gen(function* () {
							const site = yield* resolveSite();
							const policies = yield* listFirewallPolicies(site.id);
							return policies.filter(isUserDefined).map((policy) => toAttributes(site.id, policy));
						}),
					),

				read: ({ olds, output }) =>
					run(
						Effect.gen(function* () {
							if (output !== undefined) {
								const policy = yield* getPolicy(output.siteId, output.firewallPolicyId);
								return policy === undefined || !isUserDefined(policy)
									? undefined
									: toAttributes(output.siteId, policy);
							}
							const site = yield* resolveSite(olds.site);
							const matching = yield* findByName(
								site,
								olds.name,
								olds.source.zone,
								olds.destination.zone,
							);
							const [policy] = matching;
							return policy === undefined || matching.length > 1
								? undefined
								: Unowned(toAttributes(site.id, policy));
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
							const body = yield* toBody(news, site);
							const observed =
								output !== undefined && output.siteId === site.id
									? yield* getPolicy(site.id, output.firewallPolicyId)
									: undefined;
							const write = ReadCache.invalidating(policiesKey, site.id);
							if (observed === undefined) {
								const created = yield* withConnection(
									Sdk.createFirewallPolicy({ siteId: site.id, ...body }),
								).pipe(write);
								return toAttributes(site.id, created);
							}
							if (isCurrent(body, observed)) return toAttributes(site.id, observed);
							// A full PUT of the body: optional fields it leaves out are removed.
							const updated = yield* withConnection(
								Sdk.updateFirewallPolicy({
									...body,
									siteId: site.id,
									firewallPolicyId: observed.id,
								}),
							).pipe(write);
							return toAttributes(site.id, updated);
						}),
					),

				delete: ({ output }) =>
					run(
						withConnection(
							Sdk.deleteFirewallPolicy({
								siteId: output.siteId,
								firewallPolicyId: output.firewallPolicyId,
							}),
						).pipe(
							Effect.asVoid,
							Effect.catchTag("NotFound", () => Effect.void),
							ReadCache.invalidating(policiesKey, output.siteId),
						),
					),
			});
		}),
	);
