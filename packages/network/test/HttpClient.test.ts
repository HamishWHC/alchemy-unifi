import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import { describeError } from "../src/Connection.ts";
import * as UnifiHttpClient from "../src/HttpClient.ts";
import { fakeConsole, makeCertificates, TEST_API_KEY } from "./helpers/fake-console.ts";

const certs = makeCertificates();

/** Status of `GET /v1/info` on a TLS fake console through a client with `options`. */
const infoStatus = (options: UnifiHttpClient.TlsOptions) =>
	Effect.gen(function* () {
		const { url } = yield* fakeConsole({ tls: certs });
		const client = yield* UnifiHttpClient.make(options);
		const response = yield* client.execute(
			HttpClientRequest.get(`${url}/proxy/network/integration/v1/info`).pipe(
				HttpClientRequest.setHeader("X-API-KEY", TEST_API_KEY),
			),
		);
		return response.status;
	});

describe("HttpClient", () => {
	it.effect("pins the leaf certificate", () =>
		Effect.gen(function* () {
			expect(yield* infoStatus({ certFingerprint: certs.leafFingerprint })).toBe(200);
		}).pipe(Effect.scoped),
	);

	it.effect("checks the pin on every connection, not just the first", () =>
		Effect.gen(function* () {
			const { url } = yield* fakeConsole({ tls: certs });
			const client = yield* UnifiHttpClient.make({ certFingerprint: certs.leafFingerprint });
			// `Connection: close` forces a new TLS connection, which Node would otherwise resume without a certificate.
			const request = HttpClientRequest.get(`${url}/proxy/network/integration/v1/info`).pipe(
				HttpClientRequest.setHeaders({ "X-API-KEY": TEST_API_KEY, Connection: "close" }),
			);
			for (let i = 0; i < 3; i++) expect((yield* client.execute(request)).status).toBe(200);
		}).pipe(Effect.scoped),
	);

	it.effect("pins a CA in the presented chain", () =>
		Effect.gen(function* () {
			expect(yield* infoStatus({ certFingerprint: certs.caFingerprint })).toBe(200);
		}).pipe(Effect.scoped),
	);

	it.effect("rejects a certificate that doesn't match the pin", () =>
		Effect.gen(function* () {
			const other = `${"AB:".repeat(31)}AB`;
			const error = yield* infoStatus({ certFingerprint: other }).pipe(Effect.flip);
			expect(describeError(error)).toContain(`doesn't match the pinned fingerprint ${other}`);
		}).pipe(Effect.scoped),
	);

	it.effect("skips verification when insecure", () =>
		Effect.gen(function* () {
			expect(yield* infoStatus({ insecure: true })).toBe(200);
		}).pipe(Effect.scoped),
	);

	it.effect("verifies normally by default", () =>
		Effect.gen(function* () {
			const error = yield* infoStatus({}).pipe(Effect.flip);
			expect(describeError(error)).toMatch(/self[- ]signed certificate/i);
		}).pipe(Effect.scoped),
	);

	it.effect("inspects the presented certificate", () =>
		Effect.gen(function* () {
			const { url } = yield* fakeConsole({ tls: certs });
			const cert = yield* UnifiHttpClient.inspectCertificate(url);
			expect(cert).toMatchObject({ trusted: false, fingerprint: certs.leafFingerprint, subject: "localhost" });
		}).pipe(Effect.scoped),
	);

	it("normalises fingerprints", () => {
		const colons = certs.leafFingerprint;
		expect(UnifiHttpClient.normaliseFingerprint(colons.replaceAll(":", "").toLowerCase())).toBe(colons);
		expect(UnifiHttpClient.normaliseFingerprint(` ${colons} `)).toBe(colons);
		expect(UnifiHttpClient.normaliseFingerprint("abc")).toBeUndefined();
	});
});
