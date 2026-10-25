import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { AuthProviders, getAuthProvider } from "alchemy/Auth/AuthProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as UnifiNetwork from "../src/index.ts";

const platform = Layer.mergeAll(
	NodeServices.layer,
	Layer.sync(AuthProviders, () => ({})),
);

describe("providers", () => {
	it.effect("builds the provider collection and registers the auth provider without resolving credentials", () =>
		Effect.gen(function* () {
			const collection = yield* UnifiNetwork.Providers;
			expect(collection.kind).toBe("ProviderCollection");
			const auth = yield* getAuthProvider(UnifiNetwork.UNIFI_NETWORK_AUTH_PROVIDER_NAME);
			expect(auth.environment.map((v) => v.name)).toContain("UNIFI_API_KEY");
			expect(auth.configureMethods?.map((m) => m.method)).toEqual(["local", "remote"]);
		}).pipe(Effect.provide(UnifiNetwork.providers().pipe(Layer.provideMerge(platform)))),
	);
});
