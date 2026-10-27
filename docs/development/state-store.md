# State store internals

The user-facing page is [state.md](../state.md).

`UnifiNetwork.state()` is `src/State.ts`. `makeUnifiState` implements Alchemy's `StateService` over a small `StateBackend` interface (list, create, update and delete state policies; create, find, check and delete lock lists). `state()` builds the console backend from the provider's credentials, connection and read-cache layers. The unit tests (`test/State.test.ts`) run the store over an in-memory fake backend, which makes batching and lock edge cases deterministic (`TestClock` drives renewal and expiry). The controller tests (`test/controller/State.test.ts`) cover the real backend, and a deploy and destroy end to end.

- **Why a firewall policy:** the Integration API has no blob store. Policy descriptions are its largest free-text field (no `maxLength`). A disabled Gateway → Gateway policy is allowed and needs no other objects. ACL rules are fiddlier, and vouchers are create-only hotspot credentials.
- **Why a traffic-matching list as the lock:** the API has no conditional writes (no ETag or version precondition), and policy names aren't unique. List names are unique and race-free: in 5 rounds of 20 concurrent creates on the test controller, exactly one won each time, and 1 of 5 on a real console through ui.com.
- **Why not `makeBucketState`:** its lease needs `ifVersion` writes.
- **Construction is lazy and scoped:** `Layer.effect(State, …)` captures the layer's scope and returns `Effect.cached` of the builder, so nothing connects until the first operation, and lock release is tied to the stack's lifetime.

## How it's stored

- **One firewall policy per stack and stage**, named `alchemy-state/<stack>/<stage>`. It's disabled, Gateway → Gateway (allowed, and needs no other objects), and its description is `alchemy-state:v1:` followed by the base64 of the Brotli-compressed JSON of the stage's records, stack output and lock record. The Integration API has no blob store, and policy descriptions are the largest free-text field it has.
- **The store finds the policy by name, then uses it by ID.** Policy names aren't unique on the console, so two policies with one stage's name is an error (delete the stale one).
- **`FirewallPolicyOrdering` ignores it:** a Gateway → Gateway ordering keeps state policies where they are, without the unlisted-policy warning, even when `exclusive`.
- **`alchemy nuke` deletes it** (and any lock list), as AWS's nuke deletes the S3 state bucket: nuke deletes everything the providers can list.

## Lock

- **The first operation on a stage takes the lock, reads included**, as Alchemy's bucket and Postgres stores do. So `plan` writes to the console too: it creates the lock and records it in the state policy, and it deletes the lock when it finishes. Two runs of one stage at once fail.
- **The lock is a traffic-matching list** named `alchemy-lock/<stack>/<stage>`. List names are unique and race-free (a duplicate is a 422), unlike policy names, and the API has no conditional writes. The list exists only while a run holds the stage.
- **Stale locks:** the holder records the list's ID and an expiry (2 minutes) in the state policy, and renews it every 30 s. A later run breaks an expired lock by deleting that list **by ID**, so two breakers can't both win. A lock list with no record needs deleting by hand in the UI, and the error says so. That happens when a run crashes before recording its lock, which includes any run on a stage that has no policy yet.
- **Before each write the store checks the list still exists**, at most every 5 s, and fails if it's gone.

## Writes

- **The stage loads once per run.** Reads come from memory after that.
- **Every change is on the console when it returns.** One write is in flight at a time. Changes made during a write join the next one, so parallel resource updates share writes. Each write sends the whole stage.
- **Cost per write** (Express 7, Network 10.6.109): about 0.8 s directly and 1.5 s through ui.com, up to 256 KB; 5 s directly and 10–15 s through ui.com at 4 MiB. On the test controller it's about 40 ms.

## Size

- **Caps:** a console stores descriptions of up to 16,776,462 bytes (MongoDB's 16 MiB document, less the rest of the policy; one byte more is a 500). The ui.com connector refuses request bodies over about 7.5 MiB (`content too large`), so through ui.com the cap is 7,863,731 bytes. A stage reached both ways has to fit the smaller cap.
- **Warning:** a write over `warnAt` (default 4,000,000 bytes) logs a warning once per run. Brotli shrinks state about twelvefold, so that's about 35 MB of JSON. A real stack is far smaller: 45 resources come to about 7 KB.
