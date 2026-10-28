import { defineConfig } from "vitest/config";

// Every package's test projects in one run, so CI gets one report per kind of test. Each is named
// `<package> (<kind>)`: `--project '*(unit)'` selects every package's unit tests, and
// `--project '@alchemy-unifi/network (unit)'` one package's.
export default defineConfig({
	test: { projects: ["packages/network-sdk", "packages/network"] },
});
