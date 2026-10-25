import { ConfigError } from "@alchemy-unifi/network-sdk";
import { deferUntilFirstUse, orDieCredentialsUnavailable, resolveProviderConfig } from "alchemy/Auth/Resolve";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Redacted from "effect/Redacted";
import { UNIFI_NETWORK_AUTH_PROVIDER_NAME, type UnifiNetworkAuthConfig } from "./AuthConfig.ts";

/** A console or self-hosted controller reached directly, e.g. `https://192.168.1.1`. */
export interface LocalConnection {
	readonly type: "local";
	/** Origin of the console, without the Integration API path. */
	readonly url: string;
	readonly apiKey: Redacted.Redacted<string>;
	/**
	 * Accept the server only if a certificate in its chain has this SHA-256
	 * fingerprint (`AB:CD:…`), whether or not Node trusts it.
	 */
	readonly certFingerprint?: string | undefined;
	/** Skip TLS verification entirely. */
	readonly insecure: boolean;
}

/** A console reached through the `api.ui.com` cloud connector. */
export interface RemoteConnection {
	readonly type: "remote";
	readonly consoleId: string;
	readonly apiKey: Redacted.Redacted<string>;
}

export type Connection = LocalConnection | RemoteConnection;

/** Where credentials came from: a named Alchemy profile, or `UNIFI_*` environment variables. */
export type CredentialsSource = { readonly type: "profile"; readonly profile: string } | { readonly type: "env" };

export interface ResolvedCredentials {
	readonly connection: Connection;
	/**
	 * Site used by resources that don't set `site`, by internal reference
	 * (e.g. `default`) or name. Unset means the console's only site; it's only
	 * needed on consoles hosting several.
	 */
	readonly site?: string | undefined;
	readonly source: CredentialsSource;
}

/**
 * Lazily-resolved credentials for the active profile (or the environment).
 * The service value is an Effect so nothing resolves at Layer construction;
 * handlers run `yield* yield* UnifiNetworkCredentials`.
 */
export class UnifiNetworkCredentials extends Context.Service<
	UnifiNetworkCredentials,
	Effect.Effect<ResolvedCredentials>
>()("UnifiNetwork::Credentials") {
	/** Alchemy's tag for credentials services, which lets stack bodies require this one. */
	declare readonly kind: "Credentials";
}

/**
 * Resolves {@link UnifiNetworkCredentials} through the `UnifiNetwork` auth
 * provider: environment variables when they're all set, otherwise the
 * selected Alchemy profile. Resolution is deferred to first use and cached.
 */
export const fromAuthProvider = () =>
	Layer.effect(
		UnifiNetworkCredentials,
		Effect.gen(function* () {
			const deferred = yield* resolveProviderConfig<UnifiNetworkAuthConfig, ResolvedCredentials>(
				UNIFI_NETWORK_AUTH_PROVIDER_NAME,
			).pipe(
				Effect.flatMap(({ profileName, resolve }) =>
					resolve.pipe(
						Effect.mapError((e: { readonly message: string }) =>
							ConfigError.make({
								message: `Failed to resolve UniFi Network credentials from ${profileName === undefined ? "the environment" : `profile '${profileName}'`}: ${e.message}`,
							}),
						),
					),
				),
				deferUntilFirstUse,
			);
			return yield* deferred.pipe(orDieCredentialsUnavailable(UNIFI_NETWORK_AUTH_PROVIDER_NAME), Effect.cached);
		}),
	);
