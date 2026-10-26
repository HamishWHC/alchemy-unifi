# FirewallPolicyOrdering

The evaluation order of user-defined policies from one zone to another: `beforeSystemDefined` and `afterSystemDefined` buckets, with the system-defined policies between them (those can't be reordered).

- **One per zone pair**, and the pair is the identity: an existing ordering adopts without `--adopt`, and deleting the resource leaves the order as it is.
- **Listing policies makes it depend on them**, so it's applied after they're created or moved into the pair.
- **The API takes the whole pair or nothing** ("Not all firewall policies specified for the given firewall zone combination", verified). Unlisted policies (e.g. made in the UI) are kept after the listed ones in their bucket, in their current relative order, with a warning; `exclusive: true` fails instead.
- **Policies the ordering stops listing are kept quietly**, even when exclusive. Alchemy applies the ordering before deleting a removed policy, so without this, removing a policy and its place in an exclusive ordering in one deploy would fail. The attribute `listedFirewallPolicyIds` records what the props listed.
- **Validation:** a listed policy that's missing, derived, in another zone pair, or listed twice fails the deploy with a user-facing `InvalidFirewallPolicyOrdering`.
- **Derived policies aren't in orderings** at all (verified), so they never count as unlisted.
