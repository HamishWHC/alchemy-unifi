import * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";
import { execFileSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import * as fs from "node:fs";
import * as http from "node:http";
import * as https from "node:https";
import * as os from "node:os";
import * as path from "node:path";

export interface TestCertificates {
	/** Server key and the chain it presents (leaf, then CA). */
	readonly key: string;
	readonly chain: string;
	readonly leafFingerprint: string;
	readonly caFingerprint: string;
}

/** A throwaway CA and a `localhost` certificate it signed, generated with `openssl` so no keys are committed. */
const openssl = (...args: string[]) => execFileSync("openssl", args, { stdio: "pipe" });

export const makeCertificates = (): TestCertificates => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alchemy-unifi-tls-"));
	const file = (name: string) => path.join(dir, name);
	try {
		const newKey = ["-newkey", "rsa:2048", "-nodes", "-sha256"];
		openssl(
			"req",
			"-x509",
			...newKey,
			"-days",
			"2",
			"-subj",
			"/CN=alchemy-unifi test CA",
			"-keyout",
			file("ca.key"),
			"-out",
			file("ca.crt"),
		);
		openssl("req", ...newKey, "-subj", "/CN=localhost", "-keyout", file("server.key"), "-out", file("server.csr"));
		fs.writeFileSync(file("ext.cnf"), "subjectAltName=DNS:localhost,IP:127.0.0.1\n");
		openssl(
			"x509",
			"-req",
			"-in",
			file("server.csr"),
			"-CA",
			file("ca.crt"),
			"-CAkey",
			file("ca.key"),
			"-CAcreateserial",
			"-days",
			"2",
			"-sha256",
			"-extfile",
			file("ext.cnf"),
			"-out",
			file("server.crt"),
		);
		const ca = fs.readFileSync(file("ca.crt"), "utf8");
		const leaf = fs.readFileSync(file("server.crt"), "utf8");
		return {
			key: fs.readFileSync(file("server.key"), "utf8"),
			chain: leaf + ca,
			leafFingerprint: new X509Certificate(leaf).fingerprint256,
			caFingerprint: new X509Certificate(ca).fingerprint256,
		};
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
};

export const TEST_API_KEY = "test-key";

export const FAKE_DEFAULT_SITE = {
	id: "88f7af54-98f8-306a-a1c7-c9349722b1f6",
	internalReference: "default",
	name: "Default",
};
export const FAKE_OTHER_SITE = {
	id: "2f4f8f0e-0d6c-4b8e-9d0e-0f9a8b7c6d5e",
	internalReference: "x7k2m9q1",
	name: "Holiday house",
};
export const FAKE_SITES = [FAKE_DEFAULT_SITE, FAKE_OTHER_SITE];

export interface FakeConsoleOptions {
	/** Serve over TLS with these certificates. */
	readonly tls?: TestCertificates;
	/** Integration API prefix: a console's by default, `/integration` for a standalone controller. */
	readonly prefix?: string;
	readonly applicationVersion?: string;
	/** Sites `/v1/sites` lists (default: {@link FAKE_SITES}). */
	readonly sites?: ReadonlyArray<(typeof FAKE_SITES)[number]>;
}

/**
 * A server answering `GET {prefix}/v1/info` and `/v1/sites` like the Network
 * app (401 for a wrong key, 404 for anything else), on a random localhost port.
 */
export const fakeConsole = (
	options: FakeConsoleOptions = {},
): Effect.Effect<{ readonly url: string }, never, Scope.Scope> =>
	Effect.acquireRelease(
		Effect.callback<http.Server>((resume) => {
			const prefix = options.prefix ?? "/proxy/network/integration";
			const handler: http.RequestListener = (req, res) => {
				const json = (status: number, body: unknown) => {
					res.writeHead(status, { "Content-Type": "application/json" });
					res.end(JSON.stringify(body));
				};
				const route = req.url?.split("?")[0];
				if (route !== `${prefix}/v1/info` && route !== `${prefix}/v1/sites`) {
					return json(404, { statusCode: 404, statusName: "NOT_FOUND", message: "Not found" });
				}
				if (req.headers["x-api-key"] !== TEST_API_KEY) {
					return json(401, { statusCode: 401, statusName: "UNAUTHORIZED", message: "Unauthorized" });
				}
				if (route === `${prefix}/v1/sites`) {
					const sites = options.sites ?? FAKE_SITES;
					return json(200, {
						offset: 0,
						limit: 200,
						count: sites.length,
						totalCount: sites.length,
						data: sites,
					});
				}
				json(200, { applicationVersion: options.applicationVersion ?? "10.6.109" });
			};
			const server = options.tls
				? https.createServer({ key: options.tls.key, cert: options.tls.chain }, handler)
				: http.createServer(handler);
			server.listen(0, "127.0.0.1", () => resume(Effect.succeed(server)));
		}),
		(server) =>
			Effect.callback<void>((resume) => {
				server.close(() => resume(Effect.void));
				server.closeAllConnections();
			}),
	).pipe(
		Effect.map((server) => {
			const address = server.address();
			const port = typeof address === "object" && address !== null ? address.port : 0;
			return { url: `${options.tls ? "https" : "http"}://127.0.0.1:${port}` };
		}),
	);
