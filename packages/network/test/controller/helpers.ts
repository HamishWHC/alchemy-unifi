import * as Sdk from "@alchemy-unifi/network-sdk";
import { CONTROLLER } from "@alchemy-unifi/test-controller";
import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import type * as HttpClient from "effect/http/HttpClient";
import * as Layer from "effect/Layer";
import * as Predicate from "effect/Predicate";
import * as Redacted from "effect/Redacted";
import * as Schedule from "effect/Schedule";

const services = Layer.merge(
	Layer.succeed(
		Sdk.Credentials,
		Effect.succeed({ baseUrl: CONTROLLER.baseUrl, apiKey: Redacted.make(CONTROLLER.apiKey) }),
	),
	FetchHttpClient.layer,
);

/**
 * Runs SDK calls against the controller directly, e.g. to change things
 * behind the provider's back. Retries the console's transient stale-network
 * 422, as the provider's `withConnection` does.
 */
export const sdk = <A, E>(effect: Effect.Effect<A, E, Sdk.Credentials | HttpClient.HttpClient>) =>
	Effect.provide(effect, services).pipe(
		Effect.retry({
			while: (error) =>
				Predicate.hasProperty(error, "message") &&
				typeof error.message === "string" &&
				error.message.includes("Configured network does not exist"),
			schedule: Schedule.spaced("500 millis").pipe(Schedule.upTo({ times: 10 })),
		}),
	);

/** The defect `effect` dies with, e.g. a lookup's `LookupNotFound`. */
export const defectOf = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
	effect.pipe(
		Effect.flatMap(() => Effect.die(new Error("expected the effect to die"))),
		Effect.catchDefect((defect) => Effect.succeed(defect)),
	);

/** `value` with every `Redacted` unwrapped, for readable equality assertions. */
export const unredacted = (value: unknown): unknown => {
	if (Redacted.isRedacted(value)) return Redacted.value(value);
	if (Array.isArray(value)) return value.map(unredacted);
	if (typeof value === "object" && value !== null) {
		return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, unredacted(nested)]));
	}
	return value;
};
