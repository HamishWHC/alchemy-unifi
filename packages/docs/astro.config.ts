import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import starlightLinksValidator from "starlight-links-validator";
import starlightLlmsTxt from "starlight-llms-txt";

export default defineConfig({
	site: "https://alchemy-unifi.hamishwhc.com",
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
