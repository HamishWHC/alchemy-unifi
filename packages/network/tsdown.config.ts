import { defineConfig } from "tsdown";

export default defineConfig({
	entry: ["src/index.ts"],
	// Declaration maps (and `src` in `files`) take go-to-definition in consumers
	// to the source. tsgo also needs `declarationMap` in tsconfig.base.json.
	dts: { generator: "tsgo", sourcemap: true },
	deps: {
		neverBundle: true,
	},
});
