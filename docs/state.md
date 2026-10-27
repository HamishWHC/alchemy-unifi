# State store

`UnifiNetwork.state()` (`src/State.ts`) keeps a stack's Alchemy state on the console the profile points at, so a stack needs only a console (directly or through ui.com) and no other infrastructure.

```ts
export default Alchemy.Stack(
	"HomeNetwork",
	{ providers: UnifiNetwork.providers(), state: UnifiNetwork.state() },
	Effect.gen(function* () {
		// ...
	}),
);
```

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

## Secrets

State holds `Redacted` values (e.g. Wi-Fi passphrases) in plaintext, as every Alchemy store does, and this store doesn't encrypt them. A UniFi stack's secrets are already on the console, readable by anyone who can read the policy. A stack that also manages other providers' resources would put their secrets on the console too.

## Moving to another store

Alchemy has no state migration or import. Switch the stack's `state`, then `plan --adopt` and `deploy --adopt`. That's also how a stack recovers after a factory reset wipes its state.
