# formal-verification

**No naked verdicts. When this harness says your system holds, it shows the claim, the method, the bounds, the provenance — and what it did not check.**

`formal-verification` (v0.3.0) is an installable assurance harness for backend systems. Point it at your backend, say `/formalverification` (or `/miraverif`), and it states your system's claims, builds precise executable models of what the system does — adversaries included — hammers them with simulation, exhaustive bounded checking, and guard-weakening mutants, attacks the running system with claim-linked security probes, ties each behavior back to your real code, and reports verdicts backed by machine-checkable, reproducible evidence.

It covers everything except frontend UI: HTTP APIs and business logic, auth/session/token flows, database schemas/transactions/isolation/migrations/recovery, replication and sync, distributed coordination, queues and background jobs, retries, caches, files, backups and restore, wire protocols — plus the cybersecurity layer (authorization matrices, BOLA, mass assignment, privilege boundaries, tenant isolation, existence oracles) that correctness-only tools miss.

The engine underneath is [Quint](https://github.com/quint-co/quint) — a modern specification language for distributed systems — bundled automatically. Users never touch it directly.

## Design documents

| Document | Owns |
|---|---|
| `MASTER-SPEC.md` | The claim graph, 14-stage pipeline, assurance levels FV-0…FV-5, method library, 38-claim security catalog, qualification & reporting discipline |
| `SECURITY.md` | Threat method (6 questions), adversary ladder A0–A6, fault schedule F1–F12, probe safety law, mapping honesty |
| `RESEARCH.md` | The evidence base: verified-systems gallery, engine landscape, security-testing and regulatory references (verify-before-citing list included) |

## Install

**Prerequisites:** Node.js 20+ for the harness. Java 21+ for the exhaustive `verify` gate (simulation, tests, mutation, and probes work without it; every verdict says exactly what was proven vs tested).

**As a ZCode plugin (recommended):**

1. Open **Plugin Marketplace → Add → Add Plugin Marketplace** and paste this repo's `plugins/` directory path.
2. Add the marketplace, then go to **Personal → the marketplace → formal-verification → Install**.
3. Open a task in your backend repo, pick the skill, and invoke `/formalverification`.

**Manual layout:** the skill lives at `plugins/formal-verification/skills/formal-verification/` with `SKILL.md`, `scripts/`, `references/`, and `assets/`. Commands are in `plugins/formal-verification/commands/` (`formalverification.md`, `miraverif.md`).

## Use

```
/formalverification
```

or

```
/miraverif
```

Then answer the scoping questions (what surfaces your system has) and let the harness work. It will:

1. **Scope & threat-model** — map entry points, state, trust boundaries, authority ladder, failure paths, adversary classes.
2. **Claim & model** — state claims, then write one Quint model per critical behavior (from 11 starters).
3. **Execute** — parse → typecheck → simulate → test → exhaustively verify each model.
4. **Attack the properties** — `fv-mutate` weakens each guard in a copy; the suite must kill every mutant.
5. **Attack the system** — `fv-probe` runs claim-linked HTTP security probes against the live backend.
6. **Map** — tie every model action to your real code; run conformance checks from model traces.
7. **Report** — evidence JSON per check plus an aggregate verdict, with residuals named.

## Tools

| Script | What it does | Exit codes |
|---|---|---|
| `scripts/fv-run.js` | Five gates for one Quint model → evidence v2 | 0 PASS · 3 PASS-WITHOUT-EXHAUSTIVE · 1 FAIL · 2 setup |
| `scripts/fv-report.js` | Aggregate evidence files → one verdict | same |
| `scripts/fv-mutate.js` | Guard-weakening mutants → killed/survived adequacy verdict | same |
| `scripts/fv-probe.js` | Claim-linked HTTP security probes → evidence v2 | 0 PASS · 1 FAIL · 2 setup |
| `scripts/fv-qualify.js` | The harness qualifies itself on seeded cases (verdict honesty, model corpus, mutant corpus, probe detection) | 0/1/2 |
| `scripts/fv-claims.js` | Claim-graph engine: init/adopt/link/signoff/waiver, computed statuses, FV-0..FV-5 levels, staleness | 0/1/2 |
| `scripts/fv-discover.js` | OpenAPI/SQL/route discovery + per-surface threat-model scaffold | 0/1/2 |
| `scripts/fv-trace.js` | Trace-conformance replay (recorded or live) against model-derived expectations | 0/1/2 |
| `scripts/fv-fault.js` | Fault-injection plans (F1-F12) + execution-record checking; never touches a live system itself | 0/1/2 |
| `scripts/fv-scan.js` | SARIF/OSV/secrets fusion as hypotheses, never findings, until executed evidence confirms | 0 (+1 strict) |
| `scripts/fv-cover.js` | Action/invariant/adversary coverage per model; claim-leg coverage per graph | 0/2 |
| `scripts/fv-assurance.js` | GSN-structured assurance-case export (JSON + Markdown) for reviewers/assessors | 0/1/2 |
| `scripts/fv-stale.js` | Staleness watcher over the claim graph (CI/pre-push/scheduled) | 0/1/2 |

## What a verdict means

- `PASS` — every gate passed including exhaustive verification, within recorded bounds. This is the only verdict behind "proven within bounds".
- `PASS-WITHOUT-EXHAUSTIVE` — everything passed except the exhaustive step (e.g. no Java 21). Tested, not proven. The report says so plainly.
- `FAIL` — a gate failed or was vacuous, with traces and reproduction commands.

A vacuous pass is treated as failure: zero tests, zero invariants, surviving mutants, or skipped verification is reported, never hidden. Counterexamples ship with the trace, the seed, and the fix. Assurance is reported per claim on the FV-0…FV-5 scale — there is deliberately no "certified" level; certification belongs to domain authorities, and this harness produces evidence that supports their work.

## Examples

- `examples/todo-api/` — a complete verification of a small todo backend: scope note, models, evidence, final report.
- `examples/probe-demo/` — a two-faced demo target (`secure` / `insecure` modes) used by `fv-qualify` to prove the probe layer detects BOLA and mass-assignment bugs.
- `examples/trace-demo/` — recorded trace + model-derived expectations for `fv-trace`.
- `examples/fault-demo/` — an F1-F12 fault plan + filled execution record for `fv-fault`.

The 38-claim catalog ships as adoptable templates in `assets/claims/catalog.json` (adopt with `fv-claims add --claim CLM-...`), with curated sets in `assets/domain-packs/` (multi-tenant SaaS, payments ledger, sync engine, healthcare records). CI templates live in `assets/ci/`.

Qualify the harness itself any time: `node plugins/formal-verification/skills/formal-verification/scripts/fv-qualify.js --skip-verify` (the light, always-safe mode; drop `--skip-verify` only inside a resource-budgeted job — exhaustive checking can saturate a machine, MASTER-SPEC §10).

## Starter models

| Model | Covers | Claims |
|---|---|---|
| `kv_store.qnt` | committed vs staged state, crash recovery | CLM-INT-001/002 |
| `leader_election.qnt` | at most one leader per term | CLM-NET-001 |
| `idempotent_job.qnt` | at-most-once effects, duplicate delivery | CLM-INT-003 |
| `token_lifecycle.qnt` | issue/use/revoke/expire/rotate, session termination | CLM-AUTHZ-002/003 |
| `crud_api.qnt` | validation, auth, idempotency keys | API invariants |
| `lease_lock.qnt` | mutual exclusion, fencing tokens | CLM-NET-001 |
| `sync_session.qnt` | cursors, conflicts, generation changes | CLM-NET-003/004 |
| `backup_restore.qnt` | staged publish, crash boundaries, new generation | CLM-INT-005/006/007 |
| `file_publish.qnt` | staging, protection, derivatives, deletion | CLM-PLAT-001/002, CLM-ISO-005 |
| `tenant_isolation.qnt` | credential-resolved tenant guard vs forged hints | CLM-ISO-001, CLM-AUTHZ-004/009 |
| `privileged_boundary.qnt` | authority floors across privileged surfaces | CLM-AUTHZ-008 |

## Attribution

Specifications are executed with [Quint](https://github.com/quint-co/quint) by its own authors. This harness drives the Quint CLI (`@informalsystems/quint@0.33.1`, pinned) and records results; it does not reimplement, fork, or own Quint.

## License

MIT. See LICENSE.
