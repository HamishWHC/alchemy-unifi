/**
 * Deploys the docs site to Cloudflare. Stages:
 * - `prod`: releases, at alchemy-unifi.hamishwhc.com;
 * - `nightly`: every push to `main`, at nightly.alchemy-unifi.hamishwhc.com;
 * - `pr-<n>`: a preview of each pull request, as a preview version of the
 *   `nightly` Worker, commented on the PR and destroyed when it closes.
 *
 * CI builds the site once, from the packed packages, and sets
 * `DOCS_PREBUILT=1` so the deploy uploads that build instead of building
 * again.
 */
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as GitHub from "@alchemy.run/github";
import * as Alchemy from "alchemy";
import * as Output from "alchemy/Output";
import * as RemovalPolicy from "alchemy/RemovalPolicy";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

const DOMAINS: Partial<Record<string, string>> = {
	prod: "alchemy-unifi.hamishwhc.com",
	nightly: "nightly.alchemy-unifi.hamishwhc.com",
};

const prebuilt = process.env["DOCS_PREBUILT"] === "1";
const pullRequest = process.env["PULL_REQUEST"];

const Docs = Cloudflare.Website.StaticSite(
	"Docs",
	Effect.gen(function* () {
		const { stage } = yield* Alchemy.Stack;
		const domain = DOMAINS[stage];
		const previewOf = stage.startsWith("pr-")
			? yield* Cloudflare.Worker.ref("Docs", { stage: "nightly" })
			: undefined;
		return {
			command: prebuilt ? "test -f dist/index.html" : "pnpm run build",
			outdir: "dist",
			...(prebuilt ? { memo: false } : {}),
			...(domain === undefined
				? {}
				: {
						name: `alchemy-unifi-docs-${stage}`,
						// PR previews are preview versions of the nightly Worker, served on workers.dev.
						workersDev: { enabled: false, previewsEnabled: stage === "nightly" },
						domain: { name: domain },
					}),
			...(previewOf === undefined
				? {}
				: {
						preview: {
							of: previewOf,
							name: stage,
							...(pullRequest === undefined ? {} : { message: `PR #${pullRequest}` }),
						},
					}),
		} satisfies Cloudflare.Website.StaticSiteProps<{}>;
	}),
).pipe(RemovalPolicy.retain(Alchemy.Stack.pipe(Effect.map(({ stage }) => !stage.startsWith("pr-")))));

export default Alchemy.Stack(
	"AlchemyUnifiDocs",
	{
		providers: Layer.mergeAll(Cloudflare.providers(), GitHub.providers()),
		state: Cloudflare.state(),
	},
	Effect.gen(function* () {
		const { stage } = yield* Alchemy.Stack;
		const docs = yield* Docs;
		if (stage.startsWith("pr-") && pullRequest !== undefined) {
			const sha = process.env["BUILD_SHA"];
			yield* GitHub.Comment("preview-comment", {
				owner: "HamishWHC",
				repository: "alchemy-unifi",
				issueNumber: Number(pullRequest),
				body: Output.interpolate`
					## Docs preview

					**URL:** ${docs.url}

					Built from ${sha ? `[\`${sha.slice(0, 7)}\`](https://github.com/HamishWHC/alchemy-unifi/commit/${sha})` : "an unknown commit"}, with the packages packed from it.

					---
					_This comment updates with each push._
				`,
			});
		}
		return { url: docs.url };
	}),
);
