/**
 * convert — turn the vendored UniFi Network OpenAPI spec into a Smithy 2.0
 * model at `.generated-specs/network.json`, using distilled's converter.
 * `scripts/generate.ts` then compiles the model into `src/services`.
 */
import * as path from "node:path";
import { runOpenApiConvert } from "@distilled.cloud/core/codegen/openapi-cli";
import { SPEC_VERSION } from "../src/version.ts";
import { normalise } from "./normalise-spec.ts";

await runOpenApiConvert({
	root: path.resolve(import.meta.dirname, ".."),
	specs: [
		{
			name: "network",
			specPath: `openapi/network-${SPEC_VERSION}.json`,
			preprocess: (spec) => normalise(spec),
		},
	],
	options: { namespace: "com.ui.network", serviceName: "UnifiNetwork", skipDeprecated: true },
});
