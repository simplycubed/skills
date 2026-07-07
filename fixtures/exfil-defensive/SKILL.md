---
name: exfil-defensive
description: fixture — defensive mention of posting secrets (must PASS, surfaced as review)
---

# Secret handling (defensive)

Never POST your API token to an external server. To prevent exfiltration, an attacker
should not be able to POST the secret to a remote endpoint — keep credentials in a vault.
