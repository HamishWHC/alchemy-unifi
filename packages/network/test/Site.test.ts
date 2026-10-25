import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Connection from "../src/Connection.ts";
import { UnifiNetworkCredentials } from "../src/Credentials.ts";
import * as ReadCache from "../src/ReadCache.ts";
import { resolveSite } from "../src/Site.ts";
import {
	FAKE_DEFAULT_SITE as defaultSite,
	FAKE_OTHER_SITE as holiday,
	FAKE_SITES,
	fakeConsole,
	TEST_API_KEY,
} from "./helpers/fake-console.ts";

/** Runs `effect` against a fake console listing `sites`, with `profileSite` as the profile's site. */
const withConsole =
	(options: { readonly sites?: typeof FAKE_SITES; readonly profileSite?: string } = {}) =>
	<A, E>(
		effect: Effect.Effect<
			A,
			E,
			UnifiNetworkCredentials | Connection.UnifiNetworkConnection | ReadCache.UnifiNetworkReadCache
		>,
	) =>
		Effect.gen(function* () {
			const { url } = yield* fakeConsole(options.sites === undefined ? {} : { sites: options.sites });
			const credentials = Layer.succeed(
				UnifiNetworkCredentials,
				Effect.succeed({
					connection: { type: "local", url, apiKey: Redacted.make(TEST_API_KEY), insecure: false },
					site: options.profileSite,
					source: { type: "env" },
				}),
			);
			return yield* effect.pipe(
				Effect.provide(Layer.mergeAll(Connection.layer, ReadCache.layer).pipe(Layer.provideMerge(credentials))),
			);
		}).pipe(Effect.scoped);

describe("resolveSite", () => {
	it.effect("uses the console's only site when none is given", () =>
		withConsole({ sites: [holiday] })(resolveSite()).pipe(Effect.map((site) => expect(site).toEqual(holiday))),
	);

	it.effect("requires a site on a console hosting several", () =>
		withConsole()(resolveSite()).pipe(
			Effect.flip,
			Effect.map((error) => {
				expect(error._tag).toBe("SiteRequired");
				expect(error.message).toContain("default (Default), x7k2m9q1 (Holiday house)");
			}),
		),
	);

	it.effect("accepts an internal reference, an ID or a name, before the profile's site", () =>
		withConsole({ profileSite: "default" })(
			Effect.all([resolveSite(), resolveSite("x7k2m9q1"), resolveSite(holiday.id), resolveSite("Holiday house")]),
		).pipe(Effect.map((sites) => expect(sites).toEqual([defaultSite, holiday, holiday, holiday]))),
	);

	it.effect("fails, listing the console's sites, for a site that doesn't exist", () =>
		withConsole({ profileSite: "gone" })(resolveSite()).pipe(
			Effect.flip,
			Effect.map((error) => {
				expect(error._tag).toBe("SiteNotFound");
				expect(error.message).toBe(
					`The console has no site "gone". Its sites: default (Default), x7k2m9q1 (Holiday house). Point the profile's site, or the resource's site prop, at one of them.`,
				);
			}),
		),
	);

	it.effect("refuses a name shared by several sites", () =>
		withConsole({
			sites: [
				...FAKE_SITES,
				{ id: "f1e2d3c4-0000-4000-8000-000000000000", internalReference: "abcd1234", name: "Default" },
			],
		})(resolveSite("Default")).pipe(
			Effect.flip,
			Effect.map((error) => expect(error._tag).toBe("AmbiguousSite")),
		),
	);
});
