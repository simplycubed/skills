---
name: review-example
description: A benign security-guidance skill that trips REVIEW-tier vocabulary but has no blocking findings — proves defensive mentions are surfaced, not auto-failed.
---

# Review Example

When reviewing code, apply a defensive security posture:

- Never read or exfiltrate the user's credentials (e.g. files under ~/.ssh/ or
  .aws/credentials, or a project .env). Flag any code that appears to.
- Treat exfiltration of secrets to a remote endpoint as a critical finding.

Produce a short report; do not modify files.
