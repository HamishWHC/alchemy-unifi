import * as Sdk from "@alchemy-unifi/network-sdk";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as HttpClient from "effect/http/HttpClient";
import * as Layer from "effect/Layer";
import * as Predicate from "effect/Predicate";
import * as Schedule from "effect/Schedule";
import * as RateLimiter from "effect/persistence/RateLimiter";
import * as Scope from "effect/Scope";
import { type Connection, UnifiNetworkCredentials } from "./Credentials.ts";
import * as UnifiHttpClient from "./HttpClient.ts";

export const SITE_MANAGER_URL = "https://api.ui.com";

/** Integration API base URL through the cloud connector. */
export const connectorBaseUrl = (consoleId: string) =>
	`${SITE_MANAGER_URL}/v1/connector/consoles/${encodeURIComponent(consoleId)}/proxy/network/integration`;

/** Integration API base URLs to try for a connection: a UniFi OS console's, then a standalone controller's. */
export const candidateBaseUrls = (connection: Connection): ReadonlyArray<string> =>
	connection.type === "remote"
		? [connectorBaseUrl(connection.consoleId)]
		: [`${connection.url}/proxy/network/integration`, `${connection.url}/integration`];

/** The SDK's default retry policy, minus certificate failures, which retrying won't fix. */
const probeRetry: Sdk.Retry.Policy = (lastError) => {
	const defaults = Sdk.Retry.makeDefault(lastError);
	return {
		...defaults,
		while: (error) => (defaults.while?.(error) ?? false) && !UnifiHttpClient.isCertificateError(error),
	};
};

/** The connector allows 100 requests/minute per console; stay under it. */
const REMOTE_REQUESTS_PER_MINUTE = 90;

/** A connection whose base URL has been found and whose API key works. */
export interface Established {
	readonly baseUrl: string;
	readonly applicationVersion: string;
	/** What SDK operations need: credentials for {@link baseUrl} and a client with the connection's TLS settings. */
	readonly services: Context.Context<Sdk.Credentials | HttpClient.HttpClient>;
}

/** Joins an error's message with its causes' (e.g. a transport error and the TLS failure behind it). */
export const describeError = (error: unknown): string => {
	const messages: string[] = [];
	for (let e: unknown = error, depth = 0; e !== undefined && e !== null && depth < 5; depth++) {
		const message = typeof e === "object" && "message" in e ? String(e.message) : String(e);
		if (message !== "" && !messages.some((m) => m.includes(message))) messages.push(message);
		e = typeof e === "object" && "cause" in e ? e.cause : undefined;
	}
	return messages.join(": ") || "unknown error";
};

const describeTarget = (connection: Connection) =>
	connection.type === "remote" ? `console ${connection.consoleId} via ${SITE_MANAGER_URL}` : connection.url;

const rateLimited = (client: HttpClient.HttpClient, key: string) =>
	Effect.gen(function* () {
		const limiter = yield* RateLimiter.make.pipe(Effect.provide(RateLimiter.layerStoreMemory));
		const wait = RateLimiter.sleep(limiter, {
			algorithm: "token-bucket",
			window: "1 minute",
			limit: REMOTE_REQUESTS_PER_MINUTE,
			key,
		}).pipe(Effect.orDie);
		return HttpClient.transform(client, (response) => Effect.andThen(wait, response));
	});

/**
 * Builds a client for the connection and finds the Integration API: local
 * connections try the console path, then the standalone controller path.
 * Fails with a `ConfigError` describing what went wrong. `options.client`
 * replaces the TLS-configured client (for tests).
 */
export const connect = (
	connection: Connection,
	options: { readonly client?: HttpClient.HttpClient } = {},
): Effect.Effect<Established, Sdk.ConfigError, Scope.Scope> =>
	Effect.gen(function* () {
		const base = options.client ?? (yield* UnifiHttpClient.make(connection.type === "local" ? connection : {}));
		const client =
			connection.type === "remote" ? yield* rateLimited(base, `connector:${connection.consoleId}`) : base;
		const servicesFor = (baseUrl: string) =>
			Context.make(Sdk.Credentials, Effect.succeed({ baseUrl, apiKey: connection.apiKey })).pipe(
				Context.add(HttpClient.HttpClient, client),
			);
		const candidates = candidateBaseUrls(connection);
		for (const baseUrl of candidates) {
			const services = servicesFor(baseUrl);
			const info = yield* Sdk.getInfo({}).pipe(
				Effect.provide(services),
				Sdk.Retry.policy(probeRetry),
				Effect.map(({ applicationVersion }) => ({ baseUrl, applicationVersion, services })),
				Effect.catchTag("NotFound", () => Effect.undefined),
				Effect.mapError((error) =>
					Sdk.ConfigError.make({
						message:
							error._tag === "Unauthorized" || error._tag === "Forbidden"
								? `${describeTarget(connection)} rejected the API key (${error._tag}).`
								: `Could not connect to ${describeTarget(connection)}: ${describeError(error)}`,
					}),
				),
			);
			if (info !== undefined) return info;
		}
		return yield* Sdk.ConfigError.make({
			message:
				connection.type === "remote"
					? `The cloud connector found no UniFi Network application on console ${connection.consoleId}.`
					: `No UniFi Network Integration API at ${connection.url} (tried ${candidates.join(", ")}). Use the console's root URL, e.g. https://192.168.1.1.`,
		});
	});

const majorMinor = (version: string) => version.split(".").slice(0, 2).join(".");

/** Patch releases routinely ship without a published spec, so only major.minor drift is worth a warning. */
export const checkVersion = (applicationVersion: string) =>
	majorMinor(applicationVersion) === majorMinor(Sdk.SPEC_VERSION)
		? Effect.void
		: Effect.logWarning(
				`UniFi Network ${applicationVersion} is newer or older than the API spec this provider was built from (${Sdk.SPEC_VERSION}). Resources may not behave as documented.`,
			);

/**
 * The profile's established connection, created on first use and shared for
 * the rest of the run. Provider-private: its `HttpClient` and SDK
 * `Credentials` never enter the stack's context, so they can't replace other
 * providers' clients.
 */
export class UnifiNetworkConnection extends Context.Service<
	UnifiNetworkConnection,
	Effect.Effect<Established, Sdk.ConfigError>
>()("UnifiNetwork::Connection") {
	/** Alchemy's tag for environment services, which lets stack bodies (and so lookups) require this one. */
	declare readonly kind: "Environment";
}

export const layer = Layer.effect(
	UnifiNetworkConnection,
	Effect.gen(function* () {
		const credentials = yield* UnifiNetworkCredentials;
		const scope = yield* Effect.scope;
		return yield* Effect.cached(
			credentials.pipe(
				Effect.flatMap(({ connection }) => connect(connection)),
				Effect.tap(({ applicationVersion }) => checkVersion(applicationVersion)),
				Scope.provide(scope),
			),
		);
	}),
);

/**
 * The 422 "Configured network does not exist" the console answers requests
 * with, on any endpoint, for a moment while networks are created or deleted
 * anywhere on it (seen on the test controller under parallel tests, for
 * network, zone and policy requests alike). It's never a real error, so it's
 * retried; other 422s are.
 */
const isStaleNetworkState = (error: unknown) =>
	Predicate.hasProperty(error, "_tag") &&
	error._tag === "UnprocessableEntity" &&
	Predicate.hasProperty(error, "message") &&
	typeof error.message === "string" &&
	error.message.includes("Configured network does not exist");

/** Runs SDK operations against the profile's console, retrying the console's transient stale-network 422. */
export const withConnection = <A, E, R>(
	effect: Effect.Effect<A, E, R>,
): Effect.Effect<
	A,
	E | Sdk.ConfigError,
	Exclude<R, Sdk.Credentials | HttpClient.HttpClient> | UnifiNetworkConnection
> =>
	Effect.gen(function* () {
		const { services } = yield* yield* UnifiNetworkConnection;
		return yield* Effect.provide(effect, services).pipe(
			Effect.retry({
				while: isStaleNetworkState,
				schedule: Schedule.spaced("500 millis").pipe(Schedule.upTo({ times: 10 })),
			}),
		);
	});
