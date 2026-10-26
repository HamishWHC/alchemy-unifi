import { UserFacingError } from "alchemy/UserFacingError";
import * as Data from "effect/Data";
import type { Site } from "./Site.ts";

/** A `lookup` found nothing matching its query. */
export class LookupNotFound extends Data.TaggedError("LookupNotFound")<{
	readonly resource: string;
	readonly query: string;
	readonly site: Site;
}> {
	readonly [UserFacingError]: true = true;
	override get message() {
		return `No ${this.resource} matches ${this.query} in site ${this.site.internalReference} (${this.site.name}).`;
	}
}

/** A `lookup` matched several objects, e.g. networks sharing a name. */
export class LookupAmbiguous extends Data.TaggedError("LookupAmbiguous")<{
	readonly resource: string;
	readonly query: string;
	readonly site: Site;
	readonly count: number;
}> {
	readonly [UserFacingError]: true = true;
	override get message() {
		return `${this.count} ${this.resource}s match ${this.query} in site ${this.site.internalReference} (${this.site.name}). Use a more specific query.`;
	}
}

export const describeQuery = (query: object) =>
	Object.entries(query)
		.filter(([key, value]) => key !== "site" && value !== undefined)
		.map(([key, value]) => `${key} ${JSON.stringify(value)}`)
		.join(" and ");
