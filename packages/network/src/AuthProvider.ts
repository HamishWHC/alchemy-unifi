import * as Sdk from "@alchemy-unifi/network-sdk";
import {
	AuthError,
	AuthProviderLayer,
	type ConfigureField,
	type ConfigureMethod,
	type EnvironmentVariable,
	type ProviderDetailLine,
} from "alchemy/Auth/AuthProvider";
import { displayRedacted } from "alchemy/Auth/Credentials";
import { getEnv, getEnvRedactedRequired, mapPromptCancellation } from "alchemy/Auth/Env";
import { storedSecret, storedValueText, validateFieldValues } from "alchemy/Auth/StoredAuthProvider";
import * as Interaction from "alchemy/Interaction";
import * as Effect from "effect/Effect";
import * as HttpClient from "effect/http/HttpClient";
import * as Redacted from "effect/Redacted";
import {
	UNIFI_NETWORK_AUTH_PROVIDER_NAME,
	type UnifiNetworkAuthConfig,
	UnifiNetworkAuthConfigSchema,
} from "./AuthConfig.ts";
import { connect, describeError } from "./Connection.ts";
import type { Connection, ResolvedCredentials } from "./Credentials.ts";
import * as UnifiHttpClient from "./HttpClient.ts";
import * as SiteManager from "./SiteManager.ts";

export { UNIFI_NETWORK_AUTH_PROVIDER_NAME, type UnifiNetworkAuthConfig, UnifiNetworkAuthConfigSchema };

const NAME = UNIFI_NETWORK_AUTH_PROVIDER_NAME;

const authError = (message: string, cause?: unknown) =>
	AuthError.make({ message: `${NAME}: ${message}`, ...(cause === undefined ? {} : { cause }) });

/** Normalises a console URL (no trailing slash), or returns `undefined` if it isn't `http(s):`. */
export const parseConsoleUrl = (value: string): string | undefined => {
	try {
		const url = new URL(value.trim());
		if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
		return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
	} catch {
		return undefined;
	}
};

const parseBoolean = (value: string): boolean | undefined =>
	/^(true|1|yes)$/i.test(value) ? true : /^(false|0|no|)$/i.test(value) ? false : undefined;

const validateUrl = (value: string) =>
	parseConsoleUrl(value) === undefined ? "Expected an http(s) URL such as https://192.168.1.1" : undefined;
const validateFingerprint = (value: string) =>
	UnifiHttpClient.normaliseFingerprint(value) === undefined
		? "Expected a SHA-256 fingerprint: 64 hex digits, optionally colon-separated"
		: undefined;
const validateBoolean = (value: string) => (parseBoolean(value) === undefined ? "Expected true or false" : undefined);
const required = (value: string) => (value.length === 0 ? "Required" : undefined);

interface Input {
	readonly method: "local" | "remote";
	readonly url?: string | undefined;
	readonly consoleId?: string | undefined;
	readonly apiKey: Redacted.Redacted<string>;
	readonly certFingerprint?: string | undefined;
	readonly insecure?: boolean | undefined;
	readonly site?: string | undefined;
}

/** Credentials minus their {@link ResolvedCredentials.source}: what profile and environment values both describe. */
type Settings = Omit<ResolvedCredentials, "source">;

/** Validates stored, entered or environment values. `source` names them in errors. */
const resolve = (input: Input, source: string): Effect.Effect<Settings, AuthError> =>
	Effect.gen(function* () {
		const site = input.site || undefined;
		if (input.method === "remote") {
			if (!input.consoleId) return yield* authError(`no console ID (${source}).`);
			return { connection: { type: "remote", consoleId: input.consoleId, apiKey: input.apiKey }, site };
		}
		const url = parseConsoleUrl(input.url ?? "");
		if (url === undefined) return yield* authError(`'${input.url ?? ""}' is not an http(s) URL (${source}).`);
		const certFingerprint =
			input.certFingerprint === undefined
				? undefined
				: UnifiHttpClient.normaliseFingerprint(input.certFingerprint);
		if (input.certFingerprint !== undefined && certFingerprint === undefined) {
			return yield* authError(`'${input.certFingerprint}' is not a SHA-256 fingerprint (${source}).`);
		}
		if (certFingerprint !== undefined && input.insecure) {
			return yield* authError(`set a certificate fingerprint or insecure, not both (${source}).`);
		}
		if (certFingerprint !== undefined && url.startsWith("http:")) {
			return yield* authError(`a certificate fingerprint needs an https: URL (${source}).`);
		}
		return {
			connection: {
				type: "local",
				url,
				apiKey: input.apiKey,
				certFingerprint,
				insecure: input.insecure ?? false,
			},
			site,
		};
	});

const fromConfig = (
	profileName: string,
	config: UnifiNetworkAuthConfig,
): Effect.Effect<ResolvedCredentials, AuthError> =>
	resolve({ ...config, apiKey: Redacted.make(config.apiKey) }, `profile '${profileName}'`).pipe(
		Effect.map((settings) => ({ ...settings, source: { type: "profile", profile: profileName } })),
	);

const toConfig = ({ connection, site }: Settings): UnifiNetworkAuthConfig =>
	connection.type === "remote"
		? {
				method: "remote",
				consoleId: connection.consoleId,
				apiKey: Redacted.value(connection.apiKey),
				...(site === undefined ? {} : { site }),
			}
		: {
				method: "local",
				url: connection.url,
				apiKey: Redacted.value(connection.apiKey),
				...(connection.certFingerprint === undefined ? {} : { certFingerprint: connection.certFingerprint }),
				...(connection.insecure ? { insecure: true } : {}),
				...(site === undefined ? {} : { site }),
			};

const siteField: ConfigureField = {
	name: "site",
	label: "Default site",
	description:
		"Only for consoles hosting several sites: internal reference (e.g. default) or name of the site resources use when they don't set one.",
	optional: true,
};

const configureMethods: ReadonlyArray<ConfigureMethod> = [
	{
		method: "local",
		fields: [
			{ name: "url", label: "Console URL", placeholder: "https://192.168.1.1", validate: validateUrl },
			{ name: "apiKey", label: "API key", secret: true },
			{
				name: "certFingerprint",
				label: "Certificate SHA-256 fingerprint",
				description: "Pin the console's certificate (or a CA in its chain) instead of verifying it.",
				optional: true,
				validate: validateFingerprint,
			},
			{
				name: "insecure",
				label: "Skip TLS verification",
				optional: true,
				validate: validateBoolean,
			},
			siteField,
		],
	},
	{
		method: "remote",
		fields: [
			{ name: "consoleId", label: "Console ID", description: "The console's host ID in Site Manager." },
			{ name: "apiKey", label: "Site Manager API key", secret: true },
			siteField,
		],
	},
];

const environment: ReadonlyArray<EnvironmentVariable> = [
	{
		name: "UNIFI_URL",
		required: true,
		alternatives: ["UNIFI_CONSOLE_ID"],
		description:
			"URL of the console or controller, e.g. https://192.168.1.1. To go through the ui.com cloud connector instead, set UNIFI_CONSOLE_ID to the console's host ID.",
	},
	{
		name: "UNIFI_API_KEY",
		required: true,
		secret: true,
		description: "A Network API key (local) or a Site Manager API key (remote).",
	},
	{
		name: "UNIFI_CERT_FINGERPRINT",
		required: false,
		description: "Local only: SHA-256 fingerprint of the console's certificate (or a CA in its chain) to pin.",
	},
	{ name: "UNIFI_INSECURE", required: false, description: "Local only: true to skip TLS verification." },
	{
		name: "UNIFI_SITE",
		required: false,
		description: "Default site, for consoles hosting several. Unset means the console's only site.",
	},
];

const readEnvironmentSettings = Effect.gen(function* () {
	const apiKey = yield* getEnvRedactedRequired("UNIFI_API_KEY");
	const url = yield* getEnv("UNIFI_URL");
	const consoleId = yield* getEnv("UNIFI_CONSOLE_ID");
	const site = yield* getEnv("UNIFI_SITE");
	if (url && consoleId) return yield* authError("set UNIFI_URL or UNIFI_CONSOLE_ID, not both.");
	if (consoleId)
		return yield* resolve({ method: "remote", consoleId, apiKey, site }, "UNIFI_* environment variables");
	if (!url) return yield* authError("set UNIFI_URL (local) or UNIFI_CONSOLE_ID (remote) along with UNIFI_API_KEY.");
	const insecureValue = (yield* getEnv("UNIFI_INSECURE")) ?? "";
	const insecure = parseBoolean(insecureValue);
	if (insecure === undefined)
		return yield* authError(`UNIFI_INSECURE must be true or false, not '${insecureValue}'.`);
	const certFingerprint = (yield* getEnv("UNIFI_CERT_FINGERPRINT")) || undefined;
	return yield* resolve(
		{ method: "local", url, apiKey, certFingerprint, insecure, site },
		"UNIFI_* environment variables",
	);
});

const readEnvironment: Effect.Effect<ResolvedCredentials, AuthError> = readEnvironmentSettings.pipe(
	Effect.map((settings) => ({ ...settings, source: { type: "env" } })),
);

/** Runs `f` against a freshly established connection, mapping connection failures to `AuthError`. */
const withEstablished = <A, E>(
	connection: Connection,
	f: (established: Effect.Success<ReturnType<typeof connect>>) => Effect.Effect<A, E>,
) =>
	Effect.scoped(Effect.flatMap(connect(connection), f)).pipe(
		Effect.mapError((error) => (error instanceof AuthError ? error : authError(describeError(error), error))),
	);

const configureWith = (
	_profileName: string,
	input: { readonly method: string; readonly values: Record<string, string> },
): Effect.Effect<UnifiNetworkAuthConfig, AuthError> =>
	Effect.gen(function* () {
		const method = configureMethods.find((m) => m.method === input.method);
		if (method === undefined) {
			return yield* authError(`unknown method '${input.method}'. Valid methods: local, remote.`);
		}
		const values = yield* validateFieldValues(NAME, method.fields, input.values);
		const insecure = storedValueText(values["insecure"]);
		const resolved = yield* resolve(
			{
				method: method.method === "remote" ? "remote" : "local",
				url: storedValueText(values["url"]),
				consoleId: storedValueText(values["consoleId"]),
				apiKey: storedSecret(values["apiKey"]) ?? Redacted.make(""),
				certFingerprint: storedValueText(values["certFingerprint"]),
				insecure: insecure === undefined ? undefined : parseBoolean(insecure),
				site: storedValueText(values["site"]),
			},
			"--set values",
		);
		return toConfig(resolved);
	});

const details = (profileName: string, config: UnifiNetworkAuthConfig) =>
	Effect.gen(function* () {
		const { connection, site } = yield* fromConfig(profileName, config);
		const lines: ProviderDetailLine[] =
			connection.type === "remote"
				? [
						{ key: "method", value: "remote (ui.com cloud connector)" },
						{ key: "consoleId", value: connection.consoleId },
					]
				: [
						{ key: "method", value: "local" },
						{ key: "url", value: connection.url },
						{
							key: "tls",
							value: connection.url.startsWith("http:")
								? "none (http)"
								: connection.certFingerprint !== undefined
									? `pinned ${connection.certFingerprint}`
									: connection.insecure
										? "not verified"
										: "verified",
						},
					];
		lines.push({ key: "apiKey", value: displayRedacted(connection.apiKey) });
		if (site !== undefined) lines.push({ key: "site", value: site });
		const network = yield* withEstablished(connection, (established) =>
			Effect.succeed(`UniFi Network ${established.applicationVersion}`),
		).pipe(Effect.catch((error) => Effect.succeed(`unreachable (${error.message})`)));
		lines.push({ key: "network", value: network });
		return { lines };
	});

export const UnifiNetworkAuth = AuthProviderLayer<UnifiNetworkAuthConfig, ResolvedCredentials>()(
	NAME,
	Effect.gen(function* () {
		const interaction = Interaction.accessors;

		/**
		 * Lists the console's sites and, if there are several, lets the user
		 * pick the default (remembering `current`). A single site isn't stored.
		 */
		const pickSite = (connection: Connection, current: string | undefined) =>
			Effect.gen(function* () {
				const { applicationVersion, sites } = yield* withEstablished(connection, (established) =>
					Sdk.getSiteOverviewPage({ limit: 200 }).pipe(
						Effect.provide(established.services),
						Effect.map((page) => ({
							applicationVersion: established.applicationVersion,
							sites: page.data,
						})),
					),
				);
				yield* interaction.output.info(`Connected to UniFi Network ${applicationVersion}.`);
				const [only] = sites;
				if (only === undefined) return yield* authError("the console has no sites.");
				if (sites.length === 1) {
					yield* interaction.output.info(`The console has one site, ${only.name}; resources will use it.`);
					return undefined;
				}
				return yield* interaction.prompt
					.select({
						message: "Default site",
						searchable: true,
						...(current !== undefined && sites.some((s) => s.internalReference === current)
							? { initialValue: current }
							: {}),
						options: sites.map((s) => ({
							value: s.internalReference,
							label: s.name,
							description: s.internalReference,
						})),
					})
					.pipe(mapPromptCancellation);
			});

		const promptApiKey = (message: string, description: string) =>
			interaction.prompt
				.password({ message, description, validate: required })
				.pipe(mapPromptCancellation, Effect.map(Redacted.make));

		const configureLocal = (current: UnifiNetworkAuthConfig | undefined) =>
			Effect.gen(function* () {
				const url = yield* interaction.prompt
					.text({
						message: "Console URL",
						description: "The console's or self-hosted controller's address on your network.",
						placeholder: "https://192.168.1.1",
						...(current?.method === "local" ? { defaultValue: current.url } : {}),
						validate: validateUrl,
					})
					.pipe(
						mapPromptCancellation,
						Effect.map((value) => parseConsoleUrl(value) ?? value),
					);
				const apiKey = yield* promptApiKey(
					"API key",
					"Create one in UniFi Network under Settings → Integrations.",
				);

				let tls: { certFingerprint?: string; insecure?: boolean } = {};
				if (url.startsWith("https:")) {
					const cert = yield* UnifiHttpClient.inspectCertificate(url).pipe(
						Effect.mapError((error) =>
							authError(`could not connect to ${url}: ${describeError(error)}`, error),
						),
					);
					if (cert.trusted) {
						yield* interaction.output.info(
							"The console's certificate is publicly trusted; it will be verified normally.",
						);
					} else {
						const choice = yield* interaction.prompt
							.select({
								message: `${url} presents an untrusted certificate (${cert.subject}, valid until ${cert.validTo})`,
								options: [
									{
										value: "pin" as const,
										label: "Pin this certificate",
										description: `SHA-256 ${cert.fingerprint}. Check it matches the console's before choosing this.`,
									},
									{
										value: "insecure" as const,
										label: "Skip verification",
										description:
											"Accept any certificate. Anyone on the network path could intercept the API key.",
									},
								],
							})
							.pipe(mapPromptCancellation);
						tls = choice === "pin" ? { certFingerprint: cert.fingerprint } : { insecure: true };
					}
				}

				const resolved = yield* resolve({ method: "local", url, apiKey, ...tls }, "entered values");
				const site = yield* pickSite(resolved.connection, current?.site);
				return toConfig({ ...resolved, site });
			});

		const configureRemote = (current: UnifiNetworkAuthConfig | undefined) =>
			Effect.gen(function* () {
				const apiKey = yield* promptApiKey("Site Manager API key", "Create one at unifi.ui.com under API.");
				const consoles = yield* Effect.scoped(
					UnifiHttpClient.make().pipe(
						Effect.flatMap((client) =>
							SiteManager.listConsoles(apiKey).pipe(Effect.provideService(HttpClient.HttpClient, client)),
						),
					),
				).pipe(
					Effect.mapError((error) => authError(`could not list consoles: ${describeError(error)}`, error)),
				);
				const [only] = consoles;
				if (only === undefined) return yield* authError("this API key can't see any consoles.");
				const consoleId =
					consoles.length === 1
						? only.id
						: yield* interaction.prompt
								.select({
									message: "Console",
									searchable: true,
									...(current?.method === "remote" && consoles.some((c) => c.id === current.consoleId)
										? { initialValue: current.consoleId }
										: {}),
									options: consoles.map((c) => ({
										value: c.id,
										label: c.name,
										description: c.type === undefined ? c.id : `${c.type} · ${c.id}`,
									})),
								})
								.pipe(mapPromptCancellation);
				if (consoles.length === 1) yield* interaction.output.info(`Using console ${only.name}.`);
				const resolved = yield* resolve({ method: "remote", consoleId, apiKey }, "entered values");
				const site = yield* pickSite(resolved.connection, current?.site);
				return toConfig({ ...resolved, site });
			});

		const configure = (_profileName: string, current?: UnifiNetworkAuthConfig) =>
			Effect.gen(function* () {
				const method = yield* interaction.prompt
					.select({
						message: "How should Alchemy reach the console?",
						initialValue: current?.method ?? ("local" as const),
						options: [
							{
								value: "local" as const,
								label: "Directly",
								description: "the console's or controller's URL on your network",
							},
							{
								value: "remote" as const,
								label: "Through ui.com",
								description: "the api.ui.com cloud connector, from anywhere",
							},
						],
					})
					.pipe(mapPromptCancellation);
				const config = yield* method === "local" ? configureLocal(current) : configureRemote(current);
				yield* interaction.output.success(`${NAME}: credentials saved.`);
				return config;
			});

		return {
			configSchema: UnifiNetworkAuthConfigSchema,
			configure,
			configureWith,
			configureMethods,
			login: (_profileName: string, config: UnifiNetworkAuthConfig) => Effect.succeed(config),
			logout: () => Effect.void,
			details,
			read: fromConfig,
			readEnvironment,
			environment,
		};
	}),
);
