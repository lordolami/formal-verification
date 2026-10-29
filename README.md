# formal-verification

**Exhaustive backend verification, invoked with one command. When it says your system is correct, it shows the evidence.**

`formal-verification` is an installable verification-harness skill. You point it at your backend, say `/formalverification` (or `/miraverif`), and it builds precise executable models of what your system does, hammers them with simulation and exhaustive checking, ties each behavior back to your real code, and reports a verdict backed by machine-checkable evidence.

It verifies everything except frontend UI: HTTP APIs and business logic, auth/session/token flows, database schemas/transactions/isolation/migrations/recovery, replication and sync, distributed coordination, queues and background jobs, retries, caches, files, backups and restore, wire protocols.

The engine underneath is [Quint](https://github.com/quint-co/quint) — a modern specification language for distributed systems — bundled automatically. Users never touch it directly.

## Install

**Prerequisites:** Node.js 20+ for the harness. Java 21+ for the exhaustive `verify` gate (simulation and tests work without it; the report says exactly what was proven vs tested).

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

1. **Scope** — map entry points, state, trust boundaries, failure paths.
2. **Model** — write one Quint model per critical behavior (starting from 9 verified starters).
3. **Execute** — parse → typecheck → simulate → test → exhaustively verify each model.
4. **Map** — tie every model action to your real code; generate conformance checks from model traces and run them.
5. **Report** — evidence JSON per model plus an aggregate verdict.

## What a verdict means

- `PASS` — every gate passed including exhaustive verification, within stated bounds. This is the only verdict behind "fully correct".
- `PASS-WITHOUT-EXHAUSTIVE` — everything passed except the exhaustive step (no Java 21). Tested, not proven. The report says so plainly.
- `FAIL` — a gate failed or was vacuous, with traces and reproduction commands.

A vacuous pass is treated as failure: zero tests, zero invariants, or skipped verification is reported, never hidden. Counterexamples ship with the trace, the seed, and the fix.

## Example

`examples/todo-api/` walks a complete verification of a small todo backend: scope note, two models (CRUD API + token lifecycle), evidence records, and the final report. Start there to see what a finished run looks like.

## Starter models

| Model | Covers |
|---|---|
| `kv_store.qnt` | committed vs staged state, crash recovery |
| `leader_election.qnt` | single leader, epoch monotonicity |
| `idempotent_job.qnt` | at-most-once effects, duplicate delivery |
| `token_lifecycle.qnt` | issue/use/revoke, revocation enforcement |
| `crud_api.qnt` | validation, auth, idempotency keys |
| `lease_lock.qnt` | mutual exclusion, fencing tokens |
| `sync_session.qnt` | cursors, conflicts, generation changes |
| `backup_restore.qnt` | staged publish, crash boundaries, new generation |
| `file_publish.qnt` | staging, protection, deletion |

Every model was executed against the real Quint CLI: typecheck clean, all scenario tests passing, simulation with invariants clean.

## Attribution

Specifications are executed with [Quint](https://github.com/quint-co/quint) by its own authors. This harness drives the Quint CLI (`@informalsystems/quint@0.33.1`, pinned) and records results; it does not reimplement, fork, or own Quint.

## License

MIT. See LICENSE.
