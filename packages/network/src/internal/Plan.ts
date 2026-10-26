import { isResolved } from "alchemy/Diff";
import * as Predicate from "effect/Predicate";

/** A prop whose value depends on another resource's output, so isn't known while planning. */
export const UNKNOWN: unique symbol = Symbol("UnifiNetwork.unknown");

/**
 * A top-level prop of `diff`'s `news` (props that may still hold outputs of
 * resources not yet deployed): its value, `undefined` when unset, or
 * {@link UNKNOWN}.
 */
export const planned = (news: unknown, key: string): unknown => {
	if (typeof news !== "object" || news === null) return UNKNOWN;
	const value = Predicate.hasProperty(news, key) ? news[key] : undefined;
	return isResolved(value) ? value : UNKNOWN;
};

/** {@link planned} for string props such as `site`. */
export const plannedString = (news: unknown, key: string): string | undefined | typeof UNKNOWN => {
	const value = planned(news, key);
	return value === UNKNOWN || value === undefined || typeof value === "string" ? value : UNKNOWN;
};
