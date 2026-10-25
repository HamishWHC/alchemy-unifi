import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as UnifiNetwork from "../src/index.ts";

describe("providers", () => {
	it.effect("builds the provider collection", () =>
		Effect.gen(function* () {
			const collection = yield* UnifiNetwork.Providers;
			expect(collection.kind).toBe("ProviderCollection");
		}).pipe(Effect.provide(UnifiNetwork.providers())),
	);
});
