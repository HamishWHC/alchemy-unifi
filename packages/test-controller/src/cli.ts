/**
 * `pnpm run up` / `pnpm run down`, and `node src/cli.ts with-site <label> -- <command…>`,
 * which runs a command with the `UNIFI_*` variables pointing at a fresh site,
 * deleted afterwards (the consumer smoke test uses it).
 */
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import { spawnSync } from "node:child_process";
import { start, stop, withSite } from "./Controller.ts";

const [name, ...rest] = process.argv.slice(2);

const runWithSite = (label: string, command: ReadonlyArray<string>) =>
	Effect.scoped(
		Effect.gen(function* () {
			const { url, apiKey } = yield* start;
			const site = yield* withSite(label);
			const [program, ...args] = command;
			if (program === undefined) return yield* Effect.die("with-site needs a command after --");
			const { status } = yield* Effect.sync(() =>
				spawnSync(program, args, {
					stdio: "inherit",
					env: { ...process.env, UNIFI_URL: url, UNIFI_API_KEY: apiKey, UNIFI_SITE: site.internalReference },
				}),
			);
			process.exitCode = status ?? 1;
		}),
	);

const commands: Record<string, Effect.Effect<void, unknown>> = {
	up: start.pipe(Effect.flatMap(({ baseUrl, apiKey }) => Console.log(`base URL: ${baseUrl}\nAPI key:  ${apiKey}`))),
	down: stop,
	"with-site": runWithSite(rest[0] ?? "cli", rest.slice(rest.indexOf("--") + 1)),
};

const command = commands[name ?? ""];
if (command === undefined || (name === "with-site" && !rest.includes("--"))) {
	process.exitCode = 1;
	Effect.runSync(Console.error("usage: node src/cli.ts up|down|with-site <label> -- <command…>"));
} else {
	NodeRuntime.runMain(command);
}
