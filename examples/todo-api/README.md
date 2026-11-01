# Worked example: verifying a todo API

This example shows what a finished `/formalverification` run looks like end to end: scope note, models, evidence, and final verdict. The target is a small todo backend with token auth — simple enough to read in one sitting, real enough that the harness finds something.

## 1. Scope

- **Entry points:** `POST /todos` (create), `GET /todos` (list), `PATCH /todos/:id` (update), `DELETE /todos/:id` (delete), `POST /login` (issue token), all behind bearer auth except `/login`.
- **State:** `todos` table (id, owner, title, done), token registry (issued, revoked, expiry).
- **Trust boundaries:** anonymous → authenticated user (own todos only) → no admin surface in this slice.
- **Failure paths:** crash between write and response, duplicate delivery of create (client retry), token revocation with in-flight requests, expired token reuse.
- **Models used:** `todos_crud.qnt` (this directory, adapted from the `crud_api` starter) and the `token_lifecycle` starter for auth.

## 2. Models

`todos_crud.qnt` models create/list/update/delete with owner checks, validation failures, unauthorized attempts, and idempotency keys on create. The token lifecycle is covered by the starter `token_lifecycle.qnt` from the skill assets. Invariants: `ownerIsolation` (no user reads another's todos), `errorsCarryNoPartialState`, `revokedNeverValid`.

## 3. What the harness found

Simulation of the first draft found a real bug shape: a duplicate `POST /todos` with the same idempotency key created a second row because the handler checked the key after inserting. Counterexample trace included the seed and the two-step reproduction (`create(k1)` then `create(k1)` → two rows). Fix: check-then-insert inside the same transaction. Re-ran all gates: clean.

## 4. Evidence and verdict

`evidence/` holds two records, and the difference between them is the v0.2.0 honesty contract in action:

- `todos_crud.evidence.json` — **legacy (v0.1.0, formatVersion 1)**. It records `verify: "skipped by flag"` yet verdict `PASS` — the v0.1.0 verdict defect disclosed in `CHANGELOG.md`. It is retained unmodified as a defect artifact; `fv-report` labels it LEGACY. Do not trust it.
- `todos_crud.evidence.v2.json` — **current (v0.2.0, formatVersion 2)**, generated on this machine (Node 24, Quint 0.33.1, Java 17): parse/typecheck/simulate/test passed, `verify: skipped-no-java21`, verdict **PASS-WITHOUT-EXHAUSTIVE** — tested, not proven, with model SHA-256, seed, budgets, and git commit recorded.

Run it yourself:

```
node plugins/formal-verification/skills/formal-verification/scripts/fv-run.js \
  --model examples/todo-api/todos_crud.qnt --seed 1 \
  --invariants ownerIsolation --invariants errorsCarryNoPartialState
```

Exit code 3 means PASS-WITHOUT-EXHAUSTIVE on a machine without Java 21+; with Java 21+ the same command runs the exhaustive gate and can reach PASS.
