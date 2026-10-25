/** `pnpm run up` / `pnpm run down`. */
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import { start, stop } from "./Controller.ts";

const commands: Record<string, Effect.Effect<void, unknown>> = {
	up: start.pipe(Effect.flatMap(({ baseUrl, apiKey }) => Console.log(`base URL: ${baseUrl}\nAPI key:  ${apiKey}`))),
	down: stop,
};

const command = commands[process.argv[2] ?? ""];
if (command === undefined) {
	process.exitCode = 1;
	Effect.runSync(Console.error("usage: node src/cli.ts up|down"));
} else {
	NodeRuntime.runMain(command);
}
