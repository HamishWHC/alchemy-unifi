import { defineConfig } from "tsdown";

export default defineConfig({
	// One output file per source file, so every subpath export has a target.
	entry: ["src/**/*.ts"],
	unbundle: true,
	// Declaration maps (and `src` in `files`) take go-to-definition in consumers
	// to the source. tsgo also needs `declarationMap` in tsconfig.base.json.
	dts: { generator: "tsgo", sourcemap: true },
	deps: {
		neverBundle: true,
	},
});
