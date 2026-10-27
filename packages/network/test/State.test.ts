import { describe, expect, it } from "@effect/vitest";
import type { CreatedResourceState, ReplacedResourceState } from "alchemy/State/ResourceState";
import { StateStoreError } from "alchemy/State/State";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Logger from "effect/Logger";
import * as Redacted from "effect/Redacted";
import * as Scope from "effect/Scope";
import * as TestClock from "effect/testing/TestClock";
import {
	decodeSnapshot,
	encodeSnapshot,
	lockName,
	makeUnifiState,
	policyName,
	type StateBackend,
	type StatePolicy,
} from "../src/State.ts";

/** An in-memory console: state policies and lock lists, counting policy writes. */
const fakeConsole = () => {
	const policies = new Map<string, StatePolicy>();
	const locks = new Map<string, string>();
	let nextId = 0;
	let writes = 0;
	const id = () => `id-${++nextId}`;
	// A write takes a few scheduler turns, as a request does, so concurrent changes queue behind it.
	const slow = Effect.repeat(Effect.yieldNow, { times: 5 });
	const backend: StateBackend = {
		listPolicies: Effect.sync(() => [...policies.values()]),
		createPolicy: (name, description) =>
			Effect.andThen(
				slow,
				Effect.sync(() => {
					writes++;
					const created = id();
					policies.set(created, { id: created, name, description });
					return created;
				}),
			),
		updatePolicy: (policyId, name, description) =>
			Effect.andThen(
				slow,
				Effect.sync(() => {
					writes++;
					policies.set(policyId, { id: policyId, name, description });
				}),
			),
		deletePolicy: (policyId) => Effect.sync(() => void policies.delete(policyId)),
		createLock: (name) =>
			Effect.sync(() => {
				if ([...locks.values()].includes(name)) return undefined;
				const created = id();
				locks.set(created, name);
				return created;
			}),
		findLock: (name) => Effect.sync(() => [...locks].find(([, n]) => n === name)?.[0]),
		lockExists: (lockId) => Effect.sync(() => locks.has(lockId)),
		deleteLock: (lockId) => Effect.sync(() => void locks.delete(lockId)),
	};
	return { backend, policies, locks, writes: () => writes };
};

const record = (fqn: string, props: Record<string, unknown> = { name: fqn }): CreatedResourceState => ({
	resourceType: "Test.Thing",
	namespace: undefined,
	fqn,
	logicalId: fqn,
	instanceId: "instance",
	providerVersion: 0,
	status: "created",
	props,
	attr: {},
	downstream: [],
	bindings: [],
});

const replaced = (fqn: string): ReplacedResourceState => ({
	...record(fqn),
	status: "replaced",
	old: record(fqn),
	deleteFirst: false,
});

const stage = { stack: "Stack", stage: "dev" };

/** A store over `backend` in its own scope, which `close` closes (releasing its locks). */
const openStore = (backend: StateBackend, options?: { warnAt?: number }) =>
	Effect.gen(function* () {
		const scope = yield* Scope.make();
		const store = yield* makeUnifiState(backend, options).pipe(Scope.provide(scope));
		return { store, close: Scope.close(scope, Exit.void) };
	});

const failureOf = <A, E>(effect: Effect.Effect<A, E>) =>
	effect.pipe(
		Effect.flip,
		Effect.map((error) => (error instanceof StateStoreError ? error.message : String(error))),
	);

describe("UniFi state store", () => {
	it.effect("round-trips records, outputs and secrets through the console", () =>
		Effect.gen(function* () {
			const fake = fakeConsole();
			const a = yield* openStore(fake.backend);
			yield* a.store.set({ ...stage, fqn: "a/b", value: record("a/b", { key: Redacted.make("s3cret") }) });
			yield* a.store.set({ ...stage, fqn: "old", value: replaced("old") });
			yield* a.store.setOutput({ ...stage, value: { url: "https://example" } });
			yield* a.close;

			const b = yield* openStore(fake.backend);
			const got = yield* b.store.get({ ...stage, fqn: "a/b" });
			expect(got?.status).toBe("created");
			const props = got !== undefined && "props" in got ? got.props : undefined;
			expect(Redacted.isRedacted(props?.["key"])).toBe(true);
			expect(yield* b.store.get({ ...stage, fqn: "missing" })).toBeUndefined();
			expect(yield* b.store.list(stage)).toEqual(["a/b", "old"]);
			expect((yield* b.store.getReplacedResources(stage)).map((r) => r.fqn)).toEqual(["old"]);
			expect(yield* b.store.getOutput(stage)).toEqual({ url: "https://example" });
			expect(yield* b.store.listStacks()).toEqual(["Stack"]);
			expect(yield* b.store.listStages("Stack")).toEqual(["dev"]);

			yield* b.store.deleteStack({ stack: "Stack" });
			expect(fake.policies.size).toBe(0);
			expect(yield* b.store.list(stage)).toEqual([]);
			expect(yield* b.store.listStacks()).toEqual([]);
			yield* b.close;
			expect(fake.locks.size).toBe(0);
		}),
	);

	it.effect("only reads leave the console without a policy, and release the lock", () =>
		Effect.gen(function* () {
			const fake = fakeConsole();
			const a = yield* openStore(fake.backend);
			expect(yield* a.store.list(stage)).toEqual([]);
			expect(fake.locks.size).toBe(1);
			yield* a.close;
			expect(fake.policies.size).toBe(0);
			expect(fake.locks.size).toBe(0);
			expect(fake.writes()).toBe(0);
		}),
	);

	it.effect("batches concurrent changes into shared writes, each durable when it returns", () =>
		Effect.gen(function* () {
			const fake = fakeConsole();
			const a = yield* openStore(fake.backend);
			const fqns = Array.from({ length: 20 }, (_, i) => `r${i}`);
			yield* Effect.forEach(fqns, (fqn) => a.store.set({ ...stage, fqn, value: record(fqn) }), {
				concurrency: "unbounded",
			});
			expect(fake.writes()).toBeLessThanOrEqual(3);
			const [stored] = fake.policies.values();
			expect(stored?.name).toBe(policyName("Stack", "dev"));
			if (stored === undefined) return;
			expect(Object.keys((yield* decodeSnapshot(stored)).resources).toSorted()).toEqual(fqns.toSorted());
			yield* a.close;
		}),
	);

	it.effect("refuses a stage another run holds, until it's released", () =>
		Effect.gen(function* () {
			const fake = fakeConsole();
			const a = yield* openStore(fake.backend);
			yield* a.store.set({ ...stage, fqn: "x", value: record("x") });
			const b = yield* openStore(fake.backend);
			expect(yield* failureOf(b.store.get({ ...stage, fqn: "x" }))).toContain("Another run holds");
			// Other stages are independent.
			expect(yield* b.store.list({ stack: "Stack", stage: "prod" })).toEqual([]);
			yield* a.close;
			expect((yield* b.store.get({ ...stage, fqn: "x" }))?.fqn).toBe("x");
			yield* b.close;
		}),
	);

	it.effect("breaks a lock whose holder stopped renewing, but not a live one", () =>
		Effect.gen(function* () {
			const fake = fakeConsole();
			const seed = (expiresAt: number) => {
				fake.locks.clear();
				fake.policies.clear();
				fake.locks.set("crashed", lockName("Stack", "dev"));
				fake.policies.set("p", {
					id: "p",
					name: policyName("Stack", "dev"),
					description: encodeSnapshot({
						lock: { listId: "crashed", expiresAt },
						resources: { x: record("x") },
					}),
				});
			};
			yield* TestClock.adjust("10 minutes");

			seed(11 * 60_000);
			const live = yield* openStore(fake.backend);
			expect(yield* failureOf(live.store.list(stage))).toContain("expires at");
			yield* live.close;

			seed(1);
			const breaker = yield* openStore(fake.backend);
			expect(yield* breaker.store.list(stage)).toEqual(["x"]);
			expect(fake.locks.has("crashed")).toBe(false);
			yield* breaker.close;
		}),
	);

	it.effect("names a lock list nobody has recorded holding", () =>
		Effect.gen(function* () {
			const fake = fakeConsole();
			fake.locks.set("orphan", lockName("Stack", "dev"));
			const a = yield* openStore(fake.backend);
			expect(yield* failureOf(a.store.list(stage))).toContain("delete the list in the UniFi UI");
			yield* a.close;
			expect(fake.locks.has("orphan")).toBe(true);
		}),
	);

	it.effect("renews the lock while open and fails once it's lost", () =>
		Effect.gen(function* () {
			const fake = fakeConsole();
			const a = yield* openStore(fake.backend);
			yield* a.store.set({ ...stage, fqn: "x", value: record("x") });
			const lockOf = Effect.gen(function* () {
				const [stored] = fake.policies.values();
				return stored === undefined ? undefined : (yield* decodeSnapshot(stored)).lock;
			});
			const before = (yield* lockOf)?.expiresAt ?? 0;
			yield* TestClock.adjust("31 seconds");
			expect((yield* lockOf)?.expiresAt ?? 0).toBeGreaterThan(before);

			fake.locks.clear();
			yield* TestClock.adjust("6 seconds");
			expect(yield* failureOf(a.store.set({ ...stage, fqn: "y", value: record("y") }))).toContain("lost");
			yield* a.close;
		}),
	);

	it.effect("warns once the stored state passes warnAt", () =>
		Effect.gen(function* () {
			const fake = fakeConsole();
			const warnings: string[] = [];
			const collect = Logger.make((options) => {
				if (options.logLevel === "Warn") warnings.push(String(options.message));
			});
			yield* Effect.gen(function* () {
				const a = yield* openStore(fake.backend, { warnAt: 10 });
				yield* a.store.set({ ...stage, fqn: "x", value: record("x") });
				yield* a.store.set({ ...stage, fqn: "y", value: record("y") });
				yield* a.close;
			}).pipe(Effect.provide(Logger.layer([collect])));
			expect(warnings).toHaveLength(1);
			expect(warnings[0]).toContain("over the 10-byte warning size");
		}),
	);

	it.effect("refuses two policies holding one stage", () =>
		Effect.gen(function* () {
			const fake = fakeConsole();
			const description = encodeSnapshot({ resources: {} });
			fake.policies.set("p1", { id: "p1", name: policyName("Stack", "dev"), description });
			fake.policies.set("p2", { id: "p2", name: policyName("Stack", "dev"), description });
			const a = yield* openStore(fake.backend);
			expect(yield* failureOf(a.store.list(stage))).toContain("Several firewall policies");
			yield* a.close;
		}),
	);
});
