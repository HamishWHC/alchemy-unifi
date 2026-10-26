# Connection and auth

How `@alchemy-unifi/network` finds and talks to a console. One Alchemy profile (or one set of environment variables) points at one console; users with several consoles use a stage and profile per console.

## Auth provider `UnifiNetwork`

A hand-rolled `AuthProviderImpl` (`src/AuthProvider.ts`), because `makeStoredAuthProvider` supports only one method.

| Method   | Reaches the console                                         | Profile values                                                             | Environment                                                                            |
| -------- | ----------------------------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `local`  | directly, at its URL                                        | `url`, `apiKey`, optional `certFingerprint` or `insecure`, optional `site` | `UNIFI_URL`, `UNIFI_API_KEY`, `UNIFI_CERT_FINGERPRINT`, `UNIFI_INSECURE`, `UNIFI_SITE` |
| `remote` | through the `api.ui.com` cloud connector, with a console ID | `consoleId`, `apiKey`, optional `site`                                     | `UNIFI_CONSOLE_ID`, `UNIFI_API_KEY`, `UNIFI_SITE`                                      |

- **Keys differ by method:** `local` takes a Network API key (Settings → Integrations); `remote` takes a Site Manager key from unifi.ui.com.
- **`site`** (a UniFi site: a namespace within one console) is only for consoles hosting several, such as an MSP's self-hosted controller. It names the site resources use when they don't set one, by internal reference (`default`, or a generated one like `x7k2m9q1`), which survives renames. Unset, resources use the console's only site. `profile show` lists it only when set.
- **Interactive `configure`:**
    - `remote` lists the key's consoles (Site Manager `GET /v1/hosts`) to pick from;
    - for an `https:` URL, `local` fetches the certificate. If Node doesn't trust it, it offers to pin its SHA-256 fingerprint (trust on first use) or skip verification;
    - both then connect and list the console's sites, which also proves the key works. With several sites, it asks for the default; with one, it stores nothing.
- **Non-interactive:** `alchemy profile edit --add UnifiNetwork --method local --set url=… --set apiKey=…` (fields as in the table). It validates the values but doesn't connect.
- **`alchemy profile show`** connects and reports the Network version, or why the console is unreachable.
- **Environment beats profiles.** Alchemy uses the `UNIFI_*` variables, CI or not, whenever `UNIFI_API_KEY` and one of `UNIFI_URL`/`UNIFI_CONSOLE_ID` are set. With several consoles, keep them out of `.env`, or every stage targets one console.

## Credentials and connection

```text
UnifiNetworkCredentials   profile or environment → { connection, site }      (src/Credentials.ts)
        ▼  first use, cached for the run
UnifiNetworkConnection    TLS client + base-URL probe → SDK Credentials      (src/Connection.ts)
        ▼
withConnection(effect)    provides the SDK's Credentials and HttpClient to SDK calls
```

Both services resolve on first use, so building `providers()` never needs a profile. A failed resolution dies with `CredentialsUnavailable` (Alchemy's convention). A failed connection fails with the SDK's `ConfigError`, saying whether the key was rejected, the console was unreachable or the certificate didn't match.

- **`source`** on the resolved credentials says where they came from: `{ type: "profile", profile }` or `{ type: "env" }`. Consumers can use it to check a stage is paired with the right profile.
- **Stack bodies can require `UnifiNetworkCredentials`** (`yield* yield* UnifiNetworkCredentials`). It carries Alchemy's `kind: "Credentials"` tag, the type-level marker Alchemy uses to let credentials services into a stack's requirements. `UnifiNetworkConnection` and `UnifiNetworkReadCache` carry `kind: "Environment"` for the same reason, so lookups can run in stack bodies (see [resources/README.md](resources/README.md#lookups)).

- **Provider-private client.** Alchemy runs lifecycle operations in the stack's merged context, so an `HttpClient` from `providers()` would replace other providers' clients and the state store's. `providers()` therefore provides no `HttpClient`, and resource code must wrap SDK calls in `withConnection`.
- **Base URL probe.** A `local` URL is tried as a UniFi OS console (`{url}/proxy/network/integration`), then as a standalone controller (`{url}/integration`), with `GET /v1/info`. A 404 moves on; anything else stops. `remote` uses `https://api.ui.com/v1/connector/consoles/{consoleId}/proxy/network/integration`, where `consoleId` is the Site Manager host `id`; the connector accepts `X-API-KEY` (verified by hand on a real console, since CI can't reach one).
- **Retries:** the probe uses the SDK's default retries (about 20 s for transport errors), except for certificate failures, which retrying can't fix.
- **Version check:** a warning, not a failure, when the console's major.minor differs from the SDK's `SPEC_VERSION`.
- **Remote rate limit:** a 90 requests/minute token bucket per console (the connector allows 100), in front of the SDK's 429 retries. A run beyond the 90-request burst waits ~0.7 s per request, so resources read through lists where possible (see [resources/README.md](resources/README.md#lifecycle)); local connections aren't limited.

## Sites

`resolveSite(site?)` (`src/Site.ts`) turns a resource's `site` into the site resources are created in:

- `site` may be an ID, internal reference or name; unset, it's the profile's `site`; unset there too, the console's only site.
- It fails (`SiteNotFound`, `SiteRequired`, `AmbiguousSite`, all marked as Alchemy user-facing errors) with the console's sites listed, so a plan stops before changing anything. A site deleted from the console can't be recreated through the API, so stopping beats recreating its resources somewhere unexpected.
- **Recovering from a deleted site:** point the profile or the resource at an existing site and plan again. Resources recorded in the deleted site then read as missing (requests under an unknown site 404) and are recreated. Deletes there 404 too, and deletes treat `NotFound` as done (Alchemy's `Provider.delete` contract requires idempotent deletes), so `alchemy destroy` also clears such a stage.

## Read cache

`UnifiNetworkReadCache` (`src/ReadCache.ts`) memoises reads for one `providers()` build, i.e. one CLI run or test file, so a plan touching many resources lists each collection once. A `ReadCache.key<A, E>(name)` names a kind of read; entries under it are scoped by a string such as a site ID. Concurrent callers share one load, failures aren't cached, and writes invalidate what they affect (`ReadCache.invalidating(key, siteId)`). The site list is the first user.

## TLS

The client is undici (`@effect/platform-node`) with one of three settings:

- **Verify** (default): Node's CAs, which suits a console with a public certificate.
- **Pin** (`certFingerprint`): accept the server if any certificate in its chain has the fingerprint, so a console's self-signed certificate or a private CA both work. Node skips `checkServerIdentity` when the chain doesn't verify, so pinning is a custom connector that checks the chain after the handshake. It also disables session resumption, because a resumed session presents no certificate to check.
- **Insecure** (`insecure`): no verification.

A console that regenerates its certificate fails the pin until the profile is reconfigured.
