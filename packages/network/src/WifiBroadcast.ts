import * as Sdk from "@alchemy-unifi/network-sdk";
import { Unowned } from "alchemy/AdoptPolicy";
import type { Diff } from "alchemy/Diff";
import * as Provider from "alchemy/Provider";
import { Resource } from "alchemy/Resource";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { withConnection } from "./Connection.ts";
import { type DistributiveOmit, isCurrent, omitKeys } from "./internal/Fields.ts";
import { planned, plannedString, UNKNOWN } from "./internal/Plan.ts";
import { captureServices } from "./internal/Services.ts";
import { describeQuery, LookupAmbiguous, LookupNotFound } from "./Lookup.ts";
import { type NetworkReference, resolveNetwork } from "./Network.ts";
import type { Providers } from "./Providers.ts";
import * as ReadCache from "./ReadCache.ts";
import { resolveSite, type Site } from "./Site.ts";

/** The site's native (untagged) network. */
export interface NativeNetwork {
	readonly type: "NATIVE";
}

interface CommonProps {
	/** Site to create the broadcast in. @default the profile's site, else the console's only site */
	site?: string;
	/**
	 * The network clients join: a network reference, or
	 * `WifiBroadcast.NATIVE_NETWORK` for the site's default network (a
	 * `Network` resource or lookup for the default network works too).
	 */
	network?: NetworkReference | NativeNetwork;
}

/** WPA security on a standard broadcast must set `fastRoamingEnabled` (the console rejects it otherwise). */
type WithFastRoaming<S> = S extends { fastRoamingEnabled?: boolean } ? S & { fastRoamingEnabled: boolean } : S;

export type StandardWifiSecurityConfiguration = WithFastRoaming<Sdk.WifiSecurityConfigurationDetailObject>;

/**
 * An ordinary SSID. Pass passphrases as `Redacted` (e.g. from
 * `Config.Redacted`) to keep them out of logs.
 */
export interface StandardWifiBroadcastProps
	extends
		Omit<Sdk.IntegrationStandardWifiBroadcastCreateUpdateDto, "network" | "securityConfiguration">,
		CommonProps {
	securityConfiguration: StandardWifiSecurityConfiguration;
}

/** An SSID tuned for IoT devices (2.4 GHz only, longer DTIM). */
export interface IotWifiBroadcastProps
	extends Omit<Sdk.IntegrationIotOptimizedWifiBroadcastCreateUpdateDto, "network">, CommonProps {}

/** Props are the Integration API's Wi-Fi body, plus `site` and references; `type` picks the kind. */
export type WifiBroadcastProps = StandardWifiBroadcastProps | IotWifiBroadcastProps;

export interface WifiBroadcastAttributes {
	siteId: string;
	wifiBroadcastId: string;
	name: string;
	type: WifiBroadcastProps["type"];
	/** The network clients join, when it isn't the native one. */
	networkId: string | undefined;
	/** The whole broadcast as the console reports it (passphrases `Redacted`), so `alchemy drift` sees any change. */
	config: DistributiveOmit<Sdk.WifiBroadcastDetails, "id" | "metadata">;
}

export interface WifiBroadcast extends Resource<
	"UnifiNetwork.WifiBroadcast",
	WifiBroadcastProps,
	WifiBroadcastAttributes,
	never,
	Providers
> {}

const loadBroadcasts = (siteId: string) =>
	withConnection(Stream.runCollect(Sdk.getWifiBroadcastPage.items({ siteId })));
const broadcastsKey = ReadCache.key<
	ReadonlyArray<Sdk.WifiBroadcastOverview>,
	Effect.Error<ReturnType<typeof loadBroadcasts>>
>("wifiBroadcasts");

/** A site's Wi-Fi broadcasts, listed once per run. */
export const listWifiBroadcasts = (siteId: string) => ReadCache.cached(broadcastsKey, siteId, loadBroadcasts(siteId));

const toAttributes = (siteId: string, broadcast: Sdk.WifiBroadcastDetails): WifiBroadcastAttributes => {
	const { id, metadata: _metadata, ...config } = broadcast;
	return {
		siteId,
		wifiBroadcastId: id,
		name: broadcast.name,
		type: broadcast.type,
		networkId: broadcast.network?.type === "SPECIFIC" ? broadcast.network.networkId : undefined,
		config,
	};
};

const byFrequency = (bands: ReadonlyArray<number>) => bands.toSorted((a, b) => a - b);

/**
 * `body` with its bands sorted (their order means nothing; see
 * {@link comparable}), and an explicit value for the one unset field that
 * can't simply be left out (verified): a standard broadcast's
 * `bandSteeringEnabled`, which the console reports as `false` when unset,
 * so without the default the body would never match and every deploy would
 * update it (and drift would report it) forever.
 */
const withDefaults = (body: Sdk.WifiBroadcastCreateOrUpdate): Sdk.WifiBroadcastCreateOrUpdate =>
	body.type === "STANDARD"
		? {
				...body,
				bandSteeringEnabled: body.bandSteeringEnabled ?? false,
				broadcastingFrequenciesGHz: byFrequency(body.broadcastingFrequenciesGHz),
			}
		: body;

/** Fields the console reports but rejects in request bodies. */
const READ_ONLY = ["id", "metadata"];

const toBody = Effect.fn(function* (props: WifiBroadcastProps, site: Site) {
	const { site: _site, network, ...rest } = props;
	if (network === undefined) return rest satisfies Sdk.WifiBroadcastCreateOrUpdate;
	// The console only accepts the default network as NATIVE; referencing it by ID is rejected.
	if ("type" in network || network.default === true) {
		return { ...rest, network: { type: "NATIVE" } } satisfies Sdk.WifiBroadcastCreateOrUpdate;
	}
	const networkId = yield* resolveNetwork(network, site);
	return { ...rest, network: { type: "SPECIFIC", networkId } } satisfies Sdk.WifiBroadcastCreateOrUpdate;
});

/**
 * The console's broadcast in body form, with its bands sorted: consoles keep
 * them in an order of their own (not the one sent; the test controller
 * sorts them), so order mustn't count as a difference.
 */
const comparable = (observed: Sdk.WifiBroadcastDetails) => {
	const body = omitKeys(observed, READ_ONLY);
	return observed.type === "STANDARD"
		? { ...body, broadcastingFrequenciesGHz: byFrequency(observed.broadcastingFrequenciesGHz) }
		: body;
};

const getBroadcast = (siteId: string, wifiBroadcastId: string) =>
	withConnection(Sdk.getWifiBroadcastDetails({ siteId, wifiBroadcastId })).pipe(
		Effect.catchTag("NotFound", () => Effect.undefined),
	);

/** The attributes of a broadcast known to exist (e.g. from a list). */
const attributesOf = (siteId: string, wifiBroadcastId: string) =>
	withConnection(Sdk.getWifiBroadcastDetails({ siteId, wifiBroadcastId })).pipe(
		Effect.map((broadcast) => toAttributes(siteId, broadcast)),
	);

const NATIVE_NETWORK: NativeNetwork = { type: "NATIVE" };

/**
 * A Wi-Fi network (SSID). `type` is `"STANDARD"` or `"IOT_OPTIMIZED"`.
 * Existing broadcasts are adopted by SSID with `--adopt`.
 *
 * :::caution
 * Changing `type` or `site` replaces the broadcast, so devices reconnect.
 * :::
 *
 * ### Creating a broadcast
 *
 * `network` is a network reference, or `WifiBroadcast.NATIVE_NETWORK` for the
 * site's default network. A reference to the default network (like `lan`
 * below) works too.
 *
 * **Example:** A WPA2 network on the default network
 *
 * ```ts
 * import * as UnifiNetwork from "@alchemy-unifi/network";
 * import * as Alchemy from "alchemy";
 * import * as Config from "effect/Config";
 * import * as Effect from "effect/Effect";
 *
 * export default Alchemy.Stack(
 * 	"HomeNetwork",
 * 	{ providers: UnifiNetwork.providers(), state: UnifiNetwork.state() },
 * 	Effect.gen(function* () {
 * 		const lan = yield* UnifiNetwork.Network.lookup({ vlanId: 1 });
 * 		yield* UnifiNetwork.WifiBroadcast("home", {
 * 			type: "STANDARD",
 * 			name: "Home",
 * 			enabled: true,
 * 			network: lan,
 * 			securityConfiguration: {
 * 				type: "WPA2_PERSONAL",
 * 				passphrase: yield* Config.Redacted("WIFI_PASSPHRASE"),
 * 				fastRoamingEnabled: false,
 * 			},
 * 			broadcastingFrequenciesGHz: [2.4, 5],
 * 			hideName: false,
 * 			clientIsolationEnabled: false,
 * 			multicastToUnicastConversionEnabled: false,
 * 			uapsdEnabled: false,
 * 			channel2gLockedTo6: false,
 * 			dtimPeriod2gLockedTo3: false,
 * 			advertiseDeviceName: false,
 * 			arpProxyEnabled: false,
 * 			bssTransitionEnabled: true,
 * 		});
 * 	}),
 * );
 * ```
 *
 * ### Security
 *
 * :::caution
 * The console requires more than the API spec says, and the types enforce it:
 *
 * - Standard broadcasts with WPA security must set `fastRoamingEnabled`.
 * - Open security and WPA2/WPA3 personal need a `network`.
 * - WPA2 personal needs either `presharedKeys`, or both a `network` and a
 *   `passphrase`.
 * - `mloEnabled` is only accepted (even as `false`) with WPA3 on several bands.
 * :::
 *
 * ### Passphrases
 *
 * Read passphrases from config as `Redacted`, as above, to keep them out of
 * logs and plans.
 *
 * :::caution
 * Passphrases are stored in plaintext in Alchemy's state, as every prop is.
 * The console returns them, so `alchemy drift` sees one changed in the UI.
 * :::
 *
 * ### Looking up a broadcast
 *
 * `WifiBroadcast.lookup({ name })` finds a broadcast the stack uses but
 * doesn't manage.
 *
 * **Example:** An SSID made in the UI
 *
 * ```ts
 * import * as UnifiNetwork from "@alchemy-unifi/network";
 * import * as Effect from "effect/Effect";
 *
 * export const guestWifi = Effect.gen(function* () {
 * 	const broadcast = yield* UnifiNetwork.WifiBroadcast.lookup({ name: "Guests" });
 * 	return broadcast.wifiBroadcastId;
 * });
 * ```
 *
 * ### Changes made in the UI
 *
 * Props are authoritative: every update sends the whole broadcast, with
 * explicit defaults for unset fields (a standard broadcast's
 * `bandSteeringEnabled: false`), so changes made in the UI, passphrases
 * included, are put back. The `config` attribute mirrors the console's
 * object, so `alchemy drift` sees them.
 *
 * :::note
 * Enterprise security's `radiusConfiguration` is untyped, and device filters
 * and mDNS policies still take raw device and network IDs.
 * :::
 *
 * @resource
 */
export const WifiBroadcast = Resource<WifiBroadcast>("UnifiNetwork.WifiBroadcast")({
	NATIVE_NETWORK,
	/**
	 * A broadcast in the site by name. Dies with a user-facing
	 * `LookupNotFound` or `LookupAmbiguous`: stack bodies can't fail with typed
	 * errors.
	 */
	lookup: Effect.fn("UnifiNetwork.WifiBroadcast.lookup")(function* (query: {
		readonly name: string;
		readonly site?: string;
	}) {
		const site = yield* resolveSite(query.site);
		const broadcasts = (yield* listWifiBroadcasts(site.id)).filter((b) => b.name === query.name);
		const [broadcast] = broadcasts;
		if (broadcast === undefined) {
			return yield* new LookupNotFound({ resource: "Wi-Fi broadcast", query: describeQuery(query), site });
		}
		if (broadcasts.length > 1) {
			return yield* new LookupAmbiguous({
				resource: "Wi-Fi broadcast",
				query: describeQuery(query),
				site,
				count: broadcasts.length,
			});
		}
		return yield* attributesOf(site.id, broadcast.id);
	}, Effect.orDie),
});

export const WifiBroadcastProvider = () =>
	Provider.effect(
		WifiBroadcast,
		Effect.gen(function* () {
			const run = yield* captureServices;

			return WifiBroadcast.Provider.of({
				list: () =>
					run(
						Effect.gen(function* () {
							const site = yield* resolveSite();
							const broadcasts = yield* listWifiBroadcasts(site.id);
							return yield* Effect.forEach(
								broadcasts.filter((b) => b.metadata.origin === "USER_DEFINED"),
								(b) => attributesOf(site.id, b.id),
							);
						}),
					),

				read: ({ olds, output }) =>
					run(
						Effect.gen(function* () {
							if (output !== undefined) {
								const broadcast = yield* getBroadcast(output.siteId, output.wifiBroadcastId);
								return broadcast === undefined ? undefined : toAttributes(output.siteId, broadcast);
							}
							const site = yield* resolveSite(olds.site);
							const matching = (yield* listWifiBroadcasts(site.id)).filter((b) => b.name === olds.name);
							const [broadcast] = matching;
							return broadcast === undefined || matching.length > 1
								? undefined
								: Unowned(yield* attributesOf(site.id, broadcast.id));
						}),
					),

				diff: ({ news, output }) =>
					run(
						Effect.gen(function* () {
							if (output === undefined) return undefined;
							const type = planned(news, "type");
							if (type !== UNKNOWN && type !== output.type) return { action: "replace" } satisfies Diff;
							const siteProp = plannedString(news, "site");
							if (siteProp === UNKNOWN) return undefined;
							const site = yield* resolveSite(siteProp);
							if (site.id !== output.siteId) return { action: "replace" } satisfies Diff;
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
									? yield* getBroadcast(site.id, output.wifiBroadcastId)
									: undefined;
							const write = ReadCache.invalidating(broadcastsKey, site.id);
							if (observed === undefined) {
								const created = yield* withConnection(
									Sdk.createWifiBroadcast({ siteId: site.id, body }),
								).pipe(write);
								return toAttributes(site.id, created);
							}
							if (isCurrent(body, comparable(observed))) return toAttributes(site.id, observed);
							const updated = yield* withConnection(
								Sdk.updateWifiBroadcast({ siteId: site.id, wifiBroadcastId: observed.id, body }),
							).pipe(write);
							return toAttributes(site.id, updated);
						}),
					),

				delete: ({ output }) =>
					run(
						withConnection(
							Sdk.deleteWifiBroadcast({ siteId: output.siteId, wifiBroadcastId: output.wifiBroadcastId }),
						).pipe(
							Effect.asVoid,
							Effect.catchTag("NotFound", () => Effect.void),
							ReadCache.invalidating(broadcastsKey, output.siteId),
						),
					),
			});
		}),
	);
