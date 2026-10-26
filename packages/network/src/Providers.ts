import * as Provider from "alchemy/Provider";
import * as Layer from "effect/Layer";
import { UnifiNetworkAuth } from "./AuthProvider.ts";
import * as Connection from "./Connection.ts";
import * as Credentials from "./Credentials.ts";
import { DnsPolicy, DnsPolicyProvider } from "./DnsPolicy.ts";
import { FirewallPolicy, FirewallPolicyProvider } from "./FirewallPolicy.ts";
import { FirewallPolicyOrdering, FirewallPolicyOrderingProvider } from "./FirewallPolicyOrdering.ts";
import { FirewallZone, FirewallZoneProvider } from "./FirewallZone.ts";
import { Network, NetworkProvider } from "./Network.ts";
import { TrafficMatchingList, TrafficMatchingListProvider } from "./TrafficMatchingList.ts";
import { WifiBroadcast, WifiBroadcastProvider } from "./WifiBroadcast.ts";
import * as ReadCache from "./ReadCache.ts";

export class Providers extends Provider.ProviderCollection<Providers>()("UnifiNetwork") {}

/**
 * Registers every UniFi Network resource provider, the `UnifiNetwork` auth
 * provider, the lazily-resolved credentials and connection, and the per-run
 * read cache. Merge
 * alongside other cloud `providers()` layers in a Stack.
 *
 * Its requirements (`AuthProviders`, `ProfileStore`, `FileSystem`, `Path`)
 * come from Alchemy's runtime; it provides only its own services.
 *
 * Unlike most providers this doesn't provide an `HttpClient`: ours carries
 * the console's TLS settings, and lifecycle operations run in the stack's
 * merged context, so it would replace other providers' clients. SDK calls
 * get it through `UnifiNetworkConnection` instead.
 */
export const providers = () =>
	Layer.effect(
		Providers,
		Provider.collection([
			FirewallZone,
			Network,
			WifiBroadcast,
			TrafficMatchingList,
			FirewallPolicy,
			FirewallPolicyOrdering,
			DnsPolicy,
		]),
	).pipe(
		Layer.provide(
			Layer.mergeAll(
				FirewallZoneProvider(),
				NetworkProvider(),
				WifiBroadcastProvider(),
				TrafficMatchingListProvider(),
				FirewallPolicyProvider(),
				FirewallPolicyOrderingProvider(),
				DnsPolicyProvider(),
			),
		),
		Layer.provideMerge(Layer.merge(Connection.layer, ReadCache.layer)),
		Layer.provideMerge(Credentials.fromAuthProvider()),
		Layer.provideMerge(UnifiNetworkAuth),
		Layer.orDie,
	);
