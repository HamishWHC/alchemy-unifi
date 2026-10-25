import { defineConfig } from "vitest/config";

// Resolve workspace packages to their source (see `customConditions` in tsconfig.base.json).
const conditions = ["@alchemy-unifi/source", "module", "node", "development|production"];

export default defineConfig({
	ssr: { resolve: { conditions } },
	test: {
		include: ["test/**/*.test.ts"],
	},
});
