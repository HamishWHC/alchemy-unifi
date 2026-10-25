import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as ReadCache from "../src/ReadCache.ts";

/** A load that counts its runs and returns the count. */
const counting = () => {
	let runs = 0;
	return { load: Effect.sync(() => ++runs), runs: () => runs };
};

describe("ReadCache", () => {
	it.effect("shares one load between callers, per scope", () =>
		Effect.gen(function* () {
			const key = ReadCache.key<number>("things");
			const { load, runs } = counting();
			const results = yield* Effect.all(
				[ReadCache.cached(key, "a", load), ReadCache.cached(key, "a", load), ReadCache.cached(key, "b", load)],
				{ concurrency: "unbounded" },
			);
			expect(results).toEqual([1, 1, 2]);
			expect(runs()).toBe(2);
		}).pipe(Effect.provide(ReadCache.layer)),
	);

	it.effect("reloads after invalidation, including around a failed write", () =>
		Effect.gen(function* () {
			const key = ReadCache.key<number>("things");
			const { load } = counting();
			expect(yield* ReadCache.cached(key, "a", load)).toBe(1);
			yield* ReadCache.invalidate(key, "a");
			expect(yield* ReadCache.cached(key, "a", load)).toBe(2);
			yield* Effect.fail("write failed").pipe(ReadCache.invalidating(key, "a"), Effect.flip);
			expect(yield* ReadCache.cached(key, "a", load)).toBe(3);
		}).pipe(Effect.provide(ReadCache.layer)),
	);

	it.effect("doesn't cache failures", () =>
		Effect.gen(function* () {
			const key = ReadCache.key<number, string>("things");
			let attempts = 0;
			const flaky = Effect.suspend(() =>
				++attempts === 1 ? Effect.fail("unavailable") : Effect.succeed(attempts),
			);
			expect(yield* ReadCache.cached(key, "a", flaky).pipe(Effect.flip)).toBe("unavailable");
			expect(yield* ReadCache.cached(key, "a", flaky)).toBe(2);
		}).pipe(Effect.provide(ReadCache.layer)),
	);

	it.effect("keeps runs apart", () =>
		Effect.gen(function* () {
			const key = ReadCache.key<number>("things");
			const { load } = counting();
			expect(yield* ReadCache.cached(key, "a", load).pipe(Effect.provide(ReadCache.layer))).toBe(1);
			expect(yield* ReadCache.cached(key, "a", load).pipe(Effect.provide(ReadCache.layer))).toBe(2);
		}),
	);
});
