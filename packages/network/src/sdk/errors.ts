export * from "@distilled.cloud/core/errors";
import * as Category from "@distilled.cloud/core/category";
import * as Schema from "@distilled.cloud/core/schema-lite-typed";

export class UnknownUnifiNetworkError
	extends /*@__PURE__*/ Schema.TaggedError<UnknownUnifiNetworkError>()("UnknownUnifiNetworkError", {
		code: Schema.optional(Schema.String),
		message: Schema.optional(Schema.String),
		body: Schema.Unknown,
	}).pipe(Category.withServerError) {}

export class UnifiNetworkParseError
	extends /*@__PURE__*/ Schema.TaggedError<UnifiNetworkParseError>()("UnifiNetworkParseError", {
		body: Schema.Unknown,
		cause: Schema.Unknown,
	}).pipe(Category.withParseError) {}
