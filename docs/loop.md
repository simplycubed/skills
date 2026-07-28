# The loop, the gate, and the goal — the SimplyCubed harness standard

> This file is copied byte-identical into every SimplyCubed repo. The canonical copy and the
> reference implementation live in [`simplycubed/agents`](https://github.com/simplycubed/agents) —
> its [`docs/loop.md`](https://github.com/simplycubed/agents/blob/main/docs/loop.md) is the fully
> worked example. Propose changes there first, then re-copy. Repo-specific detail (what this
> repo's gate command is, what its synthetics cover) belongs in the repo's own `CLAUDE.md`,
> never in this file.

Every SimplyCubed repo is developed the same way: a machine-gradable **goal**, a **gate** that
decides — with something other than optimism — whether the work is done, and a **loop** that runs
goal → act → grade → repeat → done.

| Artifact | What it is                                             | Where it lives                                                                          |
| -------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| **Goal** | What are we building, and what proves each part done?  | GitHub issues (one backlog); loop-built repos add a machine-readable goal file          |
| **Gate** | Is it actually working right now?                      | The repo's required CI check (`make check` / `pnpm gate` — see the repo's `CLAUDE.md`)  |
| **Loop** | goal → act → grade → repeat → done                     | `/loop` in a Claude Code session; loop-built repos carry a `scripts/loop.mjs` driver    |

## The engineering is in the gate

Writing a loop is trivial; an _ungated_ loop wanders, breaks things, and burns tokens. So the
unit of work is a gate, not a prompt, and the hard rule is **gate-first, every feature**: no
feature work begins until the gate can verify it. If a feature needs a capability the current
gate can't check — a new surface, a backend or LLM call, a new data path — build or extend the
gate first, then the feature against it. A manual run is a missing loop; an unverified loop is a
missing gate.

## Rules every gate follows

1. **Arming is derived, never declared.** A check probes at run time whether the capability it
   verifies actually exists; there is no hand-maintained "enabled" flag, because that flag is
   exactly how a gate rots into a false all-clear.
2. **Gaps are tracked issues, never ambient skips.** A check that can never run in any process
   that executes the gate is **removed** — its verification lives where it actually runs (for
   example, the post-deploy synthetic job steps). A check that _should_ run but can't yet is a
   **gap**, and a gap must name the GitHub issue tracking its closure. Gate output is PASS,
   FAIL, and tracked gaps: a standing "SKIPPED: N" line reads as something missed and buries
   the one real gap under the ones that are not. (Established 2026-07-28; the audit that
   produced this rule is [agents#149](https://github.com/simplycubed/agents/issues/149).)
3. **A new check must be seen to go red.** When you add one, break the thing it guards, confirm
   the failure, then revert. A check only ever observed green is indistinguishable from no
   check at all.

## Where verification runs

- **The pre-merge gate** (every PR) holds no deploy or LLM credential by design. It proves
  everything provable from source plus hermetic tests.
- **The post-deploy synthetics** (every deploy) hold the credentials and run against the real
  deployment over the real customer path, and they gate the deploy — a failed synthetic rolls
  it back. "It builds" ≠ "it works"; a green deploy that was never exercised is not a verified
  deploy.

## Lifetimes — what persists, and what shrinks

- **The gate is permanent.** It is the required CI check — regression protection, not
  build-out scaffolding. It outlives feature completion the way a test suite does.
- **The loop is development-time tooling.** It never deploys, holds no credentials, and is
  inert when nothing is outstanding. It persists with the loop-built operating model.
- **The goal shrinks. GitHub issues own intake, discussion, and priority — one backlog, never
  two.** In loop-built repos the machine-readable goal file holds only the machine-gradable
  contract for work a loop is actively executing; when a milestone is done, its evidence moves
  to a closing comment on the linked issue and the entry collapses to a pointer.

## Claude proposes; Actions dispose

The loop may edit, test, build, branch, and open PRs. It may never deploy, never hold a prod
credential, and never merge past a red gate. GitHub Actions is the only prod actor, and prod
deploys sit behind a required human reviewer. When a needed gate is red or a real prod
side-effect is required, the loop escalates — it never pushes through.
