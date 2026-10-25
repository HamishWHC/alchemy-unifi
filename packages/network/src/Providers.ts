import * as Provider from "alchemy/Provider";
import * as Layer from "effect/Layer";
import { UnifiNetworkAuth } from "./AuthProvider.ts";
import * as Connection from "./Connection.ts";
import * as Credentials from "./Credentials.ts";
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
	Layer.effect(Providers, Provider.collection([])).pipe(
		Layer.provideMerge(Layer.merge(Connection.layer, ReadCache.layer)),
		Layer.provideMerge(Credentials.fromAuthProvider()),
		Layer.provideMerge(UnifiNetworkAuth),
		Layer.orDie,
	);
