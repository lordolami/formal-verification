# Changelog

## 0.3.0 — The Claim Graph Release (2026-11-01)

Everything specified in MASTER-SPEC beyond the v0.2.0 core is now built and
self-qualified. The harness grows from "verify models, probe systems" into the
full 14-stage pipeline.

### Added

- **Claim-graph engine** (`fv-claims.js`) — init/adopt/link/signoff/waiver/status.
  Statuses (SUPPORTED/STALE/UNSUPPORTED/REFUTED) and FV-0…FV-5 levels are computed
  from linked evidence and input hashes only. Hyperproperty claims capped at FV-1
  on model evidence alone. Intolerable+REFUTED exits 1.
- **38-claim catalog + domain packs** — every SECURITY.md §4 claim as an adoptable
  template (`assets/claims/catalog.json`; count corrected from 36 — AUTHZ×12,
  ISO×6, INT×8, NET×6, PLAT×6), plus curated packs (multi-tenant SaaS, payments
  ledger, sync engine, healthcare records).
- **Discovery** (`fv-discover.js`) — OpenAPI (JSON + labeled lite-YAML), SQL DDL,
  and multi-stack route scanning; per-surface six-question threat scaffold with
  candidate-claim mapping. Reports inference as inference.
- **Trace conformance** (`fv-trace.js`) — recorded-trace replay or live execution
  against model-derived expectations; steps without observations are errors.
- **Fault planning** (`fv-fault.js`) — validated F1-F12 plans per claim plus
  execution-record checking. Deliberately never induces faults itself; production
  targets require signoff and reject staging-destructive procedures.
- **Scan fusion** (`fv-scan.js`) — SARIF/OSV/secrets imports land as HYPOTHESES
  with candidate-claim mapping; promotion to FINDING requires executed evidence.
- **Coverage** (`fv-cover.js`) — exercised-action %, invariant checking, adversary
  presence per model; claim-leg coverage per graph. Measurement, never a verdict.
- **Assurance export** (`fv-assurance.js`) — GSN-structured case (JSON+Markdown),
  stale/refuted first, residuals named, prohibited-words enforced; records the
  FV-5 case-assembled leg for FV-4 claims.
- **Continuous layer** — `fv-stale.js` watcher + CI templates (`assets/ci/`)
  encoding budgets, exit-code discipline, and the verify resource gate.
- **Qualification extended** — Q5 (claim engine + assurance + staleness) and Q6
  (trace/fault/discovery/coverage/scan fixtures); `fv-qualify --skip-verify`
  resource-gated mode so the battery is always safe to run.

### Notes

- Exhaustive verification (Apalache/TLC) is now formally resource-gated
  (MASTER-SPEC §10): opt-in per budgeted job only. Simulation, scenario tests,
  mutation, probes, and the full claim pipeline are the always-on layer.

## 0.2.0 — No Naked Verdicts (2026-11-01)

The release that turns a correctness checker into an assurance harness: honest verdicts,
adversaries in the models, security probes against live systems, mutation adequacy, and
self-qualification.

### Fixed — verdict honesty (defect disclosure)

v0.1.0 recorded skipped gates as `ok: true`, and `gateVerdict()` returned `PASS` whenever no
gate had failed. A run with exhaustive verification skipped therefore reported **PASS**,
contradicting the v0.1.0 documentation. The shipped example evidence
(`examples/todo-api/evidence/todos_crud.evidence.json`, formatVersion 1) exhibits the defect:
`verify: "skipped by flag"` alongside verdict `PASS`. That record is retained unmodified as a
legacy artifact and is labeled LEGACY by `fv-report`; re-run it with v0.2.0 before trusting it.

v0.2.0 contract: verdicts are `PASS | PASS-WITHOUT-EXHAUSTIVE | FAIL`; a skipped gate can never
contribute to PASS; missing or unknown gate status fails closed; exit codes are 0 (PASS),
3 (PASS-WITHOUT-EXHAUSTIVE), 1 (FAIL), 2 (setup error). `fv-run` detects the Java version
itself and records `skipped-no-java21` — no flag discipline required.

### Fixed — vacuous starter invariants

Decision-duplication pass over all starters; the following v0.1.0 invariants could never fail
and were replaced with properties that can: `token_lifecycle.revokedNeverValid`
(`sessions >= 0`), `crud_api.errorsCarryNoPartialState` (`replayedEffects >= 0`),
`kv_store` shape-only bounds, `leader_election.atMostOneLeader` (single global leader variable
made two leaders unrepresentable), `lease_lock`, `file_publish`, `sync_session`, and
`backup_restore` (`publishedRecords >= 0`) bounds-only sets. New properties track grants,
sessions, cross-tenant access, escalations, and serve decisions as state.

### Added

- **Design authority**: `MASTER-SPEC.md` (claim graph, 14-stage pipeline, assurance levels
  FV-0…FV-5 with no "certified" level, method library, 36-claim security catalog),
  `SECURITY.md` (six-question threat method, adversary ladder A0–A6, fault schedule F1–F12,
  probe safety law), `RESEARCH.md` (evidence base with verify-before-citing list).
- **Security domain** (`references/domains/security.md`) and two attacker starters:
  `tenant_isolation.qnt` (credential-resolved tenant guard vs forged hints, CLM-ISO-001) and
  `privileged_boundary.qnt` (authority floors across privileged surfaces, CLM-AUTHZ-008).
- **`fv-mutate.js`** — property adequacy: named guard-weakening mutants must be killed;
  survivors cap claims at FV-1. Zero applicable mutants is a FAIL.
- **`fv-probe.js`** + `assets/probes/backend-security-probes.json` — claim-linked HTTP probes
  (anonymous surface, BOLA swap, mass-assignment, existence oracle) with the probe safety law.
- **`fv-qualify.js`** + `qualification-expectations.json` — self-qualification battery:
  verdict-honesty unit cases, model corpus, mutant corpus, and probe detection against the
  two-faced demo target (`examples/probe-demo/`, secure must PASS, insecure must FAIL).
- **Evidence formatVersion 2** — model SHA-256, git commit/dirtiness, seed, budgets, engine and
  Java versions, per-gate status. `fv-report` aggregates honestly and flags legacy records.
- `security` added to `supportedDomains`; config formatVersion 2.

### Notes

- Quint remains pinned at `@informalsystems/quint@0.33.1` and is attributed, never owned.
- fv-probe expectations are deny = 401/403/404 and allow = 2xx; targets with different
  conventions need probe-set adaptation (documented in the probe set header).

## 0.1.0 — initial harness

Five-gate Quint pipeline (parse → typecheck → simulate → test → verify), 9 starter models,
todo-api example, `/formalverification` + `/miraverif` commands.

