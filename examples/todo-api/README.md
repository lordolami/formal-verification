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

Simulation of the first draft found a real bug shape: a duplicate `POST /todos` with the same idempotency key created a second row because the handler checked the key after inserting. Counterexample trace included the seed and the two-step reproduction (`create(k1)` then `create(k1)` → two rows). Fix: check-then-insert inside the same transaction. Re-ran all gates: PASS.

## 4. Evidence and verdict

`evidence/` holds the per-model evidence JSON from `fv-run.js`. The aggregate from `fv-report.js`:

- `todos_crud`: parse ok, typecheck ok, simulate ok (200 samples / 25 steps, seed 1), 3 scenario tests ok, verify skipped-no-java21.
- `token_lifecycle`: parse ok, typecheck ok, simulate ok, 2 scenario tests ok, verify skipped-no-java21.
- **Verdict: PASS-WITHOUT-EXHAUSTIVE** — tested, not proven. The report states the bounds and the one environment gap (no Java 21 on the run machine).

Run it yourself: copy the skill's `scripts/fv-run.js` flow against `todos_crud.qnt` with `--invariants ownerIsolation --invariants errorsCarryNoPartialState --skip-verify --seed 1`.
