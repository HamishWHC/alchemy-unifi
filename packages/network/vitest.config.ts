import { configDefaults, defineConfig } from "vitest/config";

// Resolve workspace packages to their source (see `customConditions` in tsconfig.base.json).
const conditions = ["@alchemy-unifi/source", "module", "node", "development|production"];

export default defineConfig({
	ssr: { resolve: { conditions } },
	test: {
		projects: [
			{
				extends: true,
				test: {
					name: "unit",
					include: ["test/**/*.test.ts"],
					exclude: [...configDefaults.exclude, "test/controller/**"],
				},
			},
			{
				extends: true,
				test: {
					name: "controller",
					include: ["test/controller/**/*.test.ts"],
					globalSetup: ["test/controller/global-setup.ts"],
					testTimeout: 120_000,
				},
			},
		],
	},
});
