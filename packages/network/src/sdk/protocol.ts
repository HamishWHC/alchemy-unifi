import type * as API from "@distilled.cloud/core/api";
import type { API_ERRORS, ConfigError } from "@distilled.cloud/core/errors";
import { makeRestProtocol, type RestErrorEnvelope } from "@distilled.cloud/core/protocol-rest";
import * as Effect from "effect/Effect";
import type * as HttpClient from "effect/http/HttpClient";
import type * as HttpClientError from "effect/http/HttpClientError";
import type * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { Credentials, type Config } from "./credentials.ts";
import { UnifiNetworkParseError, UnknownUnifiNetworkError } from "./errors.ts";

export type UnifiNetworkOpError =
	| InstanceType<(typeof API_ERRORS)[number]>
	| UnknownUnifiNetworkError
	| ConfigError
	| HttpClientError.HttpClientError
	| UnifiNetworkParseError;

export type UnifiNetworkOpContext = Credentials | HttpClient.HttpClient;

const stringField = (body: object, key: string) => {
	const value: unknown = Reflect.get(body, key);
	return typeof value === "string" ? value : undefined;
};

/**
 * Network API errors are `{ statusCode, statusName, code, message, ... }`; the
 * cloud connector's own errors are `{ code, httpStatusCode, message, traceId }`.
 */
const errorEnvelope = (body: unknown): RestErrorEnvelope | undefined => {
	if (body === null || typeof body !== "object") return undefined;
	const code = stringField(body, "code") ?? stringField(body, "statusName");
	const message = stringField(body, "message");
	if (code === undefined && message === undefined) return undefined;
	return { ...(code === undefined ? {} : { code }), ...(message === undefined ? {} : { message }) };
};

export const UnifiNetworkProtocol: Layer.Layer<API.Protocol> = makeRestProtocol<Config>({
	credentials: Effect.flatMap(Credentials, (resolve) => resolve),
	baseUrl: (creds) => creds.baseUrl,
	headers: (creds) => ({ "X-API-KEY": Redacted.value(creds.apiKey) }),
	errorEnvelope,
	unknownError: ({ code, message, body }) =>
		new UnknownUnifiNetworkError({ code: code === undefined ? undefined : String(code), message, body }),
	parseError: ({ body, cause }) => new UnifiNetworkParseError({ body, cause }),
});
