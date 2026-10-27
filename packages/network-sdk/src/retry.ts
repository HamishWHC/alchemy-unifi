import { type Policy, throttlingFactory, transientFactory } from "@distilled.cloud/core/retry";
/**
 * UnifiNetwork retry configuration.
 *
 * Defines the per-SDK `Retry` Context.Service tag that generated operations
 * wire into `API.make`. Callers can install a blanket retry policy at the
 * layer level and have every UnifiNetwork API call below it pick it up:
 *
 * @example
 * ```ts
 * import * as UnifiNetwork from "@alchemy-unifi/network-sdk";
 * import * as Effect from "effect/Effect";
 *
 * const sites = UnifiNetwork.getSiteOverviewPage({});
 * // Retry only transient failures, only throttling, or nothing, for everything below this point.
 * export const transient = sites.pipe(UnifiNetwork.Retry.transient);
 * export const throttled = sites.pipe(UnifiNetwork.Retry.throttling);
 * export const once = sites.pipe(UnifiNetwork.Retry.none);
 * export const program = Effect.all([transient, throttled, once]);
 * ```
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

export {
	type Options,
	type Factory,
	type Policy,
	makeDefault,
	jittered,
	capped,
	throttlingOptions,
	transientOptions,
	throttlingFactory,
	transientFactory,
} from "@distilled.cloud/core/retry";

/** Context tag for configuring retry behavior of UnifiNetwork API calls. */
export class Retry extends /*@__PURE__*/ Context.Service<Retry, Policy>()("UnifiNetworkRetry") {}

/** Provides a custom retry policy to every UnifiNetwork API call below it. */
export const policy = (optionsOrFactory: Policy) => Effect.provide(Layer.succeed(Retry, optionsOrFactory));

/** Disables all automatic retries. */
export const none = /*@__PURE__*/ Effect.provide(/*@__PURE__*/ Layer.succeed(Retry, { while: () => false }));

/** Apply the throttling retry policy (retries throttling errors indefinitely). */
export const throttling = /*@__PURE__*/ policy(throttlingFactory);

/** Apply the transient retry policy (retries all transient errors indefinitely). */
export const transient = /*@__PURE__*/ policy(transientFactory);
