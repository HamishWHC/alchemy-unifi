import * as Redacted from "effect/Redacted";

/**
 * Field-wise comparison and merging of request bodies against what the
 * console reports. The console fills unset optional fields with defaults,
 * so only what the user set is compared, and updates (full `PUT`s) send the
 * user's values over the console's current ones.
 */

const plain = (value: unknown): unknown => (Redacted.isRedacted(value) ? Redacted.value(value) : value);

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value) && !Redacted.isRedacted(value);

/** Keys that select a union variant. Objects differing in one are different shapes, so they're replaced, not merged. */
const DISCRIMINATORS = ["management", "type", "mode", "interfaceType", "action"];

const sameVariant = (a: Record<string, unknown>, b: Record<string, unknown>) =>
	DISCRIMINATORS.every((key) => !(key in a) || !(key in b) || plain(a[key]) === plain(b[key]));

/**
 * Whether everything set in `desired` equals `observed`, recursively.
 * `undefined` values in `desired` are unset and ignored; arrays must have the
 * same length and match element by element. Redacted values compare by
 * their contents.
 */
export const matches = (desired: unknown, observed: unknown): boolean => {
	const d = plain(desired);
	const o = plain(observed);
	if (d === undefined) return true;
	if (Array.isArray(d)) return Array.isArray(o) && d.length === o.length && d.every((item, i) => matches(item, o[i]));
	if (isRecord(d)) return isRecord(o) && Object.entries(d).every(([key, value]) => matches(value, o[key]));
	return d === o;
};

/**
 * `desired` laid over `observed`: values set in `desired` win, recursively,
 * and fields only `observed` has are kept, so unset optional props keep the
 * console's current values. Arrays, and objects of a different union
 * variant, are replaced whole.
 */
export function mergeOver<T>(desired: T, observed: unknown): T;
export function mergeOver(desired: unknown, observed: unknown): unknown {
	if (desired === undefined) return observed;
	if (!isRecord(desired) || !isRecord(observed) || !sameVariant(desired, observed)) return desired;
	const merged: Record<string, unknown> = { ...observed };
	for (const [key, value] of Object.entries(desired)) {
		if (value !== undefined) merged[key] = mergeOver(value, observed[key]);
	}
	return merged;
}

/** `record` without `keys`, e.g. read-only fields the console rejects in request bodies. */
export const omitKeys = (record: object, keys: ReadonlyArray<string>): Record<string, unknown> =>
	Object.fromEntries(Object.entries(record).filter(([key]) => !keys.includes(key)));
