import { CredentialsStoreLive } from "alchemy/Auth/Credentials";
import { ProfileStoreLive } from "alchemy/Auth/Profile";
import * as Provider from "alchemy/Provider";
import * as Layer from "effect/Layer";
import { UnifiNetworkAuth } from "./AuthProvider.ts";
import * as Connection from "./Connection.ts";
import * as Credentials from "./Credentials.ts";

export class Providers extends Provider.ProviderCollection<Providers>()("UnifiNetwork") {}

/**
 * Registers every UniFi Network resource provider, the `UnifiNetwork` auth
 * provider, and the lazily-resolved credentials and connection. Merge
 * alongside other cloud `providers()` layers in a Stack.
 *
 * Unlike most providers this doesn't provide an `HttpClient`: ours carries
 * the console's TLS settings, and lifecycle operations run in the stack's
 * merged context, so it would replace other providers' clients. SDK calls
 * get it through `UnifiNetworkConnection` instead.
 */
export const providers = () =>
	Layer.effect(Providers, Provider.collection([])).pipe(
		Layer.provideMerge(Connection.layer),
		Layer.provideMerge(Credentials.fromAuthProvider()),
		Layer.provideMerge(UnifiNetworkAuth),
		Layer.provideMerge(ProfileStoreLive),
		Layer.provideMerge(CredentialsStoreLive),
		Layer.orDie,
	);
