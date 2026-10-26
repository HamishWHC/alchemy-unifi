import * as Effect from "effect/Effect";
import type { UnifiNetworkConnection } from "../Connection.ts";
import type { UnifiNetworkCredentials } from "../Credentials.ts";
import type { UnifiNetworkReadCache } from "../ReadCache.ts";

/** What resource lifecycle handlers and lookups need. `providers()` provides all of them. */
export type Services = UnifiNetworkCredentials | UnifiNetworkConnection | UnifiNetworkReadCache;

/**
 * The provider's services, captured when the provider is built, as a
 * function that runs a handler with them. Handlers then don't depend on
 * what the stack's merged context happens to hold when they run.
 */
export const captureServices = Effect.map(
	Effect.context<Services>(),
	(services) =>
		<A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, Exclude<R, Services>> =>
			Effect.provide(effect, services),
);
