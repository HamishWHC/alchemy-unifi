import * as Sdk from "@alchemy-unifi/network-sdk";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as TestClock from "effect/testing/TestClock";
import { connect, connectorBaseUrl, UnifiNetworkConnection, withConnection } from "../src/Connection.ts";
import type { Connection } from "../src/Credentials.ts";
import { fakeConsole, makeCertificates, TEST_API_KEY } from "./helpers/fake-console.ts";

const certs = makeCertificates();
const apiKey = Redacted.make(TEST_API_KEY);
const local = (url: string, rest: Partial<Extract<Connection, { type: "local" }>> = {}): Connection => ({
	type: "local",
	url,
	apiKey,
	insecure: false,
	...rest,
});

/** A client answering every request with `{ applicationVersion }`, recording request URLs and API keys. */
const recordingClient = () => {
	const requests: Array<{ url: string; apiKey: string | undefined }> = [];
	const client = HttpClient.make((request, url) =>
		Effect.sync(() => {
			requests.push({ url: url.href, apiKey: request.headers["x-api-key"] });
			return HttpClientResponse.fromWeb(
				request,
				new Response(JSON.stringify({ applicationVersion: "10.6.109" }), {
					headers: { "Content-Type": "application/json" },
				}),
			);
		}),
	);
	return { client, requests };
};

describe("connect", () => {
	it.effect("finds a console's Integration API over pinned TLS", () =>
		Effect.gen(function* () {
			const { url } = yield* fakeConsole({ tls: certs });
			const established = yield* connect(local(url, { certFingerprint: certs.leafFingerprint }));
			expect(established.baseUrl).toBe(`${url}/proxy/network/integration`);
			expect(established.applicationVersion).toBe("10.6.109");
		}).pipe(Effect.scoped),
	);

	it.effect("falls back to a standalone controller's path", () =>
		Effect.gen(function* () {
			const { url } = yield* fakeConsole({ prefix: "/integration" });
			expect((yield* connect(local(url))).baseUrl).toBe(`${url}/integration`);
		}).pipe(Effect.scoped),
	);

	it.effect("reports a rejected API key", () =>
		Effect.gen(function* () {
			const { url } = yield* fakeConsole();
			const error = yield* connect(local(url, { apiKey: Redacted.make("wrong") })).pipe(Effect.flip);
			expect(error.message).toBe(`${url} rejected the API key (Unauthorized).`);
		}).pipe(Effect.scoped),
	);

	it.effect("reports a server without the Integration API", () =>
		Effect.gen(function* () {
			const { url } = yield* fakeConsole({ prefix: "/elsewhere" });
			const error = yield* connect(local(url)).pipe(Effect.flip);
			expect(error.message).toContain(`No UniFi Network Integration API at ${url}`);
		}).pipe(Effect.scoped),
	);

	it.effect("reports a certificate mismatch", () =>
		Effect.gen(function* () {
			const { url } = yield* fakeConsole({ tls: certs });
			const error = yield* connect(local(url, { certFingerprint: "AB:".repeat(31) + "AB" })).pipe(Effect.flip);
			expect(error.message).toContain("doesn't match the pinned fingerprint");
		}).pipe(Effect.scoped),
	);

	it.effect("goes through the cloud connector for remote connections", () =>
		Effect.gen(function* () {
			const { client, requests } = recordingClient();
			const established = yield* connect({ type: "remote", consoleId: "abc:123", apiKey }, { client });
			expect(established.baseUrl).toBe(connectorBaseUrl("abc:123"));
			expect(requests).toEqual([
				{
					url: "https://api.ui.com/v1/connector/consoles/abc%3A123/proxy/network/integration/v1/info",
					apiKey: TEST_API_KEY,
				},
			]);
		}).pipe(Effect.scoped),
	);

	it.effect("rate-limits requests through the cloud connector", () =>
		Effect.gen(function* () {
			const { client, requests } = recordingClient();
			const { services } = yield* connect({ type: "remote", consoleId: "abc", apiKey }, { client });
			const burst = yield* Effect.all(
				Array.from({ length: 100 }, () => Sdk.getInfo({})),
				{ concurrency: "unbounded" },
			).pipe(Effect.provide(services), Effect.forkChild);
			yield* TestClock.adjust("1 millis");
			expect(requests.length).toBe(90);
			yield* TestClock.adjust("1 minute");
			yield* Fiber.join(burst);
			expect(requests.length).toBe(101);
		}).pipe(Effect.scoped),
	);
});

describe("withConnection", () => {
	it.effect("runs SDK operations against the established connection", () =>
		Effect.gen(function* () {
			const { url } = yield* fakeConsole();
			const established = yield* connect(local(url));
			const info = yield* withConnection(Sdk.getInfo({})).pipe(
				Effect.provide(Layer.succeed(UnifiNetworkConnection, Effect.succeed(established))),
			);
			expect(info.applicationVersion).toBe("10.6.109");
		}).pipe(Effect.scoped),
	);
});
