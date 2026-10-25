import * as Effect from "effect/Effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { SITE_MANAGER_URL } from "./Connection.ts";

/**
 * Just enough of the Site Manager API (`GET /v1/hosts`) for `configure` to
 * list the consoles a key can reach. A full SDK belongs in its own package.
 */
const Host = Schema.Struct({
	id: Schema.String,
	type: Schema.optional(Schema.NullOr(Schema.String)),
	reportedState: Schema.optional(
		Schema.NullOr(
			Schema.Struct({
				name: Schema.optional(Schema.NullOr(Schema.String)),
				hostname: Schema.optional(Schema.NullOr(Schema.String)),
			}),
		),
	),
});

const HostsPage = Schema.Struct({
	data: Schema.Array(Host),
	nextToken: Schema.optional(Schema.NullOr(Schema.String)),
});

export interface Console {
	/** The host ID, which the cloud connector takes as the console ID. */
	readonly id: string;
	readonly name: string;
	/** Host type as reported by Site Manager, e.g. `console`. */
	readonly type: string | undefined;
}

export const listConsoles = (
	apiKey: Redacted.Redacted<string>,
): Effect.Effect<ReadonlyArray<Console>, unknown, HttpClient.HttpClient> =>
	Effect.gen(function* () {
		const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);
		const consoles: Console[] = [];
		let nextToken: string | undefined;
		do {
			const page = yield* client
				.execute(
					HttpClientRequest.get(`${SITE_MANAGER_URL}/v1/hosts`).pipe(
						HttpClientRequest.setHeaders({
							"X-API-KEY": Redacted.value(apiKey),
							Accept: "application/json",
						}),
						HttpClientRequest.setUrlParams(nextToken === undefined ? {} : { nextToken }),
					),
				)
				.pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(HostsPage)));
			for (const host of page.data) {
				consoles.push({
					id: host.id,
					name: host.reportedState?.name ?? host.reportedState?.hostname ?? host.id,
					type: host.type ?? undefined,
				});
			}
			nextToken = page.nextToken ?? undefined;
		} while (nextToken !== undefined);
		return consoles;
	});
