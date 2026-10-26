import * as Sdk from "@alchemy-unifi/network-sdk";
import { CONTROLLER } from "@alchemy-unifi/test-controller";
import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import type * as HttpClient from "effect/http/HttpClient";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";

const services = Layer.merge(
	Layer.succeed(
		Sdk.Credentials,
		Effect.succeed({ baseUrl: CONTROLLER.baseUrl, apiKey: Redacted.make(CONTROLLER.apiKey) }),
	),
	FetchHttpClient.layer,
);

/** Runs SDK calls against the controller directly, e.g. to change things behind the provider's back. */
export const sdk = <A, E>(effect: Effect.Effect<A, E, Sdk.Credentials | HttpClient.HttpClient>) =>
	Effect.provide(effect, services);

/** The defect `effect` dies with, e.g. a lookup's `LookupNotFound`. */
export const defectOf = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
	effect.pipe(
		Effect.flatMap(() => Effect.die(new Error("expected the effect to die"))),
		Effect.catchDefect((defect) => Effect.succeed(defect)),
	);
