import * as Provider from "alchemy/Provider";
import * as Layer from "effect/Layer";

export class Providers extends Provider.ProviderCollection<Providers>()("UnifiNetwork") {}

/**
 * Registers every UniFi Network resource provider. Merge alongside other
 * cloud `providers()` layers in a Stack.
 *
 * TODO: provide the auth provider, credentials bridge and HTTP client once
 * they exist.
 */
export const providers = () => Layer.effect(Providers, Provider.collection([]));
