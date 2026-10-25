import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Redacted from "effect/Redacted";

export interface Config {
	/** e.g. `https://192.168.1.1/proxy/network/integration` or the connector URL. */
	readonly baseUrl: string;
	readonly apiKey: Redacted.Redacted<string>;
}

export class Credentials extends Context.Service<Credentials, Effect.Effect<Config>>()("UnifiNetworkCredentials") {}
