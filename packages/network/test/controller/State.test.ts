import * as Sdk from "@alchemy-unifi/network-sdk";
import { useSite } from "@alchemy-unifi/test-controller/vitest";
import { expect } from "@effect/vitest";
import * as Alchemy from "alchemy";
import { deploy } from "alchemy/Deploy";
import type { CreatedResourceState } from "alchemy/State/ResourceState";
import { State, StateStoreError } from "alchemy/State/State";
import * as Test from "alchemy/Test/Vitest";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Stream from "effect/Stream";
import * as UnifiNetwork from "../../src/index.ts";
import { lockName, policyName } from "../../src/State.ts";
import { sdk } from "./helpers.ts";

const current = useSite("state");
const { test } = Test.make({ providers: UnifiNetwork.providers(), state: UnifiNetwork.state() });

const record = (fqn: string, props: Record<string, unknown>): CreatedResourceState => ({
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

const policiesNamed = (name: string) =>
	sdk(Stream.runCollect(Sdk.getFirewallPolicies.items({ siteId: current().site.id }))).pipe(
		Effect.map((policies) => policies.filter((p) => p.name === name)),
	);

const listsNamed = (name: string) =>
	sdk(Stream.runCollect(Sdk.getTrafficMatchingLists.items({ siteId: current().site.id }))).pipe(
		Effect.map((lists) => lists.filter((l) => l.name === name)),
	);

test(
	"keeps a stage's state in a disabled Gateway → Gateway policy, locked by a list",
	Effect.gen(function* () {
		const state = yield* yield* State;
		const stage = { stack: "StateTest", stage: "dev" };
		yield* state.set({ ...stage, fqn: "a/b", value: record("a/b", { key: Redacted.make("s3cret") }) });
		yield* state.setOutput({ ...stage, value: { done: true } });

		const [policy, ...others] = yield* policiesNamed(policyName("StateTest", "dev"));
		expect(others).toEqual([]);
		expect(policy).toMatchObject({ enabled: false, action: { type: "BLOCK" } });
		expect(policy?.source.zoneId).toBe(policy?.destination.zoneId);
		expect(policy?.description).toMatch(/^alchemy-state:v1:/);
		expect(yield* listsNamed(lockName("StateTest", "dev"))).toHaveLength(1);

		// A second store (another run) can't use the stage while this one holds it.
		const blocked = yield* Effect.gen(function* () {
			const other = yield* yield* State;
			return yield* other.list(stage).pipe(Effect.flip);
		}).pipe(Effect.provide(UnifiNetwork.state()));
		expect(blocked).toBeInstanceOf(StateStoreError);
		expect(blocked.message).toContain("Another run holds");

		const got = yield* state.get({ ...stage, fqn: "a/b" });
		const props = got !== undefined && "props" in got ? got.props : undefined;
		expect(Redacted.isRedacted(props?.["key"])).toBe(true);
		expect(yield* state.getOutput(stage)).toEqual({ done: true });
		expect(yield* state.listStages("StateTest")).toEqual(["dev"]);

		yield* state.deleteStack({ stack: "StateTest" });
		expect(yield* policiesNamed(policyName("StateTest", "dev"))).toEqual([]);
	}),
);

test(
	"releases the lock when the store closes",
	Effect.gen(function* () {
		expect(yield* listsNamed(lockName("StateTest", "dev"))).toEqual([]);
	}),
);

const Stack = Alchemy.Stack(
	"StateStack",
	{ providers: UnifiNetwork.providers(), state: UnifiNetwork.state() },
	Effect.gen(function* () {
		const list = yield* UnifiNetwork.TrafficMatchingList("ports", {
			type: "PORTS",
			name: "State store e2e",
			items: [{ type: "PORT_NUMBER", value: 8443 }],
		});
		return { listId: list.trafficMatchingListId };
	}),
);

// The harness's `deploy` keeps each run's store, and so its lock, open until the file ends.
// Alchemy's own `deploy` and `destroy` close it after each run, as separate CLI runs do.
const run = { stack: Stack, stage: "e2e" };

test(
	"deploys and destroys a stack with the store, leaving nothing behind",
	Effect.gen(function* () {
		const { listId } = yield* deploy(run);
		expect(yield* listsNamed("State store e2e")).toMatchObject([{ id: listId }]);
		expect(yield* deploy(run)).toEqual({ listId });
		expect(yield* policiesNamed(policyName("StateStack", "e2e"))).toHaveLength(1);

		yield* Alchemy.destroy(run);
		expect(yield* listsNamed("State store e2e")).toEqual([]);
		expect(yield* policiesNamed(policyName("StateStack", "e2e"))).toEqual([]);
		expect(yield* listsNamed(lockName("StateStack", "e2e"))).toEqual([]);
	}),
);
