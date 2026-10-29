# Domain: databases

## What to extract from the code

Schemas, constraints (unique, foreign-key, check, not-null), transaction boundaries, isolation level, retry logic, migration steps and their ordering guarantees, backup/restore paths, and what "commit" actually means in each write path (fsync? replicated? acknowledged-but-buffered?).

## How to model it

State: `committed` vs `staged` (or dirty/pending — mirror the code's own vocabulary), constraint registries, schema version, migration progress markers. Actions: `write`, `commit`, `rollback`, `crash` (staged state reverts to committed), `constraintConflict` (write violating a constraint must fail without partial effect), `migrateStep` (each step leaves schema usable; no half-applied schema is ever live).

Starter model: `assets/models/kv_store.qnt` — extend with constraint sets, multi-key transactions, and migration phases for real systems.

## Invariants

- `committedSurvivesCrash` — everything committed before a crash is readable after it.
- `uncommittedInvisibleAfterCrash` — staged-but-uncommitted writes are gone after a crash, never half-present.
- `constraintsHoldAfterCommit` — every committed state satisfies every constraint.
- `migrationNeverHalfLive` — the live schema version is always one of the known-good versions, never a mixture.

## Negative controls (must FAIL in isolation)

- Dirty read after crash returns staged data.
- Committed write lost across crash.
- Constraint-violating write commits.
- Migration step leaves two live schema versions.

## Conformance checks to generate

Write → crash → read (committed present, staged gone); conflicting concurrent writes (exactly one wins or a defined merge, never silent loss); kill during each migration step (schema usable, resume works); disk-full during commit (clean failure, no torn state).
