import * as Schema from "effect/Schema";

export const UNIFI_NETWORK_AUTH_PROVIDER_NAME = "UnifiNetwork";

/** Site used when a profile or the environment doesn't name one. */
export const DEFAULT_SITE = "default";

/** Values stored in a profile for the `UnifiNetwork` auth provider. */
export const UnifiNetworkAuthConfigSchema = Schema.Union([
	Schema.Struct({
		method: Schema.Literal("local"),
		url: Schema.String,
		apiKey: Schema.String,
		certFingerprint: Schema.optional(Schema.String),
		insecure: Schema.optional(Schema.Boolean),
		site: Schema.String,
	}),
	Schema.Struct({
		method: Schema.Literal("remote"),
		consoleId: Schema.String,
		apiKey: Schema.String,
		site: Schema.String,
	}),
]);

export type UnifiNetworkAuthConfig = typeof UnifiNetworkAuthConfigSchema.Type;
