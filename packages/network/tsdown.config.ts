import { defineConfig } from "tsdown";

export default defineConfig({
	entry: ["src/index.ts"],
	dts: { generator: "tsgo" },
	deps: {
		neverBundle: true,
	},
});
