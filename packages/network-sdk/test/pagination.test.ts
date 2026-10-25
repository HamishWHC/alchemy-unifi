import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { paginateOffset } from "../src/pagination.ts";

const pagination = {
	mode: "token",
	inputToken: "offset",
	outputToken: "offset",
	items: "data",
	pageSize: "limit",
} as const;

/** A page claiming more items than it has. */
const emptyPage = () => Effect.succeed({ offset: 0, limit: 25, count: 0, totalCount: 10, data: [] });

describe("paginateOffset", () => {
	it.effect("advances the offset by each page's count until totalCount", () =>
		Effect.gen(function* () {
			const offsets: Array<number> = [];
			const items = [1, 2, 3, 4, 5];
			const page = (input: { offset?: number; limit: number }) =>
				Effect.sync(() => {
					const offset = input.offset ?? 0;
					offsets.push(offset);
					const data = items.slice(offset, offset + input.limit);
					return { offset, limit: input.limit, count: data.length, totalCount: items.length, data };
				});
			const pages = yield* Stream.runCollect(paginateOffset(page, { limit: 2 }, pagination));
			expect(pages.map((p) => p.data)).toEqual([[1, 2], [3, 4], [5]]);
			expect(offsets).toEqual([0, 2, 4]);
		}),
	);

	it.effect("stops on an empty page, even if totalCount says otherwise", () =>
		Effect.gen(function* () {
			expect(yield* Stream.runCollect(paginateOffset(emptyPage, {}, pagination))).toHaveLength(1);
		}),
	);
});
