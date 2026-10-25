import type { SdkSpec } from "@distilled.cloud/core/codegen/generator";
import { runGeneratorCli } from "@distilled.cloud/core/codegen/cli";

/** The parts of a Smithy shape the pagination pass reads. */
interface Shape {
	type?: string;
	input?: { target?: string };
	output?: { target?: string };
	members?: Record<string, unknown>;
	traits?: Record<string, unknown>;
}

const PAGINATED_TRAIT = "smithy.api#paginated";
const SENSITIVE_TRAIT = "smithy.api#sensitive";

const spec: SdkSpec = {
	nullableTrait: "com.distilled.openapi#nullable",
	errorMatchersTrait: "com.distilled.openapi#errorMatchers",
	extraBindings: [
		{
			trait: "com.distilled.openapi#rawResponse",
			binding: "rawResponse",
			pipe: "T.RawResponse()",
			rootPipe: "T.RawResponseRoot()",
		},
	],
	memberTraitPipes: { [SENSITIVE_TRAIT]: "T.SensitiveValue" },
	memberTsType: (m) =>
		SENSITIVE_TRAIT in m.traits ? `string | Redacted.Redacted<string>${m.nullable ? " | null" : ""}` : undefined,
	unionStyle: "untagged",
	paginationProfiles: { token: { strategy: "paginateOffset", itemsFallback: "data" } },
	operationDecl: {
		contextType: "UnifiNetworkOpContext",
		commonErrorType: "UnifiNetworkOpError",
		commonErrorClasses: ["UnknownUnifiNetworkError"],
		protocol: "UnifiNetworkProtocol",
		retry: "Retry.Retry",
	},
	sourceNote: ".generated-specs (openapi/network-*.json)",
	postProcess: (code) =>
		code.includes("Redacted.Redacted<")
			? code.replace(
					`import * as S from "@distilled.cloud/core/schema-lite";\n`,
					`import * as S from "@distilled.cloud/core/schema-lite";\nimport * as Redacted from "effect/Redacted";\n`,
				)
			: code,
};

runGeneratorCli({
	description: "Generate the UniFi Network Effect SDK",
	root: `${import.meta.dirname}/..`,
	outDir: "src/sdk/services",
	patchesDir: false,
	spec: (model) => {
		const shapes: Record<string, Shape> = model.shapes ?? {};
		for (const shape of Object.values(shapes)) {
			if (shape?.type !== "operation" || shape.traits?.[PAGINATED_TRAIT]) continue;
			const input = shapes[shape.input?.target ?? ""];
			const output = shapes[shape.output?.target ?? ""];
			if (!input?.members?.["offset"] || !output?.members?.["totalCount"] || !output?.members?.["data"]) continue;
			shape.traits ??= {};
			shape.traits[PAGINATED_TRAIT] = {
				mode: "token",
				inputToken: "offset",
				outputToken: "offset",
				items: "data",
				pageSize: "limit",
			};
		}
		return spec;
	},
});
