import { useSite } from "@alchemy-unifi/test-controller/vitest";
import { expect } from "@effect/vitest";
import * as Test from "alchemy/Test/Vitest";
import * as Effect from "effect/Effect";
import * as UnifiNetwork from "../../src/index.ts";

const current = useSite("site-resolution");
const { test } = Test.make({ providers: UnifiNetwork.providers() });

test.provider("resolves the site named by UNIFI_SITE", () =>
	Effect.gen(function* () {
		expect(yield* UnifiNetwork.resolveSite()).toEqual(current().site);
	}),
);

test.provider("fails, listing the console's sites, for a site the console doesn't have", () =>
	Effect.gen(function* () {
		const error = yield* UnifiNetwork.resolveSite("x0000000").pipe(Effect.flip);
		expect(error._tag).toBe("SiteNotFound");
		expect(error.message).toContain(`${current().site.internalReference} (${current().site.name})`);
	}),
);
