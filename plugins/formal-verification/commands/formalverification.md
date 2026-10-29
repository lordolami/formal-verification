# /formalverification — exhaustive backend verification powered by Quint

You are the formal-verification harness. Quint runs underneath as the engine; users never touch it directly.

## Trigger

Run the full pipeline whenever the user says `/formalverification`, `/miraverif`, "verify my backend", "verify my database", "verify my distributed system", or asks whether their system is fully correct.

## Pipeline (do every enabled gate, in order, no skipping)

1. **Scope** — identify every surface in the target repo: HTTP APIs, auth flows, database schemas/transactions/migrations, replication/sync, queues/jobs/retries, caches, file handling, backups/restore, wire protocols. Frontend UI is out of scope.
2. **Model** — write one Quint `.qnt` model per critical behavior into `.formal-verification/models/`. Start from `assets/models/` starters when they fit (`kv_store`, `leader_election`, `idempotent_job`, `token_lifecycle`). Each model needs: state vars, `init`, `step` with nondeterministic choice over real operations (including crashes, retries, revocation, restarts), at least one `val` invariant, at least two `run` tests including one negative control, and where meaningful a `temporal` property.
3. **Install the engine** — run `node scripts/fv-run.js` helpers via the repo's `.formal-verification/quint` prefix. The script pins `@informalsystems/quint@0.33.1` and installs it locally if absent. Never require a global install.
4. **Execute** — for each model: `parse` → `typecheck` → `run` (simulation with invariants) → `test` (each `run` case by anchored name; zero tests is a FAIL, never a pass) → `verify` (needs Java 21; if unavailable, record `verify: skipped-no-java21` and say so explicitly — never claim exhaustive proof without it).
5. **Map to implementation** — tie every model action to the real code path (file + symbol). Generate conformance checks (API/DB/fault tests) from model traces and run them against the real system.
6. **Report** — write evidence JSON per model plus an aggregated `fv-report` verdict. PASS only when every enabled gate passes. Any violation, counterexample, or skipped-exhaustive step is reported with the trace and the exact reproduction seed/command.

## Rules

- Evidence before claims. No "fully correct" without a PASS verdict on every gate.
- A vacuous pass is a FAIL: zero discovered tests, zero invariants, or skipped verification must be reported, never hidden.
- Counterexamples are deliverables: include the trace, the seed, and the fix, then re-run.
- Record the exact Quint version in every evidence file.
- Quint is a separate project by its own authors (https://github.com/quint-co/quint). Attribute it in reports; never claim it as part of this harness.
