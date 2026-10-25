import { CONTROLLER } from "@alchemy-unifi/test-controller";
import { useSite } from "@alchemy-unifi/test-controller/vitest";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Stream from "effect/Stream";
import * as Sdk from "../../src/index.ts";

const current = useSite("sdk");

const services = Layer.merge(
	Layer.succeed(
		Sdk.Credentials,
		Effect.succeed({ baseUrl: CONTROLLER.baseUrl, apiKey: Redacted.make(CONTROLLER.apiKey) }),
	),
	FetchHttpClient.layer,
);

describe("against the test controller", () => {
	it.effect("pages through sites with typed items", () =>
		Effect.gen(function* () {
			const { site } = current();
			const sites = yield* Stream.runCollect(Sdk.getSiteOverviewPage.items({ limit: 1 }));
			expect(sites.length).toBeGreaterThanOrEqual(2);
			expect(sites.map((s) => s.internalReference)).toContain(site.internalReference);
			expect(sites.find((s) => s.id === site.id)?.name).toBe(site.name);
		}).pipe(Effect.provide(services)),
	);

	// A deleted site is an unknown ID like this one, but stays in the cached site list for about 10 s after deletion.
	it.effect("answers requests under an unknown site with NotFound, for reads and deletes", () =>
		Effect.gen(function* () {
			const siteId = crypto.randomUUID();
			const read = yield* Sdk.getNetworksOverviewPage({ siteId }).pipe(Effect.flip);
			const remove = yield* Sdk.deleteNetwork({ siteId, networkId: crypto.randomUUID() }).pipe(Effect.flip);
			expect([read._tag, remove._tag]).toEqual(["NotFound", "NotFound"]);
		}).pipe(Effect.provide(services)),
	);
});
