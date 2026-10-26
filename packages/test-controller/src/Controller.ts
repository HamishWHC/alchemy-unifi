import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Cookies from "effect/http/Cookies";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as ChildProcess from "effect/process/ChildProcess";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { fileURLToPath } from "node:url";

/** Where tests reach the controller: like a UniFi OS console's root URL, with an API key. */
export interface Controller {
	readonly url: string;
	readonly apiKey: string;
	/** The Integration API base URL, for SDK calls. */
	readonly baseUrl: string;
}

export const CONTROLLER: Controller = {
	url: "http://localhost:18080",
	apiKey: "alchemy-unifi-test-key",
	baseUrl: "http://localhost:18080/proxy/network/integration",
};

/** A UniFi site created for one test file. */
export interface TestSite {
	/** The Integration API's site ID. */
	readonly id: string;
	/** The site's internal reference, e.g. `x7k2m9q1`. */
	readonly internalReference: string;
	readonly name: string;
}

export class ControllerError extends Data.TaggedError("ControllerError")<{
	readonly message: string;
	readonly cause?: unknown;
}> {}

const PACKAGE_DIR = fileURLToPath(new URL("..", import.meta.url));
/** The standalone UI and legacy API, with a self-signed certificate. */
const ADMIN_URL = "https://localhost:18443";
const ADMIN = { username: "admin", password: "Test-Passw0rd!" };
/** Test sites are named `<prefix><creation time in ms>-<random>`, so leftovers can be recognised and aged. */
const TEST_SITE_PREFIX = "alchemy-unifi-test-";
const STALE_AFTER_MS = 60 * 60 * 1000;

const fail = (message: string) => (cause: unknown) => new ControllerError({ message, cause });

const docker = (...args: ReadonlyArray<string>) =>
	Effect.scoped(
		Effect.gen(function* () {
			const handle = yield* ChildProcess.make("docker", args, { cwd: PACKAGE_DIR });
			const [output, exitCode] = yield* Effect.all(
				[handle.all.pipe(Stream.decodeText(), Stream.mkString), handle.exitCode],
				{ concurrency: "unbounded" },
			);
			if (exitCode !== 0) {
				return yield* new ControllerError({
					message: `docker ${args[0]} ${args[1]} exited with ${exitCode}:\n${output}`,
				});
			}
			return output;
		}),
	).pipe(Effect.mapError((error) => (error instanceof ControllerError ? error : fail("Couldn't run docker")(error))));

const mongo = (script: string) =>
	docker("compose", "exec", "-T", "mongo", "mongosh", "-u", "root", "-p", "root", "--quiet", "--eval", script);

const LegacySite = Schema.Struct({
	_id: Schema.String,
	name: Schema.String,
	desc: Schema.String,
	external_id: Schema.optionalKey(Schema.String),
});
type LegacySite = typeof LegacySite.Type;

const LegacySites = Schema.Struct({ data: Schema.Array(LegacySite) });

/** A logged-in session on the legacy API. */
const adminSession = Effect.gen(function* () {
	const dispatcher = yield* NodeHttpClient.makeDispatcherOptions({ connect: { rejectUnauthorized: false } });
	const base = yield* NodeHttpClient.makeUndici.pipe(Effect.provideService(NodeHttpClient.Dispatcher, dispatcher));
	const cookies = yield* Ref.make(Cookies.empty);
	const client = base.pipe(
		HttpClient.mapRequest(HttpClientRequest.prependUrl(ADMIN_URL)),
		HttpClient.filterStatusOk,
		HttpClient.withCookiesRef(cookies),
	);
	const post = (path: string, body: unknown) =>
		client
			.execute(HttpClientRequest.post(path).pipe(HttpClientRequest.bodyJsonUnsafe(body)))
			.pipe(Effect.mapError(fail(`POST ${path} failed`)));
	const siteCommand = (body: Record<string, string>) =>
		post("/api/s/default/cmd/sitemgr", body).pipe(
			Effect.flatMap(HttpClientResponse.schemaBodyJson(LegacySites)),
			Effect.mapError(fail(`Site command ${body["cmd"]} failed`)),
		);
	return {
		status: client.get("/status").pipe(
			Effect.flatMap(
				HttpClientResponse.schemaBodyJson(Schema.Struct({ meta: Schema.Struct({ up: Schema.Boolean }) })),
			),
			Effect.map(({ meta }) => meta.up),
		),
		login: post("/api/login", ADMIN),
		get: (path: string) => client.get(path).pipe(Effect.mapError(fail(`GET ${path} failed`))),
		post,
		listSites: client.get("/api/self/sites").pipe(
			Effect.flatMap(HttpClientResponse.schemaBodyJson(LegacySites)),
			Effect.map(({ data }) => data),
			Effect.mapError(fail("Couldn't list sites")),
		),
		addSite: (desc: string) =>
			siteCommand({ cmd: "add-site", desc }).pipe(
				Effect.flatMap(({ data: [site] }) =>
					site === undefined
						? Effect.fail(new ControllerError({ message: "add-site returned no site" }))
						: Effect.succeed(site),
				),
			),
		deleteSite: (site: LegacySite) => siteCommand({ cmd: "delete-site", site: site._id }).pipe(Effect.asVoid),
	};
});
type AdminSession = Effect.Success<typeof adminSession>;

const loggedIn = Effect.tap(adminSession, (session) => session.login);

/**
 * First-run setup: creates the admin account. Skipped once logging in works.
 * Another run may be doing the same concurrently, so each step's failure is
 * ignored and only the final login counts.
 */
const ensureSetUp = (session: AdminSession) =>
	session.login.pipe(
		Effect.catch(() =>
			Effect.gen(function* () {
				yield* Effect.logInfo("test controller: first-run setup");
				yield* session
					.post("/api/cmd/sitemgr", {
						cmd: "add-default-admin",
						name: ADMIN.username,
						email: `${ADMIN.username}@example.invalid`,
						x_password: ADMIN.password,
					})
					.pipe(Effect.ignore);
				yield* session.post("/api/cmd/system", { cmd: "set-installed" }).pipe(Effect.ignore);
				yield* waitFor("first-run setup", session.login);
			}),
		),
	);

/** A locally administered MAC derived from the site's ID, so each site's fake gateway is distinct. */
const gatewayMac = (site: LegacySite) => ["02", "00", ...(site._id.slice(-8).match(/../g) ?? [])].join(":");

/** A new site answers 503 for a while when several are created at once. */
const settled = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
	effect.pipe(Effect.retry(Schedule.spaced("1 second").pipe(Schedule.upTo({ duration: "1 minute" }))));

/**
 * Makes a site manageable like a real console's: an offline UDM Pro as its
 * gateway (gateway-managed networks need one), then the real zone-based
 * firewall migration, which creates the built-in zones. Idempotent.
 */
const prepareSite = (session: AdminSession, site: LegacySite) =>
	Effect.gen(function* () {
		const device = {
			mac: gatewayMac(site),
			type: "udm",
			model: "UDMPRO",
			adopted: true,
			site_id: site._id,
			name: "fake-gateway",
			version: "4.4.6",
			state: 1,
			ip: "192.168.1.1",
		};
		yield* mongo(
			`db.getSiblingDB("unifi").device.updateOne({ mac: ${JSON.stringify(device.mac)} }, { $setOnInsert: ${JSON.stringify(device)} }, { upsert: true })`,
		);
		// The controller only notices a device inserted behind its back once it loads the site's devices, which reading them forces.
		yield* settled(session.get(`/api/s/${site.name}/stat/device`));
		yield* settled(session.post(`/v2/api/site/${site.name}/firewall/migrate`, {}));
	});

const waitFor = <A, E, R>(what: string, check: Effect.Effect<A, E, R>) =>
	check.pipe(
		Effect.retry(Schedule.spaced("1 second").pipe(Schedule.upTo({ duration: "4 minutes" }))),
		Effect.mapError(fail(`Timed out waiting for ${what}`)),
	);

const integrationApiUp = HttpClient.get(`${CONTROLLER.baseUrl}/v1/info`, {
	headers: { "X-API-KEY": CONTROLLER.apiKey },
}).pipe(Effect.flatMap(HttpClientResponse.filterStatusOk), Effect.provide(NodeHttpClient.layerUndici));

const IntegrationSites = Schema.Struct({ data: Schema.Array(Schema.Struct({ id: Schema.String })) });

/** The Integration API caches its site list for about 10 s, so a new site takes that long to appear. */
const listedByIntegrationApi = (siteId: string) =>
	HttpClient.get(`${CONTROLLER.baseUrl}/v1/sites`, {
		headers: { "X-API-KEY": CONTROLLER.apiKey },
		urlParams: { limit: "200" },
	}).pipe(
		Effect.flatMap(HttpClientResponse.filterStatusOk),
		Effect.flatMap(HttpClientResponse.schemaBodyJson(IntegrationSites)),
		Effect.filterOrFail(({ data }) => data.some((site) => site.id === siteId)),
		Effect.provide(NodeHttpClient.layerUndici),
	);

const isStale = (site: LegacySite, now: number) => {
	if (!site.desc.startsWith(TEST_SITE_PREFIX)) return false;
	const created = Number(site.desc.slice(TEST_SITE_PREFIX.length).split("-")[0]);
	return Number.isFinite(created) && now - created > STALE_AFTER_MS;
};

/**
 * Starts the shared test controller if it isn't running, and prepares it:
 * first-run setup, the default site's gateway and zones, and removal of
 * test sites left behind over an hour ago by killed runs. Idempotent, and
 * quick when the controller is already up. Every worktree shares the one
 * controller (fixed compose project name and ports).
 */
export const start: Effect.Effect<Controller, ControllerError> = Effect.gen(function* () {
	yield* Effect.logInfo("test controller: starting (docker compose up -d)");
	yield* docker("compose", "up", "-d");
	const session = yield* adminSession;
	yield* waitFor("the controller to start", session.status.pipe(Effect.filterOrFail((up) => up)));
	yield* ensureSetUp(session);
	const sites = yield* session.listSites;
	const defaultSite = sites.find((site) => site.name === "default");
	if (defaultSite === undefined) return yield* new ControllerError({ message: "The controller has no default site" });
	yield* prepareSite(session, defaultSite);
	const now = Date.now();
	yield* Effect.forEach(
		sites.filter((site) => isStale(site, now)),
		(site) => session.deleteSite(site),
		{
			discard: true,
		},
	);
	yield* waitFor("the Integration API", integrationApiUp);
	yield* Effect.logInfo(`test controller: ready at ${CONTROLLER.baseUrl}`);
	return CONTROLLER;
}).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

/** Removes the controller and its data. */
export const stop: Effect.Effect<void, ControllerError> = docker("compose", "down", "-v").pipe(
	Effect.asVoid,
	Effect.provide(NodeServices.layer),
);

/**
 * A fresh site, prepared like the default one, deleted (with everything in
 * it) when the scope closes. Tests use one per file, so concurrent runs and
 * leftovers from killed ones can't collide over names or VLAN IDs. Needs a
 * started controller.
 */
export const withSite = (label = "site"): Effect.Effect<TestSite, ControllerError, Scope.Scope> =>
	Effect.acquireRelease(
		Effect.gen(function* () {
			const session = yield* loggedIn;
			const random = Math.random().toString(36).slice(2, 6);
			const site = yield* session.addSite(`${TEST_SITE_PREFIX}${Date.now()}-${random}-${label}`);
			yield* prepareSite(session, site);
			if (site.external_id === undefined) {
				return yield* new ControllerError({ message: "add-site returned no external_id" });
			}
			yield* waitFor(
				`site ${site.name} to appear in the Integration API`,
				listedByIntegrationApi(site.external_id),
			);
			return { legacy: site, site: { id: site.external_id, internalReference: site.name, name: site.desc } };
		}).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
		({ legacy }) =>
			loggedIn.pipe(
				Effect.flatMap((session) => session.deleteSite(legacy)),
				Effect.scoped,
				Effect.catch((error) =>
					Effect.logWarning(`test controller: couldn't delete site ${legacy.name}`, error),
				),
			),
	).pipe(Effect.map(({ site }) => site));
