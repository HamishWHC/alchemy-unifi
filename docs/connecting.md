# Connecting to a console

The provider reaches one console per profile (or per set of environment variables). Everything here uses Alchemy's default profile; add `--profile <name>` to any command to use another.

## Directly or through ui.com

```sh
npx alchemy profile edit --add UnifiNetwork
```

| Method             | Needs                                                                                  | Use when                                         |
| ------------------ | -------------------------------------------------------------------------------------- | ------------------------------------------------ |
| **Directly**       | The console's URL and a Network API key (Network app → Settings → Integrations)        | You're on the console's network                  |
| **Through ui.com** | A Site Manager API key from [unifi.ui.com](https://unifi.ui.com); you pick the console | You're elsewhere, or the console is behind CGNAT |

- Setup connects and lists the console's sites, which also proves the key works.
- `npx alchemy profile show` connects and shows the Network version, or why the console is unreachable.
- Self-hosted Network Application controllers work directly too: give the controller's URL (e.g. `https://unifi.example:8443`).

## Certificates

Consoles ship a self-signed certificate. When Node doesn't trust a console's certificate, setup offers to **pin** it: the provider then accepts only a certificate chain containing that SHA-256 fingerprint. It can also skip verification entirely, which isn't recommended.

> [!WARNING]
> A console that regenerates its certificate (after a reset, or some upgrades) fails the pin. Run `npx alchemy profile edit --reconfigure UnifiNetwork` to pin the new one.

## Through ui.com: limits

- ui.com allows 100 requests a minute per console. The provider stays under 90, so a large first deploy or adoption can slow down. Plans read most resource types with one request per type.
- Each request is slower (about a second or more). `UnifiNetwork.state()` keeps its state smaller than direct connections allow ([details](state.md#size)).

## Several consoles, sites or connections

Use a profile per console, and a stage per site, and pass both:

```sh
npx alchemy profile edit --profile office --add UnifiNetwork
npx alchemy deploy --stage office --profile office
```

A stack can't check that a stage is paired with the right profile by itself. If you deploy one stack to several sites, it's worth checking in the stack body. The resolved credentials say where they came from:

```ts
import * as UnifiNetwork from "@alchemy-unifi/network";
import * as Effect from "effect/Effect";

export const profileName = Effect.gen(function* () {
	const { source } = yield* yield* UnifiNetwork.UnifiNetworkCredentials;
	return source.type === "profile" ? source.profile : "environment";
});
```

**Consoles hosting several UniFi sites** (e.g. a self-hosted controller for several customers): setup asks which site resources go in by default, and any resource can set `site` (an ID, internal reference or name) to use another. A console with one site needs neither.

## Environment variables and CI

Set these instead of a profile:

| Variable                 | For                                                            |
| ------------------------ | -------------------------------------------------------------- |
| `UNIFI_URL`              | A direct connection: the console's URL                         |
| `UNIFI_CONSOLE_ID`       | A ui.com connection: the console's ID (instead of `UNIFI_URL`) |
| `UNIFI_API_KEY`          | The Network API key (direct) or Site Manager key (ui.com)      |
| `UNIFI_CERT_FINGERPRINT` | Optional: a SHA-256 fingerprint to pin                         |
| `UNIFI_INSECURE`         | Optional: `true` skips certificate verification                |
| `UNIFI_SITE`             | Optional: the site, on consoles hosting several                |

> [!WARNING]
> When `UNIFI_API_KEY` and one of `UNIFI_URL` or `UNIFI_CONSOLE_ID` are set, they win over every profile, for every stage. With several consoles, keep them out of `.env`, or every stage targets the same console.
