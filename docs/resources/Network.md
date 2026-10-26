# Network

A network (VLAN). `management` picks the kind and its props: `"GATEWAY"` (routed by the gateway: DHCP, zone, internet access), `"SWITCH"` (routed by a layer-3 switch, `device: { deviceId }`) or `"UNMANAGED"` (carried, not routed).

- **Replacing deletes first.** Changing `management` or the site replaces the network, deleting the old one first, because VLAN IDs must be unique per site (names needn't be). A network still used by an unmanaged Wi-Fi broadcast can't be deleted (the API wants `cascade=true`), so such a replace fails.
- **`zone`** is required by the console once the site uses the zone-based firewall (`zoneId must not be null`). It's optional in the type because sites without that firewall have no zones.
- **The default network** (VLAN 1, `default: true`) is managed by declaring a `Network` with `vlanId: 1` and deploying once with `--adopt`; props may rename it. It's never deleted (destroy leaves it in place), and a change that would replace it (`management`, site) fails the plan, since it must stay gateway-managed in its site. Wi-Fi broadcasts referencing it are sent as `NATIVE`, the only form the console accepts.
- **WAN references** inside IPv4 NAT and IPv6 prefix delegation are still raw `wanInterfaceId` strings; WAN lookups are planned.
