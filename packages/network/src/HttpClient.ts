import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import { buildConnector } from "@effect/platform-node/Undici";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import type * as HttpClient from "effect/http/HttpClient";
import type * as Scope from "effect/Scope";
import * as net from "node:net";
import * as tls from "node:tls";

/** How the client verifies a console's TLS certificate. */
export interface TlsOptions {
	/** Accept the server only if a certificate in its chain has this SHA-256 fingerprint. */
	readonly certFingerprint?: string | undefined;
	/** Skip verification entirely. */
	readonly insecure?: boolean | undefined;
}

/** Normalises a SHA-256 fingerprint to Node's `AB:CD:…` form, or returns `undefined` if it isn't one. */
export const normaliseFingerprint = (value: string): string | undefined => {
	const hex = value.replace(/[\s:]/g, "").toUpperCase();
	return /^[0-9A-F]{64}$/.test(hex) ? (hex.match(/../g) ?? []).join(":") : undefined;
};

/** SHA-256 fingerprints of a peer's certificate chain, leaf first. */
const chainFingerprints = (socket: tls.TLSSocket): ReadonlyArray<string> => {
	const fingerprints: string[] = [];
	let cert: tls.DetailedPeerCertificate | undefined = socket.getPeerCertificate(true);
	while (cert?.fingerprint256 !== undefined && !fingerprints.includes(cert.fingerprint256)) {
		fingerprints.push(cert.fingerprint256);
		cert = cert.issuerCertificate;
	}
	return fingerprints;
};

const PINNING_ERROR_CODE = "ERR_UNIFI_CERT_PINNING";

/**
 * Whether an error (or one of its causes) is a certificate verification or
 * pinning failure. These are deterministic, so they aren't worth retrying.
 */
export const isCertificateError = (error: unknown): boolean => {
	for (let e: unknown = error, depth = 0; typeof e === "object" && e !== null && depth < 5; depth++) {
		const code = "code" in e ? String(e.code) : "";
		if (code === PINNING_ERROR_CODE || /CERT|SELF_SIGNED|UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER/.test(code))
			return true;
		e = "cause" in e ? e.cause : "reason" in e ? e.reason : undefined;
	}
	return false;
};

/**
 * Pinning can't use `checkServerIdentity`: Node skips it when the chain
 * doesn't verify, which is always the case for a console's self-signed
 * certificate. So verification is off, and the connector checks the
 * presented chain itself once the handshake completes. Session resumption
 * is off too, because a resumed session presents no certificate to check.
 */
const pinnedConnector = (fingerprint: string): buildConnector.connector => {
	const connect = buildConnector({ rejectUnauthorized: false, maxCachedSessions: 0 });
	return (options, callback) =>
		connect(options, (error, socket) => {
			if (error !== null) return callback(error, null);
			if (socket instanceof tls.TLSSocket && !chainFingerprints(socket).includes(fingerprint)) {
				socket.destroy();
				return callback(
					Object.assign(
						new Error(
							`The certificate presented by ${options.hostname} doesn't match the pinned fingerprint ${fingerprint}.`,
						),
						{ code: PINNING_ERROR_CODE },
					),
					null,
				);
			}
			callback(null, socket);
		});
};

/** An undici-backed `HttpClient` applying {@link TlsOptions}. The dispatcher closes with the scope. */
export const make = (options: TlsOptions = {}): Effect.Effect<HttpClient.HttpClient, never, Scope.Scope> =>
	NodeHttpClient.makeDispatcherOptions(
		options.certFingerprint !== undefined
			? { connect: pinnedConnector(options.certFingerprint) }
			: options.insecure
				? { connect: { rejectUnauthorized: false } }
				: undefined,
	).pipe(
		Effect.flatMap((dispatcher) =>
			NodeHttpClient.makeUndici.pipe(Effect.provideService(NodeHttpClient.Dispatcher, dispatcher)),
		),
	);

export class CertificateInspectionError extends Data.TaggedError("CertificateInspectionError")<{
	readonly message: string;
	readonly cause?: unknown;
}> {}

export interface PeerCertificate {
	/** Whether Node's default CAs trust the chain for this host. */
	readonly trusted: boolean;
	/** SHA-256 fingerprint of the leaf certificate (`AB:CD:…`). */
	readonly fingerprint: string;
	readonly subject: string;
	readonly validTo: string;
}

/**
 * Connects to an `https:` URL without verifying it and reports the
 * certificate it presents, so `configure` can offer to pin it.
 */
export const inspectCertificate = (url: string): Effect.Effect<PeerCertificate, CertificateInspectionError> =>
	Effect.callback<PeerCertificate, CertificateInspectionError>((resume) => {
		const { hostname, port } = new URL(url);
		const host = hostname.replace(/^\[|\]$/g, "");
		const socket = tls.connect({
			host,
			port: Number(port || 443),
			rejectUnauthorized: false,
			...(net.isIP(host) === 0 ? { servername: host } : {}),
		});
		socket.setTimeout(10_000, () => socket.destroy(new Error(`Timed out connecting to ${url}.`)));
		socket.once("secureConnect", () => {
			const cert = socket.getPeerCertificate();
			resume(
				Effect.succeed({
					trusted: socket.authorized,
					fingerprint: cert.fingerprint256,
					subject: String(cert.subject?.CN ?? cert.subjectaltname ?? "unknown"),
					validTo: cert.valid_to,
				}),
			);
			socket.end();
		});
		socket.once("error", (cause) =>
			resume(Effect.fail(new CertificateInspectionError({ message: cause.message, cause }))),
		);
		return Effect.sync(() => socket.destroy());
	});
