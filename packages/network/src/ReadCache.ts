import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";

/**
 * Per-run memo of API reads, so a plan touching many resources lists each
 * collection once instead of once per resource. One instance per
 * `providers()` build, i.e. per CLI run or test file. The value is only an
 * identity: entries live on each {@link Key}, keyed by it.
 */
export class UnifiNetworkReadCache extends Context.Service<UnifiNetworkReadCache, { readonly run: object }>()(
	"UnifiNetwork::ReadCache",
) {
	/** Alchemy's tag for environment services, which lets stack bodies (and so lookups) require this one. */
	declare readonly kind: "Environment";
}

export const layer = Layer.sync(UnifiNetworkReadCache, () => ({ run: {} }));

/**
 * One kind of cached read, e.g. a resource type's list. `scope` arguments
 * separate its entries, e.g. by site ID.
 */
export interface Key<A, E> {
	readonly name: string;
	readonly entries: WeakMap<object, Map<string, Deferred.Deferred<A, E>>>;
}

export const key = <A, E = never>(name: string): Key<A, E> => ({ name, entries: new WeakMap() });

const entriesFor = <A, E>(cacheKey: Key<A, E>, run: object) => {
	const existing = cacheKey.entries.get(run);
	if (existing !== undefined) return existing;
	const entries = new Map<string, Deferred.Deferred<A, E>>();
	cacheKey.entries.set(run, entries);
	return entries;
};

/**
 * `load`'s result, shared by every caller in this run until invalidated.
 * Concurrent callers wait for one load. Failures aren't cached.
 */
export const cached = <A, E, R>(
	cacheKey: Key<A, E>,
	scope: string,
	load: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R | UnifiNetworkReadCache> =>
	Effect.gen(function* () {
		const { run } = yield* UnifiNetworkReadCache;
		const entries = entriesFor(cacheKey, run);
		const existing = entries.get(scope);
		if (existing !== undefined) return yield* Deferred.await(existing);
		const deferred = Deferred.makeUnsafe<A, E>();
		entries.set(scope, deferred);
		return yield* load.pipe(
			Effect.onExit((exit) => {
				if (Exit.isFailure(exit) && entries.get(scope) === deferred) entries.delete(scope);
				return Deferred.done(deferred, exit);
			}),
		);
	});

/** Drops an entry, so the next read loads afresh. */
export const invalidate = <A, E>(
	cacheKey: Key<A, E>,
	scope: string,
): Effect.Effect<void, never, UnifiNetworkReadCache> =>
	Effect.gen(function* () {
		const { run } = yield* UnifiNetworkReadCache;
		cacheKey.entries.get(run)?.delete(scope);
	});

/** Runs a write, then invalidates the entry it affects, whether or not the write succeeded. */
export const invalidating =
	<A, E>(cacheKey: Key<A, E>, scope: string) =>
	<B, E2, R>(write: Effect.Effect<B, E2, R>): Effect.Effect<B, E2, R | UnifiNetworkReadCache> =>
		Effect.ensuring(write, invalidate(cacheKey, scope));
