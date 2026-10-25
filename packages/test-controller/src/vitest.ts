/**
 * Vitest wiring. A project's `globalSetup` file re-exports {@link setup};
 * each controller test file calls {@link useSite}.
 */
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Scope from "effect/Scope";
import { afterAll, beforeAll, inject } from "vitest";
import type { TestProject } from "vitest/node";
import { type Controller, start, type TestSite, withSite } from "./Controller.ts";

declare module "vitest" {
	export interface ProvidedContext {
		readonly unifiController: Controller;
	}
}

/** Global setup: starts the controller once per run and hands its details to test files. */
export const setup = async (project: TestProject) => {
	project.provide("unifiController", await Effect.runPromise(start));
};

/**
 * A fresh site for this test file, deleted after its tests. Also points the
 * `UNIFI_*` environment variables at the controller and the site, which is
 * how Alchemy tests (`alchemy/Test/Vitest`) get credentials. Vitest runs each
 * file in its own worker, so the variables don't leak between files.
 *
 * Returns an accessor, usable once `beforeAll` has run.
 */
export const useSite = (label: string): (() => { readonly controller: Controller; readonly site: TestSite }) => {
	const scope = Scope.makeUnsafe();
	let current: { readonly controller: Controller; readonly site: TestSite } | undefined;
	beforeAll(async () => {
		const controller = inject("unifiController");
		const site = await Effect.runPromise(withSite(label).pipe(Scope.provide(scope)));
		for (const name of ["UNIFI_CONSOLE_ID", "UNIFI_CERT_FINGERPRINT", "UNIFI_INSECURE"]) delete process.env[name];
		Object.assign(process.env, {
			UNIFI_URL: controller.url,
			UNIFI_API_KEY: controller.apiKey,
			UNIFI_SITE: site.internalReference,
		});
		current = { controller, site };
	}, 120_000);
	afterAll(() => Effect.runPromise(Scope.close(scope, Exit.void)), 120_000);
	return () => {
		if (current === undefined) throw new Error("useSite's site is only available once beforeAll has run");
		return current;
	};
};
