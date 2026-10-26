# TrafficMatchingList

A named list of IPv4 addresses (single, range or subnet), IPv6 addresses (single or subnet) or ports (single or range), which firewall policies reference instead of repeating values inline. `type` picks which: `IPV4_ADDRESSES`, `IPV6_ADDRESSES` or `PORTS`.

- **No MAC lists.** The API has no MAC type. Firewall policies match MACs inline in a source filter; reuse a constant in config instead.
- **Names are unique per site** (the console rejects a duplicate with 422), so adoption by name is unambiguous.
- **Changing `type` updates the list in place** (verified), so no replacement.
- **A list an enabled policy uses can't be deleted** (422 "referenced by other resources"). Alchemy deletes the referencing policies first, since they depend on the list, so this only happens when something outside the stack references it (e.g. a UI-made policy). The delete then fails with a user-facing `TrafficMatchingListInUse` naming the user-defined policies that reference the list.
- **Disabled policies don't hold a list** (verified): deleting a list one uses succeeds and leaves the policy with a dangling filter (the list ID vanishes from it), and re-enabling the policy then fails ("Traffic Matching List with id=… does not exist").
