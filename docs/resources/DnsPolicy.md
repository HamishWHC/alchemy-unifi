# DnsPolicy

The gateway's local DNS: a static record (`A_RECORD`, `AAAA_RECORD`, `CNAME_RECORD`, `MX_RECORD`, `SRV_RECORD`, `TXT_RECORD`) or a `FORWARD_DOMAIN` rule that sends a domain's queries to another DNS server. `type` picks which.

- **No name.** Adoption matches type and domain. A domain can hold several records of one type (two A records, verified), so when several match, the one whose other props match too is adopted; still several (or none) ⇒ nothing adopted.
- **Changing `type` updates the policy in place** (verified), so no replacement.
- **The console validates records against each other**, e.g. it rejects a CNAME whose alias overlaps another record ("CNAME record alias overlaps with other existing CNAME record").
