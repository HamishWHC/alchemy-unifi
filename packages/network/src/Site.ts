import * as Sdk from "@alchemy-unifi/network-sdk";
import { UserFacingError } from "alchemy/UserFacingError";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { withConnection } from "./Connection.ts";
import { UnifiNetworkCredentials } from "./Credentials.ts";
import * as ReadCache from "./ReadCache.ts";

/** A UniFi site: a namespace within one console. */
export interface Site {
	/** The ID other Integration API calls take. */
	readonly id: string;
	/** Stable reference that survives renames: `default`, or a generated one like `x7k2m9q1`. */
	readonly internalReference: string;
	readonly name: string;
}

const describeSites = (sites: ReadonlyArray<Site>) =>
	sites.map((site) => `${site.internalReference} (${site.name})`).join(", ") || "none";

export class SiteNotFound extends Data.TaggedError("SiteNotFound")<{
	readonly site: string;
	readonly available: ReadonlyArray<Site>;
}> {
	readonly [UserFacingError]: true = true;
	override get message() {
		return `The console has no site "${this.site}". Its sites: ${describeSites(this.available)}. Point the profile's site, or the resource's site prop, at one of them.`;
	}
}

export class SiteRequired extends Data.TaggedError("SiteRequired")<{ readonly available: ReadonlyArray<Site> }> {
	readonly [UserFacingError]: true = true;
	override get message() {
		return `The console hosts several sites (${describeSites(this.available)}), so resources need one: set site in the profile (alchemy profile edit --reconfigure UnifiNetwork), or the resource's site prop.`;
	}
}

export class AmbiguousSite extends Data.TaggedError("AmbiguousSite")<{
	readonly site: string;
	readonly matches: ReadonlyArray<Site>;
}> {
	readonly [UserFacingError]: true = true;
	override get message() {
		return `Several sites are named "${this.site}" (${describeSites(this.matches)}). Use the internal reference instead.`;
	}
}

const loadSites = withConnection(
	Sdk.getSiteOverviewPage.items({}).pipe(
		Stream.map(({ id, internalReference, name }): Site => ({ id, internalReference, name })),
		Stream.runCollect,
	),
);

export const sitesKey = ReadCache.key<ReadonlyArray<Site>, Effect.Error<typeof loadSites>>("sites");

/** The console's sites, listed once per run. */
export const listSites = ReadCache.cached(sitesKey, "", loadSites);

/**
 * The site a resource belongs to: `site` (an ID, internal reference or
 * name), else the profile's site, else the console's only site. Fails,
 * listing the console's sites, when it doesn't exist or is ambiguous, so a
 * plan stops before changing anything.
 */
export const resolveSite = Effect.fn("UnifiNetwork.resolveSite")(function* (site?: string) {
	const requested = site ?? (yield* yield* UnifiNetworkCredentials).site;
	const sites = yield* listSites;
	if (requested === undefined) {
		const [only] = sites;
		if (only !== undefined && sites.length === 1) return only;
		return yield* new SiteRequired({ available: sites });
	}
	const byReference = sites.find((s) => s.id === requested || s.internalReference === requested);
	if (byReference !== undefined) return byReference;
	const byName = sites.filter((s) => s.name === requested);
	const [match] = byName;
	if (match !== undefined && byName.length === 1) return match;
	if (byName.length > 1) return yield* new AmbiguousSite({ site: requested, matches: byName });
	return yield* new SiteNotFound({ site: requested, available: sites });
});
