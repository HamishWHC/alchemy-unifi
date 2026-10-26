import { deepEqual } from "alchemy/Diff";
import * as Redacted from "effect/Redacted";

/**
 * Comparison of request bodies with what the console reports. Props are
 * authoritative: a resource's desired body is its props with explicit
 * defaults for anything unset, sent whole on every update, and the console's
 * object must equal it field for field.
 */

/** `Omit` applied to each member of a union, keeping the discriminant. */
export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** `value` with every `Redacted` unwrapped, recursively, so passphrases compare by contents. */
const unwrap = (value: unknown): unknown => {
	if (Redacted.isRedacted(value)) return Redacted.value(value);
	if (Array.isArray(value)) return value.map(unwrap);
	if (typeof value === "object" && value !== null) {
		return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, unwrap(nested)]));
	}
	return value;
};

/**
 * Whether the console's object is exactly the desired body: same fields,
 * same values, recursively (key order and `Redacted` wrappers aside; unset
 * fields must be absent on both sides). Leave read-only fields out of
 * `observed` first.
 */
export const isCurrent = (desired: unknown, observed: unknown) => deepEqual(unwrap(desired), unwrap(observed));

/** `record` without `keys`, e.g. read-only fields the console rejects in request bodies. */
export const omitKeys = (record: object, keys: ReadonlyArray<string>): Record<string, unknown> =>
	Object.fromEntries(Object.entries(record).filter(([key]) => !keys.includes(key)));
