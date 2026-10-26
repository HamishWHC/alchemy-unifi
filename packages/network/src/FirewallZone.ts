import * as Sdk from "@alchemy-unifi/network-sdk";
import { Unowned } from "alchemy/AdoptPolicy";
import type { Diff } from "alchemy/Diff";
import * as Provider from "alchemy/Provider";
import { Resource } from "alchemy/Resource";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { withConnection } from "./Connection.ts";
import { loadNetworks, retryAfterNetworkDelete } from "./internal/Networks.ts";
import { plannedString, UNKNOWN } from "./internal/Plan.ts";
import { captureServices } from "./internal/Services.ts";
import { describeQuery, LookupNotFound } from "./Lookup.ts";
import type { Providers } from "./Providers.ts";
import * as ReadCache from "./ReadCache.ts";
import { checkSameSite, resolveSite, type Site } from "./Site.ts";

/** The zones every zone-based firewall has, by their API names. */
export type BuiltinFirewallZoneName = "Internal" | "External" | "Gateway" | "Vpn" | "Hotspot" | "Dmz";

/** A built-in zone, resolved by name in whichever site the referencing resource is in. */
export interface BuiltinFirewallZone {
	readonly builtinFirewallZone: BuiltinFirewallZoneName;
}

/**
 * A zone: a `FirewallZone` resource, a {@link FirewallZone.lookup} result,
 * `{ firewallZoneId }`, or a built-in constant such as `FirewallZone.INTERNAL`.
 */
export type FirewallZoneReference =
	| { readonly firewallZoneId: string; readonly siteId?: string | undefined }
	| BuiltinFirewallZone;

export interface FirewallZoneProps {
	/** Site to create the zone in. @default the profile's site, else the console's only site */
	site?: string;
	name: string;
}

export interface FirewallZoneAttributes {
	siteId: string;
	firewallZoneId: string;
	name: string;
}

export interface FirewallZone extends Resource<
	"UnifiNetwork.FirewallZone",
	FirewallZoneProps,
	FirewallZoneAttributes,
	never,
	Providers
> {}

const loadZones = (siteId: string) => withConnection(Stream.runCollect(Sdk.getFirewallZones.items({ siteId })));
const zonesKey = ReadCache.key<ReadonlyArray<Sdk.FirewallZone>, Effect.Error<ReturnType<typeof loadZones>>>(
	"firewallZones",
);

/** A site's zones, built-in ones included, listed once per run. */
export const listFirewallZones = (siteId: string) => ReadCache.cached(zonesKey, siteId, loadZones(siteId));

const toAttributes = (siteId: string, zone: Sdk.FirewallZone): FirewallZoneAttributes => ({
	siteId,
	firewallZoneId: zone.id,
	name: zone.name,
});

const isBuiltin = (zone: Sdk.FirewallZone) => zone.metadata.origin === "SYSTEM_DEFINED";

/** The zone ID a reference means in `site`. */
export const resolveFirewallZone = Effect.fn("UnifiNetwork.resolveFirewallZone")(function* (
	reference: FirewallZoneReference,
	site: Site,
) {
	if ("firewallZoneId" in reference) {
		yield* checkSameSite("firewall zone", reference.siteId, site);
		return reference.firewallZoneId;
	}
	const zones = yield* listFirewallZones(site.id);
	const zone = zones.find((z) => isBuiltin(z) && z.name === reference.builtinFirewallZone);
	if (zone === undefined) {
		return yield* new LookupNotFound({
			resource: "built-in firewall zone",
			query: `name "${reference.builtinFirewallZone}" (has the site been migrated to zone-based firewall?)`,
			site,
		});
	}
	return zone.id;
});

const builtin = (name: BuiltinFirewallZoneName): BuiltinFirewallZone => ({ builtinFirewallZone: name });

/**
 * A custom zone in the zone-based firewall. Networks join zones through
 * `Network`'s `zone` prop; the zone doesn't list its networks, so the two
 * resources never fight over membership.
 *
 * @example
 * ```ts
 * const cameras = yield* UnifiNetwork.FirewallZone("cameras", { name: "Cameras" });
 * yield* UnifiNetwork.Network("cctv", { ..., zone: cameras });
 * yield* UnifiNetwork.Network("lan", { ..., zone: UnifiNetwork.FirewallZone.INTERNAL });
 * ```
 */
export const FirewallZone = Resource<FirewallZone>("UnifiNetwork.FirewallZone")({
	INTERNAL: builtin("Internal"),
	EXTERNAL: builtin("External"),
	GATEWAY: builtin("Gateway"),
	VPN: builtin("Vpn"),
	HOTSPOT: builtin("Hotspot"),
	DMZ: builtin("Dmz"),
	/**
	 * Any zone in the site, built-in or custom, by name. Dies with a
	 * user-facing `LookupNotFound` if there's none: stack bodies can't fail
	 * with typed errors.
	 */
	lookup: Effect.fn("UnifiNetwork.FirewallZone.lookup")(function* (query: {
		readonly name: string;
		readonly site?: string;
	}) {
		const site = yield* resolveSite(query.site);
		const zone = (yield* listFirewallZones(site.id)).find((z) => z.name === query.name);
		if (zone === undefined) {
			return yield* new LookupNotFound({ resource: "firewall zone", query: describeQuery(query), site });
		}
		return toAttributes(site.id, zone);
	}, Effect.orDie),
});

const getZone = (siteId: string, firewallZoneId: string) =>
	withConnection(Sdk.getFirewallZone({ siteId, firewallZoneId })).pipe(
		Effect.catchTag("NotFound", () => Effect.undefined),
	);

/**
 * The networks in a zone, from the networks' own `zoneId`s. Updates replace
 * a zone's member list, and the zone's `networkIds` lags a network joining
 * it by a fraction of a second, so sending those back could detach a
 * network that just joined.
 */
const currentMembers = (siteId: string, firewallZoneId: string) =>
	loadNetworks(siteId).pipe(
		Effect.map((networks) => networks.filter((n) => "zoneId" in n && n.zoneId === firewallZoneId).map((n) => n.id)),
	);

export const FirewallZoneProvider = () =>
	Provider.effect(
		FirewallZone,
		Effect.gen(function* () {
			const run = yield* captureServices;

			return FirewallZone.Provider.of({
				list: () =>
					run(
						Effect.gen(function* () {
							const site = yield* resolveSite();
							const zones = yield* listFirewallZones(site.id);
							return zones.filter((zone) => !isBuiltin(zone)).map((zone) => toAttributes(site.id, zone));
						}),
					),

				read: ({ olds, output }) =>
					run(
						Effect.gen(function* () {
							if (output !== undefined) {
								const zone = yield* getZone(output.siteId, output.firewallZoneId);
								return zone === undefined ? undefined : toAttributes(output.siteId, zone);
							}
							const site = yield* resolveSite(olds.site);
							const zone = (yield* listFirewallZones(site.id)).find(
								(z) => !isBuiltin(z) && z.name === olds.name,
							);
							return zone === undefined ? undefined : Unowned(toAttributes(site.id, zone));
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
							const observed =
								output !== undefined && output.siteId === site.id
									? yield* getZone(site.id, output.firewallZoneId)
									: undefined;
							const write = ReadCache.invalidating(zonesKey, site.id);
							if (observed === undefined) {
								const created = yield* withConnection(
									Sdk.createFirewallZone({ siteId: site.id, name: news.name, networkIds: [] }),
								).pipe(write);
								return toAttributes(site.id, created);
							}
							if (observed.name === news.name) return toAttributes(site.id, observed);
							const updated = yield* withConnection(
								Sdk.updateFirewallZone({
									siteId: site.id,
									firewallZoneId: observed.id,
									name: news.name,
									networkIds: yield* currentMembers(site.id, observed.id),
								}),
							).pipe(write);
							return toAttributes(site.id, updated);
						}),
					),

				delete: ({ output }) =>
					run(
						withConnection(
							Sdk.deleteFirewallZone({ siteId: output.siteId, firewallZoneId: output.firewallZoneId }),
						).pipe(
							// Fails for a moment after the zone's networks are deleted.
							retryAfterNetworkDelete,
							Effect.asVoid,
							Effect.catchTag("NotFound", () => Effect.void),
							ReadCache.invalidating(zonesKey, output.siteId),
						),
					),
			});
		}),
	);
