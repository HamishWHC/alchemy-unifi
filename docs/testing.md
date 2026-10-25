# Testing

- **Unit tests:** `pnpm test` (vitest + `@effect/vitest`) in `packages/network/test/*.test.ts`. Currently one smoke test that builds the provider collection.
- **Test controller:** a disposable UniFi Network Application in Docker that accepts API keys like a real console. The SDK has been exercised against it by hand; there are no automated lifecycle tests yet.

Never test against a real console; see `AGENTS.md`.

## Running the test controller

```sh
cd packages/network/test/controller
docker compose up -d
./setup.sh                   # first-run setup, fake gateway, zone-based firewall migration
# base URL: http://localhost:18080/proxy/network/integration
# API key:  alchemy-unifi-test-key   (override with UNIFI_TEST_API_KEY on the unifi-os service)
docker compose down -v       # throw it all away
```

The standalone UI is also available at `https://localhost:18443` (admin / `Test-Passw0rd!`).

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

- Gateway-managed networks need a gateway on the site. `setup.sh` inserts an offline UDM Pro into the `device` collection, which satisfies the check.
- Zone endpoints need the zone-based firewall migration. `setup.sh` runs the real one, so the system zones are genuine.

## What's been verified

From a clean start:

- API-key auth on the console-style path (a wrong key gets 401);
- network create/update/delete, for both unmanaged and gateway-managed networks (with DHCP), with typed `NotFound` after delete;
- Wi-Fi broadcast create, and passphrase readback;
- system and custom firewall zones, firewall policies, and policy ordering.

## Limits

- The gateway is offline, so anything that needs a live device can't be tested: WAN status, clients, device and port actions, statistics.
- The cloud connector can't be exercised; only its base URL and rate limits differ from local mode.
- The legacy API is reachable on `https://localhost:18443` with the admin session, but there's no API-key path to it.
