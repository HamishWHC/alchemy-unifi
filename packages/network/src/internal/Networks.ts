import * as Sdk from "@alchemy-unifi/network-sdk";
import * as Stream from "effect/Stream";
import { withConnection } from "../Connection.ts";

/** A site's networks, uncached. */
export const loadNetworks = (siteId: string) =>
	withConnection(Stream.runCollect(Sdk.getNetworksOverviewPage.items({ siteId })));
