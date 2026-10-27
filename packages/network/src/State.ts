import * as Sdk from "@alchemy-unifi/network-sdk";
import { STATE_STORE_VERSION } from "alchemy/State/HttpStateApi";
import type { ReplacedResourceState } from "alchemy/State/ResourceState";
import { type PersistedState, State, type StateService, StateStoreError } from "alchemy/State/State";
import { encodeState, reviveState } from "alchemy/State/StateEncoding";
import { recordStateStoreInit } from "alchemy/Telemetry/Metrics";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import type * as HttpClient from "effect/http/HttpClient";
import * as Layer from "effect/Layer";
import * as LogLevel from "effect/LogLevel";
import * as Predicate from "effect/Predicate";
import * as References from "effect/References";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as zlib from "node:zlib";
import { UnifiNetworkAuth } from "./AuthProvider.ts";
import * as Connection from "./Connection.ts";
import * as Credentials from "./Credentials.ts";
import * as ReadCache from "./ReadCache.ts";
import { resolveSite } from "./Site.ts";

/**
 * State store on the console itself (see `docs/state.md`). Each stack and
 * stage is one disabled Gateway → Gateway firewall policy whose description
 * holds the stage's state, and a traffic-matching list (whose names, unlike
 * policies', are unique) is its lock.
 */

/** Name prefix of the policies holding state. Other code leaves these alone. */
export const STATE_POLICY_PREFIX = "alchemy-state/";
/** Name prefix of the traffic-matching lists that lock a stage. */
export const STATE_LOCK_PREFIX = "alchemy-lock/";

/** Prefix of a state policy's description, ahead of the base64 of the Brotli-compressed JSON. */
const FORMAT = "alchemy-state:v1:";

export const DEFAULT_WARN_AT = 4_000_000;

/** How long a lock stays valid without a renewal. */
const LOCK_TTL_MS = 120_000;
const RENEW_EVERY_MS = 30_000;
/** How long a passing check that the lock still exists is trusted. */
const LOCK_CHECK_TTL_MS = 5_000;

export interface UnifiStateOptions {
	/**
	 * Warn once a stage's stored state passes this many bytes (compressed and
	 * base64-encoded), as a prompt to move to a store without the console's
	 * limits. A console stores up to about 16 MiB directly and 7.5 MiB through
	 * ui.com.
	 *
	 * @default 4_000_000
	 */
	readonly warnAt?: number;
}

/** A state policy as the store sees it. */
export interface StatePolicy {
	readonly id: string;
	readonly name: string;
	readonly description: string;
}

/**
 * The console operations the store needs. Every operation fails with
 * {@link StateStoreError}; deletes of missing objects succeed.
 */
export interface StateBackend {
	/** Every policy whose name starts with {@link STATE_POLICY_PREFIX}. */
	readonly listPolicies: Effect.Effect<ReadonlyArray<StatePolicy>, StateStoreError>;
	readonly createPolicy: (name: string, description: string) => Effect.Effect<string, StateStoreError>;
	readonly updatePolicy: (id: string, name: string, description: string) => Effect.Effect<void, StateStoreError>;
	readonly deletePolicy: (id: string) => Effect.Effect<void, StateStoreError>;
	/** Creates the lock list, returning its ID, or `undefined` when one with the name exists. */
	readonly createLock: (name: string) => Effect.Effect<string | undefined, StateStoreError>;
	readonly findLock: (name: string) => Effect.Effect<string | undefined, StateStoreError>;
	readonly lockExists: (id: string) => Effect.Effect<boolean, StateStoreError>;
	readonly deleteLock: (id: string) => Effect.Effect<void, StateStoreError>;
}

interface LockRecord {
	readonly listId: string;
	readonly expiresAt: number;
}

/** What a state policy's description holds. Records are kept as `encodeState` output. */
interface Snapshot {
	readonly lock?: LockRecord | undefined;
	readonly resources: Readonly<Record<string, unknown>>;
	readonly output?: unknown;
}

export const policyName = (stack: string, stage: string) => `${STATE_POLICY_PREFIX}${stack}/${stage}`;
export const lockName = (stack: string, stage: string) => `${STATE_LOCK_PREFIX}${stack}/${stage}`;

const parsePolicyName = (name: string) => {
	const [stack, stage, ...rest] = name.slice(STATE_POLICY_PREFIX.length).split("/");
	return stack === undefined || stage === undefined || rest.length > 0 ? undefined : { stack, stage };
};

export const encodeSnapshot = (snapshot: Snapshot): string =>
	FORMAT +
	zlib
		.brotliCompressSync(JSON.stringify(snapshot), {
			// Quality 11 is several times slower on a large state, for a few percent.
			params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9 },
		})
		.toString("base64");

const isLockRecord = (value: unknown): value is LockRecord =>
	Predicate.hasProperty(value, "listId") &&
	typeof value.listId === "string" &&
	Predicate.hasProperty(value, "expiresAt") &&
	typeof value.expiresAt === "number";

export const decodeSnapshot = (policy: StatePolicy): Effect.Effect<Snapshot, StateStoreError> =>
	Effect.try({
		try: (): Snapshot => {
			if (!policy.description.startsWith(FORMAT)) throw new Error("its description isn't in a known format");
			const parsed: unknown = JSON.parse(
				zlib.brotliDecompressSync(Buffer.from(policy.description.slice(FORMAT.length), "base64")).toString(),
			);
			if (!Predicate.isObject(parsed) || !Predicate.isObject(parsed["resources"])) {
				throw new Error("it has no resources");
			}
			const lock = isLockRecord(parsed["lock"]) ? parsed["lock"] : undefined;
			return { lock, resources: { ...parsed["resources"] }, output: parsed["output"] };
		},
		catch: (cause) =>
			new StateStoreError({
				message: `UniFi state policy '${policy.name}' can't be read: ${cause instanceof Error ? cause.message : String(cause)}`,
				...(cause instanceof Error ? { cause } : {}),
			}),
	});

/** A copy of a stored value, revived (e.g. `Redacted` values rebuilt). */
const revive = (encoded: unknown): unknown =>
	encoded === undefined ? undefined : JSON.parse(JSON.stringify(encoded), reviveState);

// Records are only ever written by `set`, so a stored object is a record.
const isRecord = (value: unknown): value is PersistedState => Predicate.isObject(value);
const isReplaced = (value: unknown): value is ReplacedResourceState =>
	isRecord(value) && "status" in value && value.status === "replaced";

const heldError = (stack: string, stage: string, detail: string) =>
	new StateStoreError({ message: `Another run holds the UniFi state lock on '${stack}/${stage}': ${detail}` });

/** A stage this store has locked and loaded. */
interface OpenStage {
	readonly stack: string;
	readonly stage: string;
	readonly listId: string;
	policyId: string | undefined;
	resources: Record<string, unknown>;
	output: unknown;
	/** Bumped by every change; `written` is the latest one on the console. */
	version: number;
	written: number;
	lockCheckedAt: number | undefined;
	lost: boolean;
	closed: boolean;
	/** One write at a time. Changes that arrive during a write share the next one. */
	readonly writer: Semaphore.Semaphore;
}

/**
 * A {@link StateService} over `backend`. The first operation on a stage
 * locks it and loads its state, and the lock is released when `Scope`
 * closes.
 */
export const makeUnifiState = (backend: StateBackend, options: UnifiStateOptions = {}) =>
	Effect.gen(function* () {
		const scope = yield* Effect.scope;
		const warnAt = options.warnAt ?? DEFAULT_WARN_AT;
		let warned = false;

		const findPolicy = Effect.fn(function* (stack: string, stage: string) {
			const name = policyName(stack, stage);
			const found = (yield* backend.listPolicies).filter((p) => p.name === name);
			if (found.length > 1) {
				return yield* new StateStoreError({
					message: `Several firewall policies are named '${name}'. Only one may hold this stage's state: delete the others (keep the one with the newest state).`,
				});
			}
			return found[0];
		});

		const takeLock = Effect.fn(function* (stack: string, stage: string) {
			const name = lockName(stack, stage);
			for (let attempt = 0; attempt < 2; attempt++) {
				const created = yield* backend.createLock(name);
				if (created !== undefined) return created;
				const holder = yield* backend.findLock(name);
				// Released between the create and the find: try again.
				if (holder === undefined) continue;
				const policy = yield* findPolicy(stack, stage);
				const record = policy === undefined ? undefined : (yield* decodeSnapshot(policy)).lock;
				if (record === undefined || record.listId !== holder) {
					return yield* heldError(
						stack,
						stage,
						`the traffic-matching list '${name}' exists, but no run has recorded holding it. A run may be starting, or one crashed before recording it. If nothing is using this stage, delete the list in the UniFi UI.`,
					);
				}
				const now = yield* Clock.currentTimeMillis;
				if (record.expiresAt > now) {
					return yield* heldError(
						stack,
						stage,
						`it expires at ${new Date(record.expiresAt).toISOString()} unless renewed.`,
					);
				}
				// The holder stopped renewing. Deleting by ID means only one run can break it:
				// another breaker's delete misses, or its create finds the new list.
				yield* backend.deleteLock(holder);
			}
			return yield* heldError(stack, stage, `the traffic-matching list '${name}' keeps reappearing.`);
		});

		const checkLock = (s: OpenStage) =>
			Effect.gen(function* () {
				const lostError = new StateStoreError({
					message: `The UniFi state lock on '${s.stack}/${s.stage}' was lost mid-run (its traffic-matching list was deleted); refusing to continue unlocked.`,
				});
				if (s.lost) return yield* lostError;
				const now = yield* Clock.currentTimeMillis;
				if (s.lockCheckedAt !== undefined && now - s.lockCheckedAt < LOCK_CHECK_TTL_MS) return;
				if (!(yield* backend.lockExists(s.listId))) {
					s.lost = true;
					return yield* lostError;
				}
				s.lockCheckedAt = now;
			});

		/**
		 * Writes the stage unless `upTo` is already on the console. Without
		 * `upTo` (a renewal) it writes only an existing policy.
		 */
		const flush = (s: OpenStage, upTo?: number) =>
			Semaphore.withPermits(
				s.writer,
				1,
			)(
				Effect.gen(function* () {
					if (s.closed) {
						return yield* new StateStoreError({
							message: `The UniFi state store for '${s.stack}/${s.stage}' is closed.`,
						});
					}
					if (upTo === undefined ? s.policyId === undefined : s.written >= upTo) return;
					yield* checkLock(s);
					const version = s.version;
					const expiresAt = (yield* Clock.currentTimeMillis) + LOCK_TTL_MS;
					const description = encodeSnapshot({
						lock: { listId: s.listId, expiresAt },
						resources: s.resources,
						output: s.output,
					});
					if (description.length > warnAt && !warned) {
						warned = true;
						yield* Effect.logWarning(
							`UniFi state for '${s.stack}/${s.stage}' is ${description.length} bytes, over the ${warnAt}-byte warning size. The console stores up to about 16 MiB directly and 7.5 MiB through ui.com: consider moving this stack to another state store.`,
						);
					}
					const name = policyName(s.stack, s.stage);
					if (s.policyId === undefined) s.policyId = yield* backend.createPolicy(name, description);
					else yield* backend.updatePolicy(s.policyId, name, description);
					s.written = version;
				}),
			);

		const openStage = Effect.fn(function* (stack: string, stage: string) {
			const listId = yield* takeLock(stack, stage);
			const s: OpenStage = {
				stack,
				stage,
				listId,
				policyId: undefined,
				resources: {},
				output: undefined,
				version: 0,
				written: 0,
				lockCheckedAt: yield* Clock.currentTimeMillis,
				lost: false,
				closed: false,
				writer: Semaphore.makeUnsafe(1),
			};
			// Added before the renewal is forked, so it runs after the renewal is interrupted.
			yield* Scope.addFinalizer(
				scope,
				Semaphore.withPermits(
					s.writer,
					1,
				)(
					Effect.suspend(() => {
						s.closed = true;
						return backend.deleteLock(listId);
					}).pipe(Effect.ignore),
				),
			);
			const policy = yield* findPolicy(stack, stage);
			if (policy !== undefined) {
				const snapshot = yield* decodeSnapshot(policy);
				s.policyId = policy.id;
				s.resources = { ...snapshot.resources };
				s.output = snapshot.output;
				// Record the lock, so another run can tell when it goes stale.
				yield* flush(s);
			}
			yield* flush(s).pipe(
				Effect.ignore,
				Effect.delay(RENEW_EVERY_MS),
				Effect.forever,
				Effect.interruptible,
				Effect.forkIn(scope),
			);
			return s;
		});

		// One open stage per (stack, stage), opened one at a time; a failed open isn't kept.
		const stages = new Map<string, OpenStage>();
		const opening = Semaphore.makeUnsafe(1);
		const stageFor = (request: { readonly stack: string; readonly stage: string }) =>
			Semaphore.withPermits(
				opening,
				1,
			)(
				Effect.gen(function* () {
					const key = `${request.stack}/${request.stage}`;
					const existing = stages.get(key);
					if (existing !== undefined) return existing;
					const opened = yield* openStage(request.stack, request.stage);
					stages.set(key, opened);
					return opened;
				}),
			);

		const change = (request: { readonly stack: string; readonly stage: string }, apply: (s: OpenStage) => void) =>
			stageFor(request).pipe(
				Effect.flatMap((s) => {
					apply(s);
					s.version++;
					return flush(s, s.version);
				}),
			);

		const deleteStage = (stack: string, stage: string) =>
			stageFor({ stack, stage }).pipe(
				Effect.flatMap((s) =>
					Semaphore.withPermits(
						s.writer,
						1,
					)(
						Effect.gen(function* () {
							yield* checkLock(s);
							if (s.policyId !== undefined) yield* backend.deletePolicy(s.policyId);
							s.policyId = undefined;
							s.resources = {};
							s.output = undefined;
							s.written = s.version;
						}),
					),
				),
			);

		const stored = Effect.map(backend.listPolicies, (policies) =>
			policies.flatMap((p) => {
				const parsed = parsePolicyName(p.name);
				return parsed === undefined ? [] : [parsed];
			}),
		);

		const listStages = (stack: string) =>
			Effect.map(stored, (all) =>
				[...new Set(all.filter((s) => s.stack === stack).map((s) => s.stage))].toSorted(),
			);

		const service: StateService = {
			id: "unifi-network",
			getVersion: () => Effect.succeed(STATE_STORE_VERSION),
			listStacks: () => Effect.map(stored, (all) => [...new Set(all.map((s) => s.stack))].toSorted()),
			listStages,
			get: (request) =>
				Effect.map(stageFor(request), (s) => {
					const record = revive(s.resources[request.fqn]);
					return isRecord(record) ? record : undefined;
				}),
			getReplacedResources: (request) =>
				Effect.map(stageFor(request), (s) => Object.values(s.resources).map(revive).filter(isReplaced)),
			list: (request) => Effect.map(stageFor(request), (s) => Object.keys(s.resources).toSorted()),
			set: <V extends PersistedState>(request: { stack: string; stage: string; fqn: string; value: V }) =>
				change(request, (s) => {
					s.resources[request.fqn] = encodeState(request.value);
				}).pipe(Effect.as(request.value)),
			delete: (request) =>
				change(request, (s) => {
					delete s.resources[request.fqn];
				}),
			deleteStack: ({ stack, stage }) =>
				stage === undefined
					? Effect.flatMap(listStages(stack), (found) =>
							Effect.forEach(found, (each) => deleteStage(stack, each), { discard: true }),
						)
					: deleteStage(stack, stage),
			getOutput: (request) => Effect.map(stageFor(request), (s) => revive(s.output)),
			setOutput: (request) =>
				change(request, (s) => {
					s.output = encodeState(request.value);
				}).pipe(Effect.as(request.value)),
		};
		return service;
	});

const toStateStoreError = (what: string) => (cause: unknown) =>
	new StateStoreError({
		message: `UniFi state store: ${what} failed: ${Connection.describeError(cause)}`,
		...(cause instanceof Error ? { cause } : {}),
	});

const isAlreadyExists = (error: unknown) =>
	Predicate.hasProperty(error, "_tag") &&
	error._tag === "UnprocessableEntity" &&
	Predicate.hasProperty(error, "message") &&
	typeof error.message === "string" &&
	error.message.includes("already exist");

const policyBody = (zoneId: string, name: string, description: string) => ({
	enabled: false,
	name,
	description,
	action: { type: "BLOCK" as const },
	source: { zoneId },
	destination: { zoneId },
	ipProtocolScope: { ipVersion: "IPV4_AND_IPV6" as const },
	loggingEnabled: false,
});

const describeWrite = (description: string) =>
	`writing ${description.length} bytes of state (a console stores up to about 16 MiB directly, 7.5 MiB through ui.com)`;

/**
 * Runs with Debug and Trace records off: request bodies are the state,
 * which holds secrets (e.g. Wi-Fi passphrases). Floors already above Info
 * are left alone.
 */
const withoutDebugLogs = Effect.updateService(References.MinimumLogLevel, (level) =>
	LogLevel.isLessThan(level, "Info") ? "Info" : level,
);

/** The {@link StateBackend} of the profile's console and site. */
const consoleBackend = Effect.gen(function* () {
	const { id: siteId } = yield* resolveSite();
	// Operations run later, from wherever Alchemy calls the store.
	const context = yield* Effect.context<Connection.UnifiNetworkConnection>();
	const run = <A, E>(what: string, effect: Effect.Effect<A, E, Sdk.Credentials | HttpClient.HttpClient>) =>
		Connection.withConnection(effect).pipe(
			Effect.mapError(toStateStoreError(what)),
			Effect.provideContext(context),
			withoutDebugLogs,
		);

	const gatewayZoneId = yield* Effect.cached(
		run("finding the Gateway zone", Stream.runCollect(Sdk.getFirewallZones.items({ siteId }))).pipe(
			Effect.flatMap((zones) => {
				const zone = zones.find((z) => z.metadata.origin === "SYSTEM_DEFINED" && z.name === "Gateway");
				return zone === undefined
					? Effect.fail(new StateStoreError({ message: "UniFi state store: the site has no Gateway zone." }))
					: Effect.succeed(zone.id);
			}),
		),
	);

	return {
		listPolicies: run(
			"listing state policies",
			Stream.runCollect(Sdk.getFirewallPolicies.items({ siteId })).pipe(
				Effect.map((policies) =>
					// User-defined first: some system-defined policies have no name, whatever the spec says.
					policies.flatMap((p) =>
						p.metadata.origin === "USER_DEFINED" && p.name.startsWith(STATE_POLICY_PREFIX)
							? [{ id: p.id, name: p.name, description: p.description ?? "" }]
							: [],
					),
				),
			),
		),
		createPolicy: (name, description) =>
			Effect.flatMap(gatewayZoneId, (zoneId) =>
				run(
					describeWrite(description),
					Sdk.createFirewallPolicy({ siteId, ...policyBody(zoneId, name, description) }),
				),
			).pipe(Effect.map((created) => created.id)),
		updatePolicy: (id, name, description) =>
			Effect.flatMap(gatewayZoneId, (zoneId) =>
				run(
					describeWrite(description),
					Sdk.updateFirewallPolicy({
						siteId,
						firewallPolicyId: id,
						...policyBody(zoneId, name, description),
					}),
				),
			).pipe(Effect.asVoid),
		deletePolicy: (id) =>
			run(
				"deleting a state policy",
				Sdk.deleteFirewallPolicy({ siteId, firewallPolicyId: id }).pipe(
					Effect.asVoid,
					Effect.catchTag("NotFound", () => Effect.void),
				),
			),
		createLock: (name) =>
			run(
				"taking the lock",
				Sdk.createTrafficMatchingList({
					siteId,
					body: { type: "PORTS", name, items: [{ type: "PORT_NUMBER", value: 1 }] },
				}).pipe(
					Effect.map((created): string | undefined => created.id),
					Effect.catchIf(isAlreadyExists, () => Effect.undefined),
				),
			),
		findLock: (name) =>
			run(
				"finding the lock",
				Stream.runCollect(Sdk.getTrafficMatchingLists.items({ siteId })).pipe(
					Effect.map((lists) => lists.find((l) => l.name === name)?.id),
				),
			),
		lockExists: (id) =>
			run(
				"checking the lock",
				Sdk.getTrafficMatchingList({ siteId, trafficMatchingListId: id }).pipe(
					Effect.as(true),
					Effect.catchTag("NotFound", () => Effect.succeed(false)),
				),
			),
		deleteLock: (id) =>
			run(
				"releasing the lock",
				Sdk.deleteTrafficMatchingList({ siteId, trafficMatchingListId: id }).pipe(
					Effect.asVoid,
					Effect.catchTag("NotFound", () => Effect.void),
				),
			),
	} satisfies StateBackend;
}).pipe(
	Effect.mapError((error) =>
		error instanceof StateStoreError ? error : toStateStoreError("finding the site")(error),
	),
);

/**
 * State store on the console the profile points at: each stack and stage
 * is a disabled Gateway → Gateway firewall policy holding the stage's
 * compressed state, locked with a traffic-matching list while a run uses
 * it. Nothing connects until the first state operation.
 *
 * The state includes secrets in plaintext, as in every Alchemy store: a
 * UniFi stack's are already on the console, but another provider's
 * resources in the same stack would put theirs there too.
 *
 * @example
 * ```ts
 * export default Alchemy.Stack(
 *   "HomeNetwork",
 *   { providers: UnifiNetwork.providers(), state: UnifiNetwork.state() },
 *   Effect.gen(function* () {
 *     // ...
 *   }),
 * );
 * ```
 */
export const state = (options: UnifiStateOptions = {}) =>
	Layer.effect(
		State,
		Effect.gen(function* () {
			const scope = yield* Effect.scope;
			const context = yield* Effect.context<
				| Connection.UnifiNetworkConnection
				| Credentials.UnifiNetworkCredentials
				| ReadCache.UnifiNetworkReadCache
			>();
			const make = Effect.flatMap(consoleBackend, (backend) => makeUnifiState(backend, options)).pipe(
				Scope.provide(scope),
				recordStateStoreInit,
				Effect.orDie,
				Effect.provideContext(context),
			);
			return yield* Effect.cached(make);
		}),
	).pipe(
		Layer.provide(
			Layer.merge(Connection.layer, ReadCache.layer).pipe(
				Layer.provideMerge(Credentials.fromAuthProvider()),
				Layer.provideMerge(UnifiNetworkAuth),
			),
		),
		Layer.orDie,
	);
