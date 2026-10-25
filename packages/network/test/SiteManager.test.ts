import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as Redacted from "effect/Redacted";
import { listConsoles } from "../src/SiteManager.ts";

const pages: Record<string, unknown> = {
	"": {
		data: [{ id: "A:1", type: "console", reportedState: { name: "Home", hostname: "udm-home" } }],
		nextToken: "page2",
		httpStatusCode: 200,
	},
	page2: { data: [{ id: "B:2", type: "console", reportedState: { hostname: "udm-holiday" } }, { id: "C:3" }] },
};

describe("listConsoles", () => {
	it.effect("follows pagination and falls back from name to hostname to ID", () =>
		Effect.gen(function* () {
			const requests: Array<{ url: string; apiKey: string | undefined }> = [];
			const client = HttpClient.make((request, url) =>
				Effect.sync(() => {
					requests.push({ url: url.href, apiKey: request.headers["x-api-key"] });
					return HttpClientResponse.fromWeb(
						request,
						Response.json(pages[url.searchParams.get("nextToken") ?? ""]),
					);
				}),
			);
			const consoles = yield* listConsoles(Redacted.make("key")).pipe(
				Effect.provideService(HttpClient.HttpClient, client),
			);
			expect(consoles).toEqual([
				{ id: "A:1", name: "Home", type: "console" },
				{ id: "B:2", name: "udm-holiday", type: "console" },
				{ id: "C:3", name: "C:3", type: undefined },
			]);
			expect(requests).toEqual([
				{ url: "https://api.ui.com/v1/hosts", apiKey: "key" },
				{ url: "https://api.ui.com/v1/hosts?nextToken=page2", apiKey: "key" },
			]);
		}),
	);
});
