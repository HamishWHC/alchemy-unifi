# WifiBroadcast

A Wi-Fi network (SSID). `type` is `"STANDARD"` or `"IOT_OPTIMIZED"`.

```ts
import * as UnifiNetwork from "@alchemy-unifi/network";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";

export const wifi = Effect.gen(function* () {
	const lan = yield* UnifiNetwork.Network.lookup({ vlanId: 1 });
	const passphrase = yield* Config.Redacted("WIFI_PASSPHRASE");
	const home = yield* UnifiNetwork.WifiBroadcast("home-wifi", {
		type: "STANDARD",
		name: "Home",
		enabled: true,
		network: lan,
		hideName: false,
		clientIsolationEnabled: false,
		multicastToUnicastConversionEnabled: false,
		uapsdEnabled: false,
		channel2gLockedTo6: false,
		dtimPeriod2gLockedTo3: false,
		advertiseDeviceName: false,
		arpProxyEnabled: false,
		bssTransitionEnabled: true,
		broadcastingFrequenciesGHz: [2.4, 5],
		securityConfiguration: { type: "WPA2_PERSONAL", passphrase, fastRoamingEnabled: false },
	});
	return { home: home.wifiBroadcastId };
});
```

`network` is a network reference, or `WifiBroadcast.NATIVE_NETWORK` for the site's default network. A reference to the default network (like `lan` above) works too.

**Lookup:** `WifiBroadcast.lookup({ name })`.

**Adoption** matches the SSID.

## Gotchas

- **Passphrases are stored in plaintext in Alchemy's state,** as every prop is, and the console returns them, so `alchemy drift` sees one changed in the UI. Read them from config as `Redacted` (as above) to keep them out of logs and plans.
- **Standard broadcasts with WPA security must set `fastRoamingEnabled`.** The console rejects them otherwise, and the type requires it.
- **The console requires more than the API spec says:** open security and WPA2/WPA3 personal need a `network`; WPA2 personal needs either `presharedKeys` or both a `network` and a `passphrase`; `mloEnabled` is only accepted (even as `false`) with WPA3 on several bands.
- **Changing `type` (or `site`) replaces the broadcast,** so devices reconnect.
- **Enterprise security's `radiusConfiguration` is untyped,** and device filters and mDNS policies still take raw device and network IDs.
