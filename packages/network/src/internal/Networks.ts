import * as Sdk from "@alchemy-unifi/network-sdk";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";
import { withConnection } from "../Connection.ts";

/**
 * A site's networks, uncached. Listing them just after one is deleted can
 * fail with 422 "Configured network does not exist" for a moment (seen on
 * the test controller under load), so that's retried briefly.
 */
export const loadNetworks = (siteId: string) =>
	withConnection(Stream.runCollect(Sdk.getNetworksOverviewPage.items({ siteId }))).pipe(
		Effect.retry({
			while: (error) => error._tag === "UnprocessableEntity",
			schedule: Schedule.spaced("500 millis").pipe(Schedule.upTo({ times: 10 })),
		}),
	);
