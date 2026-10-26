import * as Sdk from "@alchemy-unifi/network-sdk";
import { Unowned } from "alchemy/AdoptPolicy";
import type { Diff } from "alchemy/Diff";
import * as Provider from "alchemy/Provider";
import { Resource } from "alchemy/Resource";
import { UserFacingError } from "alchemy/UserFacingError";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import { withConnection } from "./Connection.ts";
import { type FirewallZoneReference, resolveFirewallZone } from "./FirewallZone.ts";
import { type DistributiveOmit, isCurrent, omitKeys } from "./internal/Fields.ts";
import { loadNetworks } from "./internal/Networks.ts";
import { planned, plannedString, UNKNOWN } from "./internal/Plan.ts";
import { captureServices } from "./internal/Services.ts";
import { describeQuery, LookupAmbiguous, LookupNotFound } from "./Lookup.ts";
import type { Providers } from "./Providers.ts";
import * as ReadCache from "./ReadCache.ts";
import { checkSameSite, resolveSite, type Site } from "./Site.ts";

interface SiteProp {
	/** Site to create the network in. @default the profile's site, else the console's only site */
	site?: string;
}

/** A device, e.g. the switch routing a switch-managed network. */
export interface DeviceReference {
	readonly deviceId: string;
}

/** A network routed by the gateway: the usual kind, with DHCP, zones and internet access. */
export interface GatewayNetworkProps
	extends Omit<Sdk.IntegrationGatewayManagedNetworkCreateUpdateDto, "zoneId">, SiteProp {
	/**
	 * The network's firewall zone, e.g. `FirewallZone.INTERNAL` or a
	 * `FirewallZone` resource. Required once the site uses the zone-based
	 * firewall.
	 */
	zone?: FirewallZoneReference;
}

/** A network routed by a layer-3 switch. */
export interface SwitchNetworkProps
	extends Omit<Sdk.IntegrationSwitchManagedNetworkCreateUpdateDto, "deviceId">, SiteProp {
	/** The switch routing the network. */
	device: DeviceReference;
}

/** A VLAN that UniFi carries but doesn't route; something else on it does. */
export interface UnmanagedNetworkProps extends Sdk.IntegrationUnmanagedNetworkCreateUpdateDto, SiteProp {}

/** Props are the Integration API's network body, plus `site` and references; `management` picks the kind. */
export type NetworkProps = GatewayNetworkProps | SwitchNetworkProps | UnmanagedNetworkProps;

/** A network: a `Network` resource, a {@link Network.lookup} result, or `{ networkId }`. */
export interface NetworkReference {
	readonly networkId: string;
	readonly siteId?: string | undefined;
	/** Set by resources and lookups. Some objects must reference the default network differently. */
	readonly default?: boolean | undefined;
}

/** A change that would replace the site's default network, which can't be deleted. */
export class DefaultNetworkReplacement extends Data.TaggedError("DefaultNetworkReplacement")<{
	readonly networkName: string;
	readonly reason: string;
}> {
	readonly [UserFacingError]: true = true;
	override get message() {
		return `${this.networkName} is the site's default network, which can't be replaced (${this.reason}). It must stay gateway-managed in its site.`;
	}
}

export interface NetworkAttributes {
	siteId: string;
	networkId: string;
	name: string;
	vlanId: number;
	management: NetworkProps["management"];
	/** The network's firewall zone (gateway networks). */
	zoneId: string | undefined;
	/** Whether this is the site's default network, which is never deleted. */
	default: boolean;
	/** The whole network as the console reports it, so `alchemy drift` sees any change. */
	config: DistributiveOmit<Sdk.NetworkDetails, "id" | "metadata" | "default">;
}

export interface Network extends Resource<"UnifiNetwork.Network", NetworkProps, NetworkAttributes, never, Providers> {}

const networksKey = ReadCache.key<ReadonlyArray<Sdk.NetworkOverview>, Effect.Error<ReturnType<typeof loadNetworks>>>(
	"networks",
);

/** A site's networks, listed once per run. */
export const listNetworks = (siteId: string) => ReadCache.cached(networksKey, siteId, loadNetworks(siteId));

const toAttributes = (siteId: string, network: Sdk.NetworkDetails): NetworkAttributes => {
	const { id, metadata: _metadata, default: isDefault, ...config } = network;
	return {
		siteId,
		networkId: id,
		name: network.name,
		vlanId: network.vlanId,
		management: network.management,
		zoneId: "zoneId" in network ? network.zoneId : undefined,
		default: isDefault,
		config,
	};
};

/** Fields the console reports but rejects in request bodies. */
const READ_ONLY = ["id", "metadata", "default"];

/**
 * `body` with explicit values for the two unset fields that can't simply be
 * left out (both verified):
 * - `mdnsForwardingEnabled`: a `PUT` without it keeps the console's value
 *   instead of resetting it, so the default (`true`, what the console sets on
 *   create) is always sent;
 * - a DHCP server's `domainName`: the console reports `""` when it's unset,
 *   so without the default the body would never match and every deploy
 *   would update it (and drift would report it) forever.
 */
const withDefaults = (body: Sdk.CreateOrUpdateNetwork): Sdk.CreateOrUpdateNetwork => {
	if (body.management !== "GATEWAY") return body;
	const dhcp = body.ipv4Configuration.dhcpConfiguration;
	return {
		...body,
		mdnsForwardingEnabled: body.mdnsForwardingEnabled ?? true,
		ipv4Configuration: {
			...body.ipv4Configuration,
			...(dhcp?.mode === "SERVER" ? { dhcpConfiguration: { ...dhcp, domainName: dhcp.domainName ?? "" } } : {}),
		},
	};
};

/** The request body for `props`, with references resolved to IDs. */
const toBody = Effect.fn(function* (props: NetworkProps, site: Site) {
	switch (props.management) {
		case "GATEWAY": {
			const { site: _site, zone, ...rest } = props;
			if (zone === undefined) return rest satisfies Sdk.CreateOrUpdateNetwork;
			const zoneId = yield* resolveFirewallZone(zone, site);
			return { ...rest, zoneId } satisfies Sdk.CreateOrUpdateNetwork;
		}
		case "SWITCH": {
			const { site: _site, device, ...rest } = props;
			return { ...rest, deviceId: device.deviceId } satisfies Sdk.CreateOrUpdateNetwork;
		}
		case "UNMANAGED": {
			const { site: _site, ...rest } = props;
			return rest satisfies Sdk.CreateOrUpdateNetwork;
		}
	}
});

/** The network ID a reference means in `site`. */
export const resolveNetwork = (reference: NetworkReference, site: Site) =>
	checkSameSite("network", reference.siteId, site).pipe(Effect.as(reference.networkId));

const getNetwork = (siteId: string, networkId: string) =>
	withConnection(Sdk.getNetworkDetails({ siteId, networkId })).pipe(
		Effect.catchTag("NotFound", () => Effect.undefined),
	);

/** The attributes of a network known to exist (e.g. from a list). */
const attributesOf = (siteId: string, networkId: string) =>
	withConnection(Sdk.getNetworkDetails({ siteId, networkId })).pipe(
		Effect.map((network) => toAttributes(siteId, network)),
	);

const isUserDefined = (network: Sdk.NetworkOverview) => network.metadata.origin === "USER_DEFINED";

/**
 * A network (VLAN). `management` picks the kind: `"GATEWAY"` (routed by the
 * gateway), `"SWITCH"` (routed by a layer-3 switch) or `"UNMANAGED"`.
 * Changing it, or the site, replaces the network: the old one is deleted
 * first, since VLAN IDs must be unique.
 *
 * Props are authoritative: every update sends the whole network, with
 * explicit defaults for unset fields (`mdnsForwardingEnabled: true`, and a
 * DHCP server's `domainName: ""`), so changes made in the UI are put back.
 * The `config` attribute mirrors the console's object, so `alchemy drift`
 * sees them.
 * Existing networks are adopted by VLAN ID
 * with `--adopt` (and renamed to match), including the site's default
 * network (VLAN 1), which is never deleted or replaced.
 *
 * @example
 * ```ts
 * yield* UnifiNetwork.Network("guest", {
 *   management: "GATEWAY",
 *   name: "Guest",
 *   vlanId: 12,
 *   enabled: true,
 *   cellularBackupEnabled: false,
 *   internetAccessEnabled: true,
 *   isolationEnabled: true,
 *   zone: UnifiNetwork.FirewallZone.HOTSPOT,
 *   ipv4Configuration: { autoScaleEnabled: false, hostIpAddress: "192.168.12.1", prefixLength: 24 },
 * });
 * ```
 */
export const Network = Resource<Network>("UnifiNetwork.Network")({
	/**
	 * A network in the site by name or VLAN ID. Dies with a user-facing
	 * `LookupNotFound` or `LookupAmbiguous`: stack bodies can't fail with typed
	 * errors.
	 */
	lookup: Effect.fn("UnifiNetwork.Network.lookup")(function* (
		query: ({ readonly name: string } | { readonly vlanId: number }) & { readonly site?: string },
	) {
		const site = yield* resolveSite(query.site);
		const networks = (yield* listNetworks(site.id)).filter((n) =>
			"vlanId" in query ? n.vlanId === query.vlanId : n.name === query.name,
		);
		const [network] = networks;
		if (network === undefined) {
			return yield* new LookupNotFound({ resource: "network", query: describeQuery(query), site });
		}
		if (networks.length > 1) {
			return yield* new LookupAmbiguous({
				resource: "network",
				query: describeQuery(query),
				site,
				count: networks.length,
			});
		}
		return yield* attributesOf(site.id, network.id);
	}, Effect.orDie),
});

export const NetworkProvider = () =>
	Provider.effect(
		Network,
		Effect.gen(function* () {
			const run = yield* captureServices;

			return Network.Provider.of({
				list: () =>
					run(
						Effect.gen(function* () {
							const site = yield* resolveSite();
							const networks = yield* listNetworks(site.id);
							return yield* Effect.forEach(networks.filter(isUserDefined), (network) =>
								attributesOf(site.id, network.id),
							);
						}),
					),

				read: ({ olds, output }) =>
					run(
						Effect.gen(function* () {
							if (output !== undefined) {
								const network = yield* getNetwork(output.siteId, output.networkId);
								return network === undefined ? undefined : toAttributes(output.siteId, network);
							}
							const site = yield* resolveSite(olds.site);
							// VLAN IDs are unique per site, so the VLAN alone identifies the network, and adopting renames it.
							const network = (yield* listNetworks(site.id)).find((n) => n.vlanId === olds.vlanId);
							return network === undefined
								? undefined
								: Unowned(yield* attributesOf(site.id, network.id));
						}),
					),

				diff: ({ news, output }) =>
					run(
						Effect.gen(function* () {
							if (output === undefined) return undefined;
							const replace = (reason: string) =>
								output.default
									? Effect.fail(new DefaultNetworkReplacement({ networkName: output.name, reason }))
									: Effect.succeed({ action: "replace", deleteFirst: true } satisfies Diff);
							const management = planned(news, "management");
							if (management !== UNKNOWN && management !== output.management) {
								return yield* replace(`its management would change to ${String(management)}`);
							}
							const siteProp = plannedString(news, "site");
							if (siteProp === UNKNOWN) return undefined;
							const site = yield* resolveSite(siteProp);
							if (site.id !== output.siteId)
								return yield* replace(`it would move to site ${site.internalReference}`);
							return undefined;
						}),
					),

				reconcile: ({ news, output }) =>
					run(
						Effect.gen(function* () {
							const site = yield* resolveSite(news.site);
							const body = withDefaults(yield* toBody(news, site));
							const observed =
								output !== undefined && output.siteId === site.id
									? yield* getNetwork(site.id, output.networkId)
									: undefined;
							const write = ReadCache.invalidating(networksKey, site.id);
							if (observed === undefined) {
								const created = yield* withConnection(
									Sdk.createNetwork({ siteId: site.id, body }),
								).pipe(write);
								return yield* attributesOf(site.id, created.id);
							}
							if (isCurrent(body, omitKeys(observed, READ_ONLY))) return toAttributes(site.id, observed);
							yield* withConnection(
								Sdk.updateNetwork({ siteId: site.id, networkId: observed.id, body }),
							).pipe(write);
							return yield* attributesOf(site.id, observed.id);
						}),
					),

				delete: ({ output }) =>
					output.default
						? Effect.logInfo(`Leaving ${output.name}, the site's default network, in place.`)
						: run(
								withConnection(
									Sdk.deleteNetwork({ siteId: output.siteId, networkId: output.networkId }),
								).pipe(
									Effect.asVoid,
									Effect.catchTag("NotFound", () => Effect.void),
									ReadCache.invalidating(networksKey, output.siteId),
								),
							),
			});
		}),
	);
