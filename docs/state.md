# State on the console

Alchemy keeps a record of what each stack deployed (its state). `UnifiNetwork.state()` keeps it on the console the stack manages, so a UniFi stack needs nothing else: no S3 bucket, no state server, nothing to back up separately.

```ts
import * as UnifiNetwork from "@alchemy-unifi/network";
import * as Alchemy from "alchemy";
import * as Effect from "effect/Effect";

export default Alchemy.Stack(
	"HomeNetwork",
	{ providers: UnifiNetwork.providers(), state: UnifiNetwork.state() },
	Effect.gen(function* () {
		yield* UnifiNetwork.FirewallZone("iot-zone", { name: "IoT" });
	}),
);
```

It uses the same profile (or environment variables) as the resources. Each stage of each stack is one **disabled firewall policy** named `alchemy-state/<stack>/<stage>`, from the Gateway zone to itself, whose description holds the compressed state. It changes nothing about how traffic flows.

## Locking

Every run, `plan` included, locks the stage while it runs: it creates a traffic-matching list named `alchemy-lock/<stack>/<stage>` and deletes it at the end. A second run of the same stage at the same time fails with "Another run holds the UniFi state lock". Different stages are independent.

A run that crashes leaves its lock behind, and the next run takes it over once it expires (2 minutes). If the error says nobody has recorded holding the lock, and nothing else is running, delete that traffic-matching list in the UniFi UI.

## Size

| Connection     | Most it can hold (compressed) |
| -------------- | ----------------------------- |
| Directly       | about 16 MiB                  |
| Through ui.com | about 7.5 MiB                 |

State compresses about twelvefold, and a home network with 45 resources takes about 7 KB, so few stacks get near this. A stage you reach both ways has to fit the smaller limit. The store warns once its state passes 4 MB, to leave time to move to another store; change that with `UnifiNetwork.state({ warnAt: 10_000_000 })`.

Each change is written to the console before the run moves on, which takes about a second through ui.com. Changes Alchemy makes in parallel share writes.

## Gotchas

- **The state includes secrets in plaintext,** like every Alchemy state store: Wi-Fi passphrases, for example. They're no more exposed than on the console itself, which stores them too. But a stack that also manages other providers' resources (cloud accounts, DNS providers) would put their secrets on the console: use another state store for those stacks.
- **A factory reset (or restoring an older backup) loses or rewinds the state.** Recover with `npx alchemy deploy --stage home --adopt`, which takes over the existing objects again.
- **`alchemy nuke` deletes the state policy and any lock,** as AWS's nuke deletes its state bucket: nuke deletes everything the providers can list.
- **Don't edit or delete the `alchemy-state/` policies in the UI.**

## Moving to another store

Alchemy has no state migration. Switch the stack's `state`, then run `plan --adopt` and `deploy --adopt` to take over the existing objects in the new store. Delete the old `alchemy-state/` policy afterwards.
