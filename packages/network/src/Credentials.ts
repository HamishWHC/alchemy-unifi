import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Redacted from "effect/Redacted";

/** A console reached directly, e.g. `https://192.168.1.1`. */
export interface LocalConnection {
	readonly type: "local";
	readonly url: string;
	readonly apiKey: Redacted.Redacted<string>;
	/** Skip TLS verification for the console's self-signed certificate. */
	readonly insecure: boolean;
}

/** A console reached through the `api.ui.com` cloud connector. */
export interface RemoteConnection {
	readonly type: "remote";
	readonly consoleId: string;
	readonly apiKey: Redacted.Redacted<string>;
}

export type Connection = LocalConnection | RemoteConnection;

export interface ResolvedCredentials {
	readonly connection: Connection;
	/** Site used by resources that don't set `site`, by internal reference (e.g. `default`). */
	readonly site: string;
}

/**
 * Lazily-resolved credentials for the active profile. The service value is
 * an Effect so nothing resolves at Layer construction; handlers run
 * `yield* yield* UnifiNetworkCredentials`.
 */
export class UnifiNetworkCredentials extends Context.Service<
	UnifiNetworkCredentials,
	Effect.Effect<ResolvedCredentials>
>()("UnifiNetwork::Credentials") {}
