import * as Sdk from "@alchemy-unifi/network-sdk";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";
import { withConnection } from "../Connection.ts";

/**
 * Retries the 422 "Configured network does not exist" that some requests
 * (listing networks, deleting a zone) fail with for a moment after a network
 * is deleted.
 */
export const retryAfterNetworkDelete = <A, E extends { readonly _tag: string }, R>(effect: Effect.Effect<A, E, R>) =>
	effect.pipe(
		Effect.retry({
			while: (error) => error._tag === "UnprocessableEntity",
			schedule: Schedule.spaced("500 millis").pipe(Schedule.upTo({ times: 10 })),
		}),
	);

/** A site's networks, uncached. */
export const loadNetworks = (siteId: string) =>
	retryAfterNetworkDelete(withConnection(Stream.runCollect(Sdk.getNetworksOverviewPage.items({ siteId }))));
