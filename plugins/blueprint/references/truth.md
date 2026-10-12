# Truth and audiences

A figure is a claim, and a reader trusts a precise-looking figure more than a paragraph. Draw only what is true in production today.

## Truth rules

- Every node, wire label, tag, spec and number is verifiable in code, configuration, data or the provider console. When in doubt, leave it out.
- Every number names its source before it goes in: the query, the command or the file it came from, kept in a comment in the source. Check each one again before you render. A wrong number on a polished figure travels far.
- Draw something under construction as `node planned`, and say so in the prose too.
- Name a security property only when it holds for every case the figure covers. "HTTPS on every public connection" is fine. "Encrypted everywhere" needs proof for every internal hop.
- Customer and marketing figures follow the engineering page that documents the same system. When that page changes, the figures drawn from it change too.

## Audiences

The same style serves four audiences. What changes is what the figure may name and claim.

| Audience | Where | Internal service names | Vendor names |
| --- | --- | --- | --- |
| Engineering | Internal engineering docs, PRs, the team's Slack | Yes | Yes |
| External developers | Public API and integration docs | Never. Name the capability: "Reader", "PDF processing", "API" | Yes |
| Customers | Customer documents, security reviews | Never | Yes, they show solid foundations |
| Marketing | Website, posts, social cards | Never | Yes |

Outside engineering, a figure also never shows hostnames, IP addresses, account IDs, bucket names, queue names, customer names or anything that helps an attacker map the system.
