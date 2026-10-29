# formal-verification pipeline — the five gates

Work every model through all five gates in order. Stop at the first failure, fix the model or the implementation, then re-run from gate 1. Never skip a gate, never reorder them, never weaken a property to get through.

## Gate 1 — parse

Command: `quint parse <model>`

Must exit 0. A syntax error means the model is not even a candidate specification. Fix the syntax; do not proceed. Common causes: missing `all { ... }` around multi-assignment action bodies, commas instead of newlines as separators in the wrong place, map literals without tuple pairs. The verified-correct forms are in `quint-cheatsheet.md`.

## Gate 2 — typecheck

Command: `quint typecheck <model>`

Must exit 0. A type error means the domain model is incoherent: a variable is used at two types, a map key type drifts, a set element type is inconsistent, an action tries to return a value. Fix the types; do not proceed. If the real system genuinely has two shapes for one field (string-or-number IDs, nullable-vs-missing), model that explicitly as a union (`{tag, value}` style) rather than letting the checker complain forever — and record the coercion rules.

## Gate 3 — simulate

Command: `quint run <model> --max-samples N --max-steps M [--seed S] --invariants <each invariant>`

Repeat `--invariants` once per invariant name. The command exits 1 on violation and prints a counterexample trace; it prints `[ok] No violation found` and exits 0 when clean. Both the exit code and the marker matter — check both, because a crashed runner can exit nonzero without finding a real violation, and you must be able to tell the difference from the output tail.

Budgets default from `scripts/fv.config.json`: 200 samples, 25 steps, 300s timeout. Guidance:

- Small critical models (token checks, idempotency, single-resource lifecycles): raise to 1000+ samples and 50+ steps. They are cheap and the state space is where your worst bugs hide.
- Large models (multi-node, multi-tenant, long histories): keep the defaults but run multiple seeds. Different seeds explore different interleavings; one seed is one walk through the forest.
- Never lower budgets without recording why. "It was slow" is a performance finding about the model, not a reason to look at less of it.

Record the seed of every run. A counterexample without a seed is a story, not evidence.

## Gate 4 — test

Every `run NAME = { ... }` block in the model is a scenario test. Execute each by anchored name:

```
quint test <model> --match "^NAME$"
```

Why anchored: an unanchored `--match` treats every definition in the file (actions, invariants, temporals, constants) as a test candidate, which fails spuriously on non-test definitions. That failure is runner misuse, not a model finding. The harness script (`fv-run.js`) extracts `run` names from the model source and executes each anchored automatically — prefer the script over hand-rolled commands.

Rules:

- Zero `run` blocks in the model is a FAIL. The harness refuses a vacuous pass: a model with nothing to execute proves nothing.
- A run reporting `0 passing`, discovering nothing, or exiting nonzero with `error: Tests failed` is a FAIL with a trace. Include the trace.
- Every model carries at least two `run` cases and at least one **negative control**: a scenario asserting an impossible or forbidden state, executed in isolation, which must FAIL. The negative control proves the test setup can detect violations at all. A suite in which nothing can fail is decoration — treat it as a FAIL and add the control.
- Fuzz-flavored `run` blocks (randomized operations with `expect` on the outcome) are encouraged for stateful behavior, but they supplement anchored scenario tests, never replace them.

## Gate 5 — verify (exhaustive)

Command: `quint verify <model> --invariant A,B --max-steps N [--temporal T,...]`

Runs the Apalache symbolic backend: instead of sampling traces, it reasons over all executions up to the step bound. This is the gate that turns "tested" into "proven (within bounds)". It needs Java 21 or newer on PATH.

Rules:

- At least one invariant or temporal property is required. Property-less verify is refused by the harness — an unbounded "check everything" invocation proves nothing and reports nothing.
- If no Java 21+ runtime is available, record `verify: skipped-no-java21` in the evidence. The aggregate verdict caps at `PASS-WITHOUT-EXHAUSTIVE`. State this plainly in the report: correctness is tested, not proven. Never let "fully correct" appear in a report whose verify gate was skipped.
- A verify counterexample outranks every other artifact: it is a proof that the property fails within the bound. Include the full trace, fix the model or the implementation, re-run all five gates.
- Bounds are part of the verdict. `--max-steps 10` proves the property for executions up to 10 steps — say so. Do not let "verified" imply "verified for all possible executions" unless the bound covers the diameter of the state space, and if you claim that, show why.

## Verdicts

- `PASS` — every enabled gate passed, verify included, within the recorded bounds. This is the only verdict that supports "fully correct".
- `PASS-WITHOUT-EXHAUSTIVE` — parse, typecheck, simulate, and test passed; verify was skipped (no Java 21). Correctness is tested, not proven. Say so.
- `FAIL` — any gate failed, or any gate was vacuous (zero tests, zero invariants, skipped simulation, property-less verify). Includes traces and exact reproduction commands.

## Evidence

`scripts/fv-run.js --model <path.qnt> [--main <module>] [--invariants a ...] [--temporal t ...] [--max-samples N] [--max-steps N] [--seed S] [--simulate|--skip-simulate] [--test|--skip-test] [--verify|--skip-verify] [--repo <dir>] [--skill <dir>] [--out <evidence.json>]`

Writes one evidence JSON per model: model path, main module, started/finished timestamps, Quint expected vs actual version, setup errors, per-gate ok/fail with output tails, and the verdict. Exit code 0 if and only if every enabled gate passes.

`scripts/fv-report.js --evidence a.json [--evidence b.json ...] [--format text|json]`

Aggregates many evidence files into one verdict: counts, per-model gate status, overall PASS/FAIL. This is the report's backbone — paste its output, then add the human analysis (scope, mappings, counterexamples, bounds, gaps) around it.
