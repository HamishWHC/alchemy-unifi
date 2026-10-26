# WifiBroadcast

A Wi-Fi network (SSID). `type` picks `"STANDARD"` or `"IOT_OPTIMIZED"`; changing it, or the site, replaces the broadcast.

- **`network`** is a network reference, or `WifiBroadcast.NATIVE_NETWORK` for the site's default (untagged, VLAN 1) network. The console only accepts the default network that way (referencing it by ID is rejected: "referencing default network is not allowed"), so a reference to a `Network` resource or lookup that is the default network is sent as `NATIVE` too. The API counts such a broadcast as one of the default network's references.
- **Standard broadcasts with WPA security must set `securityConfiguration.fastRoamingEnabled`** (the console rejects them otherwise; the spec can't say so because the security object is shared with IoT broadcasts, which don't support fast roaming). The props type requires it.
- **Passphrases** take `Redacted` (e.g. `yield* Config.redacted("WIFI_PASSPHRASE")`); they still end up in Alchemy's state, like any prop, and in the `config` attribute as `Redacted`. The API returns passphrases, so drift sees one changed in the UI, and the next update puts it back.
- **Explicit default** (verified; see the [conventions](README.md#conventions)): a standard broadcast's `bandSteeringEnabled` is `false`, because the console reports that when it's unset. Every other optional field defaults to absent (a `PUT` without one removes it). Band order in `broadcastingFrequenciesGHz` doesn't count as a difference: consoles don't keep the order sent.
- **The console requires more than the spec says:** open security and WPA2/WPA3 personal need a `network`; WPA2 personal needs either `presharedKeys` or both a `network` and a `passphrase`; `mloEnabled` is only accepted (even as `false`) with WPA3 on several bands.
- **Enterprise security's `radiusConfiguration` is untyped** (`unknown`): the spec gives it no schema and it hasn't been worked out on the controller.
- Device filters and mDNS policies still take raw device and network IDs.
