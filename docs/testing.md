# Testing

Never test against a real console; see `AGENTS.md`.

- **Unit tests** (`pnpm turbo run test:unit`, or `pnpm run test:unit` in a package) need nothing running:
    - `packages/network/test/helpers/fake-console.ts` serves `/v1/info` and `/v1/sites` over http or https on a random port. Its certificates (a CA and a `localhost` leaf) are generated with `openssl` at test time, so no keys are committed. Keys are RSA with SHA-256 signatures, because LibreSSL's defaults (SHA-1, explicit EC parameters) are rejected by Node;
    - `helpers/scripted-interaction.ts` answers `configure` prompts by message prefix;
    - remote mode is tested against a fake `HttpClient`, since there's no console behind ui.com to use.
- **Controller tests** (`test/controller/**` in `network` and `network-sdk`) run against the test controller, a disposable UniFi Network Application in Docker that accepts API keys like a real console. `pnpm test` runs both kinds, and starts the controller if it isn't running (24 s from scratch, plus image pulls the first time; 2-3 s when it's already up).

## Writing controller tests

- **Each file gets its own UniFi site:** `useSite(label)` from `@alchemy-unifi/test-controller/vitest` creates one before the file's tests and deletes it (with everything in it) afterwards. Parallel worktrees share one controller, and UniFi rejects duplicate names and VLAN IDs, so tests must never use the `default` site.
- **Provider tests** use `alchemy/Test/Vitest` (`Test.make({ providers: UnifiNetwork.providers() })`, then `test.provider(...)`, which deploys a scratch stack and destroys it afterwards). `useSite` sets `UNIFI_URL`, `UNIFI_API_KEY` and `UNIFI_SITE` for the file, which is how they get credentials.
- **SDK tests** take `CONTROLLER.baseUrl` and `CONTROLLER.apiKey` from `@alchemy-unifi/test-controller`.
- **The Integration API caches the site list for about 10 s.** A new site doesn't appear in `GET /v1/sites` until then (`useSite` waits for it), and a deleted one stays listed. To test a missing site, use an ID or reference that never existed; requests under it behave like a deleted site's (404).
- Test sites left behind by killed runs are named `alchemy-unifi-test-<ms timestamp>-…`, and the next controller start deletes any over an hour old.

## Running the test controller by hand

```sh
cd packages/test-controller
pnpm run up     # start (or reuse) and prepare it; prints the base URL and API key
pnpm run down   # throw it all away
```

- Base URL `http://localhost:18080/proxy/network/integration`, API key `alchemy-unifi-test-key`.
- The standalone UI and legacy API are at `https://localhost:18443` (admin / `Test-Passw0rd!`).
- The compose project has a fixed name, so every worktree reuses the one controller.

## How it works

```text
test ──X-API-KEY──▶ unifi-os :18080/proxy/network/*    fake UniFi OS proxy: checks the key, adds X-ApiKeyId
                        ▼
                    unifi :8080                         linuxserver/unifi-network-application:10.6.109 + api-key-agent
                        │ GET /api/system, /api/apiKey/{id}, /api/users/{id}
                        ▼
                    unifi-os 127.0.0.1:11081            fake UniFi Core: one fixed key and user, full scopes
```

On a console, UniFi OS checks API keys and forwards requests with `X-ApiKeyId`; see [unifi-api.md](unifi-api.md#how-api-key-auth-works-inside-a-console). The harness reproduces just that.

`internal-port.sh` exists because the authenticator only trusts requests on `unifi.local.http.port`, which it reads from `system.properties`, not from `-D` flags.

### Why the agent exists

- `-Dintegration.api.force.using.ucore.authentication=true` is an existing switch that points the Integration API at the UniFi OS authenticator.
- That authenticator still returns early unless `unifi.core.enabled` is set. Setting that globally turns on every UniFi OS integration, which needs proprietary gRPC components missing from the standalone build, so the controller fails to start.
- The agent rewrites only that check, using the JDK's built-in ClassFile API.

It targets obfuscated class and method names (`com/ubnt/net/g/oViVvFSgD`, `com/ubnt/g/aoUDgXMlCqEvTSIrOtq.WBZgUYGO`), so it is **tied to 10.6.109**. A controller bump needs those names re-found:

1. Copy `/usr/lib/unifi/lib` out of the container.
2. Find the class reading the `X-ApiKeyId` header and the method reading `unifi.core.enabled` (`javap -c`).
3. Update the constants.

### Why the fake gateway and migration exist

Every prepared site (the default one, and each test site) gets both:

- Gateway-managed networks need a gateway on the site. The harness inserts an offline UDM Pro into the `device` collection, which satisfies the check. Its MAC is derived from the site's ID, so each site's is distinct.
- Zone endpoints need the zone-based firewall migration. The harness runs the real one, so the system zones are genuine. Running it again is harmless (204).

## What's been verified

From a clean start, by hand:

- API-key auth on the console-style path (a wrong key gets 401);
- network create/update/delete, for both unmanaged and gateway-managed networks (with DHCP), with typed `NotFound` after delete;
- Wi-Fi broadcast create, and passphrase readback;
- system and custom firewall zones, firewall policies, and policy ordering.

## Hardware the fake UniFi OS claims

`fake-unifi-os.mjs` reports real hardware for the controller's CPU: a UDM Pro on arm64, a Cloud Key Enterprise (`UCKENT`) on x86, which is what CI runners get. The full suite passes on both (x86 checked locally under Docker's amd64 emulation, where the controller starts in about a minute), including alongside the fake UDM Pro gateway.

## Limits

- The gateway is offline, so anything that needs a live device can't be tested: WAN status, clients, device and port actions, statistics.
- The cloud connector can't be exercised; only its base URL and rate limits differ from local mode.
- The legacy API is reachable on `https://localhost:18443` with the admin session, but there's no API-key path to it.
