import * as fs from "node:fs";
import * as path from "node:path";
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import * as Schema from "effect/Schema";
import starlightLinksValidator from "starlight-links-validator";
import starlightLlmsTxt from "starlight-llms-txt";

const REPO = "https://github.com/HamishWHC/alchemy-unifi";

// What the header says this build is: a PR preview's number and commit (its packages aren't on
// npm), otherwise the version of the provider the reference was generated from.
const buildLinks = (): ReadonlyArray<{ text: string; href: string }> => {
	const pullRequest = process.env["PULL_REQUEST"];
	const sha = process.env["BUILD_SHA"];
	if (pullRequest && sha) {
		return [
			{ text: `PR #${pullRequest}`, href: `${REPO}/pull/${pullRequest}` },
			{ text: sha.slice(0, 7), href: `${REPO}/commit/${sha}` },
		];
	}
	const packageDir =
		process.env["NETWORK_PACKAGE_DIR"] ?? path.join(import.meta.dirname, "node_modules/@alchemy-unifi/network");
	const { version } = Schema.decodeUnknownSync(Schema.Struct({ version: Schema.String }))(
		JSON.parse(fs.readFileSync(path.join(packageDir, "package.json"), "utf8")),
	);
	return [{ text: `v${version}`, href: `https://www.npmjs.com/package/@alchemy-unifi/network/v/${version}` }];
};

export default defineConfig({
	site: "https://alchemy-unifi.hamishwhc.com",
	vite: { define: { __DOCS_BUILD__: JSON.stringify(buildLinks()) } },
	integrations: [
		starlight({
			title: "alchemy-unifi",
			description: "Alchemy providers for Ubiquiti UniFi, built on Effect.",
			social: [{ icon: "github", label: "GitHub", href: "https://github.com/HamishWHC/alchemy-unifi" }],
			plugins: [
				starlightLinksValidator(),
				starlightLlmsTxt({
					projectName: "alchemy-unifi",
					description:
						"Alchemy providers for Ubiquiti UniFi, built on Effect: networks, Wi-Fi, zone-based firewall, local DNS, and a state store on the console.",
					promote: ["index", "setup", "tutorial/**"],
				}),
			],
			components: { SiteTitle: "./src/components/SiteTitle.astro" },
			editLink: { baseUrl: "https://github.com/HamishWHC/alchemy-unifi/edit/main/packages/docs/" },
			sidebar: [
				{ label: "Overview", link: "/" },
				"setup",
				{ label: "Tutorial", items: [{ autogenerate: { directory: "tutorial" } }] },
				{ label: "Networks", items: ["networks/networks", "networks/wifi"] },
				{
					label: "Firewall",
					items: [
						"firewall/zones",
						"firewall/policies",
						"firewall/ordering",
						"firewall/traffic-matching-lists",
					],
				},
				{ label: "DNS", items: ["dns/local-dns"] },
				{ label: "State", items: ["state/state-on-the-console"] },
				{
					label: "Concepts",
					items: ["concepts/references-and-lookups", "concepts/changes-made-in-the-ui", "concepts/adoption"],
				},
				{ label: "SDK", items: ["sdk/calling-the-api"] },
				{ label: "Reference", items: [{ autogenerate: { directory: "reference" } }] },
			],
		}),
	],
});
