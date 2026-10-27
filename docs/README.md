# alchemy-unifi

[Alchemy](https://alchemy.run) providers for Ubiquiti UniFi. Describe a UniFi site's networks, Wi-Fi, zone-based firewall and local DNS as Effect code, and let Alchemy plan and apply the changes.

| Package                      | What                                                                                     |
| ---------------------------- | ---------------------------------------------------------------------------------------- |
| `@alchemy-unifi/network`     | The Alchemy provider for the UniFi Network application, and a state store on the console |
| `@alchemy-unifi/network-sdk` | The raw Effect SDK for the UniFi Network Integration API, which the provider is built on |

## Guides

- [Getting started](getting-started.md): install, connect to a console, deploy a first stack, and bring an existing setup under management.
- [Connecting to a console](connecting.md): direct and ui.com connections, certificates, several consoles, CI.
- [Concepts](concepts.md): references and lookups, built-in zones, how changes made in the UI are handled, adoption and drift.
- [State on the console](state.md): `UnifiNetwork.state()`, which keeps a stack's state on the console it manages.
- [The SDK](sdk.md): calling the Integration API directly.

For a real-world config, see [home-network](https://github.com/HamishWHC/home-network): two sites sharing one stack, with zones, networks, Wi-Fi, a full firewall matrix and the state store on the console.

## Resources

| Resource                                                        | What                                                  |
| --------------------------------------------------------------- | ----------------------------------------------------- |
| [`FirewallZone`](resources/FirewallZone.md)                     | Custom zones in the zone-based firewall               |
| [`Network`](resources/Network.md)                               | Networks (VLANs), with DHCP and zone membership       |
| [`WifiBroadcast`](resources/WifiBroadcast.md)                   | Wi-Fi networks (SSIDs)                                |
| [`TrafficMatchingList`](resources/TrafficMatchingList.md)       | Reusable port and address lists for firewall policies |
| [`FirewallPolicy`](resources/FirewallPolicy.md)                 | Zone-to-zone firewall policies                        |
| [`FirewallPolicyOrdering`](resources/FirewallPolicyOrdering.md) | The order a zone pair's policies are evaluated in     |
| [`DnsPolicy`](resources/DnsPolicy.md)                           | Local DNS records and forwarded domains               |

## Requirements

- UniFi Network **10.6** with the zone-based firewall. The provider tracks the latest stable Network release, and warns when a console runs another version.
- Node 22 or later, Alchemy 2 (beta) and Effect 4.

Working on the packages themselves? See [development/](development/README.md).
