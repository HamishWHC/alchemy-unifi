import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { AuthProviders, getAuthProvider, presentEnvironment } from "alchemy/Auth/AuthProvider";
import * as Interaction from "alchemy/Interaction";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import {
	type ResolvedCredentials,
	UNIFI_NETWORK_AUTH_PROVIDER_NAME,
	UnifiNetworkAuth,
	type UnifiNetworkAuthConfig,
} from "../src/index.ts";
import { FAKE_SITES, fakeConsole, makeCertificates, TEST_API_KEY } from "./helpers/fake-console.ts";
import { scriptedInteraction } from "./helpers/scripted-interaction.ts";

const FINGERPRINT = "0D:5C:11:B7:22:00:6B:A4:1C:38:68:FC:BA:41:3D:E6:F2:45:4D:53:0E:5E:2D:56:FF:EB:55:3B:64:1B:DD:FC";

const auth = getAuthProvider<UnifiNetworkAuthConfig, ResolvedCredentials>(UNIFI_NETWORK_AUTH_PROVIDER_NAME);

const layer = UnifiNetworkAuth.pipe(
	Layer.provideMerge(
		Layer.mergeAll(
			NodeServices.layer,
			Layer.sync(AuthProviders, () => ({})),
			Interaction.layerNonInteractive(),
		),
	),
);

const configureWith = (method: string, values: Record<string, string>) =>
	auth.pipe(
		Effect.flatMap((a) => a.configureWith?.("test", { method, values }) ?? Effect.die("configureWith is missing")),
	);

const readEnvironment = auth.pipe(Effect.flatMap((a) => a.readEnvironment ?? Effect.die("readEnvironment is missing")));

const configure = (answers: Record<string, unknown>) =>
	Effect.gen(function* () {
		const { service, prompts } = scriptedInteraction(answers);
		const config = yield* (yield* auth)
			.configure("test")
			.pipe(Effect.provideService(Interaction.Interaction, service));
		return { config, prompts };
	});

const withEnv =
	(env: Record<string, string>) =>
	<A, E, R>(effect: Effect.Effect<A, E, R>) =>
		Effect.provideService(effect, ConfigProvider.ConfigProvider, ConfigProvider.fromEnv({ env }));

const plain = (resolved: ResolvedCredentials) => ({
	...resolved,
	connection: { ...resolved.connection, apiKey: Redacted.value(resolved.connection.apiKey) },
});

describe("UnifiNetwork auth provider", () => {
	describe("configureWith", () => {
		it.effect("normalises local values and leaves the site unset", () =>
			Effect.gen(function* () {
				const config = yield* configureWith("local", {
					url: "https://192.168.1.1/",
					apiKey: "key",
					certFingerprint: FINGERPRINT.replaceAll(":", "").toLowerCase(),
				});
				expect(config).toEqual({
					method: "local",
					url: "https://192.168.1.1",
					apiKey: "key",
					certFingerprint: FINGERPRINT,
				});
			}).pipe(Effect.provide(layer)),
		);

		it.effect("accepts remote values", () =>
			Effect.gen(function* () {
				const config = yield* configureWith("remote", { consoleId: "abc:123", apiKey: "key", site: "home" });
				expect(config).toEqual({ method: "remote", consoleId: "abc:123", apiKey: "key", site: "home" });
			}).pipe(Effect.provide(layer)),
		);

		it.effect.each([
			["an unknown method", "cloud", { apiKey: "key" }, "unknown method 'cloud'"],
			["a non-http URL", "local", { url: "ftp://console", apiKey: "key" }, "invalid 'url'"],
			[
				"a malformed fingerprint",
				"local",
				{ url: "https://c", apiKey: "key", certFingerprint: "abc" },
				"invalid 'certFingerprint'",
			],
			[
				"both a fingerprint and insecure",
				"local",
				{ url: "https://c", apiKey: "key", certFingerprint: FINGERPRINT, insecure: "true" },
				"not both",
			],
			[
				"a fingerprint on an http URL",
				"local",
				{ url: "http://c", apiKey: "key", certFingerprint: FINGERPRINT },
				"needs an https: URL",
			],
			["a missing API key", "remote", { consoleId: "abc" }, "missing required field 'apiKey'"],
		] as const)("rejects %s", ([, method, values, message]) =>
			Effect.gen(function* () {
				const error = yield* configureWith(method, values).pipe(Effect.flip);
				expect(error.message).toContain(message);
			}).pipe(Effect.provide(layer)),
		);
	});

	describe("configure", () => {
		const certs = makeCertificates();

		it.effect("pins an untrusted certificate and picks a site", () =>
			Effect.gen(function* () {
				const { url } = yield* fakeConsole({ tls: certs });
				const { config, prompts } = yield* configure({
					"How should Alchemy reach": "local",
					"Console URL": `${url}/`,
					"API key": TEST_API_KEY,
					[`${url} presents an untrusted certificate`]: "pin",
					"Default site": "x7k2m9q1",
				});
				expect(config).toEqual({
					method: "local",
					url,
					apiKey: TEST_API_KEY,
					certFingerprint: certs.leafFingerprint,
					site: "x7k2m9q1",
				});
				const tlsPrompt = prompts.find((p) => p.message.includes("untrusted certificate"));
				expect(tlsPrompt?.options?.[0]?.description).toContain(certs.leafFingerprint);
			}).pipe(Effect.scoped, Effect.provide(layer)),
		);

		it.effect("doesn't store the site of a single-site console", () =>
			Effect.gen(function* () {
				const { url } = yield* fakeConsole({ sites: FAKE_SITES.slice(0, 1) });
				const { config, prompts } = yield* configure({
					"How should Alchemy reach": "local",
					"Console URL": url,
					"API key": TEST_API_KEY,
				});
				expect(config).toEqual({ method: "local", url, apiKey: TEST_API_KEY });
				expect(prompts.map((p) => p.message)).not.toContain("Default site");
			}).pipe(Effect.scoped, Effect.provide(layer)),
		);

		it.effect("can skip verification instead", () =>
			Effect.gen(function* () {
				const { url } = yield* fakeConsole({ tls: certs });
				const { config } = yield* configure({
					"How should Alchemy reach": "local",
					"Console URL": url,
					"API key": TEST_API_KEY,
					[`${url} presents an untrusted certificate`]: "insecure",
					"Default site": "default",
				});
				expect(config).toMatchObject({ method: "local", insecure: true, site: "default" });
				expect(config).not.toHaveProperty("certFingerprint");
			}).pipe(Effect.scoped, Effect.provide(layer)),
		);

		it.effect("fails when the console rejects the key", () =>
			Effect.gen(function* () {
				const { url } = yield* fakeConsole();
				const error = yield* configure({
					"How should Alchemy reach": "local",
					"Console URL": url,
					"API key": "wrong",
				}).pipe(Effect.flip);
				expect(error.message).toContain("rejected the API key");
			}).pipe(Effect.scoped, Effect.provide(layer)),
		);
	});

	it.effect("reads stored values into resolved credentials", () =>
		Effect.gen(function* () {
			const resolved = yield* (yield* auth).read("test", {
				method: "local",
				url: "https://192.168.1.1",
				apiKey: "key",
				insecure: true,
				site: "default",
			});
			expect(plain(resolved)).toEqual({
				connection: {
					type: "local",
					url: "https://192.168.1.1",
					apiKey: "key",
					certFingerprint: undefined,
					insecure: true,
				},
				site: "default",
				source: { type: "profile", profile: "test" },
			});
		}).pipe(Effect.provide(layer)),
	);

	describe("environment", () => {
		it.effect("reads a local connection", () =>
			Effect.gen(function* () {
				const resolved = yield* readEnvironment.pipe(
					withEnv({ UNIFI_URL: "http://localhost:18080", UNIFI_API_KEY: "key", UNIFI_INSECURE: "false" }),
				);
				expect(plain(resolved)).toEqual({
					connection: {
						type: "local",
						url: "http://localhost:18080",
						apiKey: "key",
						certFingerprint: undefined,
						insecure: false,
					},
					source: { type: "env" },
				});
			}).pipe(Effect.provide(layer)),
		);

		it.effect("reads a remote connection", () =>
			Effect.gen(function* () {
				const resolved = yield* readEnvironment.pipe(
					withEnv({ UNIFI_CONSOLE_ID: "abc:123", UNIFI_API_KEY: "key", UNIFI_SITE: "home" }),
				);
				expect(plain(resolved)).toEqual({
					connection: { type: "remote", consoleId: "abc:123", apiKey: "key" },
					site: "home",
					source: { type: "env" },
				});
			}).pipe(Effect.provide(layer)),
		);

		it.effect("rejects both a URL and a console ID", () =>
			Effect.gen(function* () {
				const error = yield* readEnvironment.pipe(
					withEnv({ UNIFI_URL: "https://c", UNIFI_CONSOLE_ID: "abc", UNIFI_API_KEY: "key" }),
					Effect.flip,
				);
				expect(error.message).toContain("not both");
			}).pipe(Effect.provide(layer)),
		);

		it.effect("is used only when a URL or console ID and a key are all set", () =>
			Effect.gen(function* () {
				const { environment } = yield* auth;
				expect(
					yield* presentEnvironment(environment).pipe(withEnv({ UNIFI_API_KEY: "key", UNIFI_SITE: "x" })),
				).toBe(undefined);
				expect(
					yield* presentEnvironment(environment).pipe(
						withEnv({ UNIFI_URL: "https://c", UNIFI_API_KEY: "key" }),
					),
				).toEqual(["UNIFI_URL", "UNIFI_API_KEY"]);
				expect(
					yield* presentEnvironment(environment).pipe(
						withEnv({ UNIFI_CONSOLE_ID: "abc", UNIFI_API_KEY: "key" }),
					),
				).toEqual(["UNIFI_CONSOLE_ID", "UNIFI_API_KEY"]);
			}).pipe(Effect.provide(layer)),
		);
	});
});
