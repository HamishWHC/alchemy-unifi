# WifiBroadcast

A Wi-Fi network (SSID). `type` picks `"STANDARD"` or `"IOT_OPTIMIZED"`; changing it, or the site, replaces the broadcast.

- **`network`** is a network reference, or `WifiBroadcast.NATIVE_NETWORK` for the site's default (untagged, VLAN 1) network. The console only accepts the default network that way (referencing it by ID is rejected: "referencing default network is not allowed"), so a reference to a `Network` resource or lookup that is the default network is sent as `NATIVE` too. The API counts such a broadcast as one of the default network's references.
- **Standard broadcasts with WPA security must set `securityConfiguration.fastRoamingEnabled`** (the console rejects them otherwise; the spec can't say so because the security object is shared with IoT broadcasts, which don't support fast roaming). The props type requires it.
- **Passphrases** take `Redacted` (e.g. `yield* Config.redacted("WIFI_PASSPHRASE")`); they still end up in Alchemy's state, like any prop. The API returns passphrases, so one changed in the UI is put back by the next update.
- **Enterprise security's `radiusConfiguration` is untyped** (`unknown`): the spec gives it no schema and it hasn't been worked out on the controller.
- Device filters and mDNS policies still take raw device and network IDs.
