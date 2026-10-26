# FirewallZone

A custom zone in the zone-based firewall: just a `name`.

- **Networks join zones from the network side** (`Network({ zone })`, user's decision). `FirewallZone` has no `networks` prop and no `networkIds` attribute: both sides are writable in the API, so managing both would make the resources fight.
- **Built-in zones are constants, not resources:** `FirewallZone.INTERNAL`, `EXTERNAL`, `GATEWAY`, `VPN`, `HOTSPOT`, `DMZ`. Each resolves by name (`Internal`, `External`, `Gateway`, `Vpn`, `Hotspot`, `Dmz`) and `metadata.origin: "SYSTEM_DEFINED"` in the referencing resource's site. Built-in zones can be neither renamed nor deleted.
- **Renaming keeps members.** The update body must include `networkIds`, and replaces the member list. The zone's own `networkIds` lags a network joining by about 300 ms, and sending a stale list moves the network out (verified), so the provider builds the list from the networks' `zoneId`s instead.
- **Deleting a zone moves its networks to `Internal`** (verified). Alchemy updates networks that referenced it before deleting it.
