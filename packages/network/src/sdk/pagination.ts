import { getPath, type PaginatedTrait } from "@distilled.cloud/core/pagination";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

/** UniFi lists: `offset`/`limit` in, `{ offset, count, totalCount, data }` out. */
export const paginateOffset = <Input extends Record<string, unknown>, Output, E, R>(
	operation: (input: Input) => Effect.Effect<Output, E, R>,
	input: Input,
	_pagination: PaginatedTrait,
): Stream.Stream<Output, E, R> =>
	Stream.unfold<number | undefined, Output, E, R>(Number(input["offset"] ?? 0), (offset) =>
		offset === undefined
			? Effect.succeed(undefined)
			: Effect.map(operation({ ...input, offset }), (page) => {
					const count = Number(getPath(page, "count") ?? 0);
					const total = Number(getPath(page, "totalCount") ?? 0);
					const next = offset + count;
					return [page, count > 0 && next < total ? next : undefined] as const;
				}),
	);
