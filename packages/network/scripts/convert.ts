/**
 * convert — turn the vendored UniFi Network OpenAPI spec into a Smithy 2.0
 * model at `.generated-specs/network.json`, using distilled's converter.
 * `scripts/generate.ts` then compiles the model into `src/sdk/services`.
 */
import * as path from "node:path";
import { runOpenApiConvert } from "@distilled.cloud/core/codegen/openapi-cli";
import { normalise } from "./normalise-spec.ts";

export const SPEC_VERSION = "10.6.106";

await runOpenApiConvert({
	root: path.resolve(import.meta.dirname, ".."),
	specs: [
		{
			name: "network",
			specPath: `openapi/network-${SPEC_VERSION}.json`,
			preprocess: (spec) => normalise(spec),
		},
	],
	patchesDir: false,
	options: { namespace: "com.ui.network", serviceName: "UnifiNetwork", skipDeprecated: true },
});
