import { defineConfig } from "tsdown";

export default defineConfig({
	// One output file per source file, so every subpath export has a target.
	entry: ["src/**/*.ts"],
	unbundle: true,
	dts: { generator: "tsgo" },
	deps: {
		neverBundle: true,
	},
});
