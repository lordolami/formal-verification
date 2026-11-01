# formal-verification pipeline — five gates + three cross-cutting checks

Work every model through all five gates in order. Stop at the first failure, fix the model or the implementation, then re-run from gate 1. Never skip a gate, never reorder them, never weaken a property to get through. After the gates, run the cross-cutting checks (mutation adequacy, implementation probes, harness qualification). Full stage model: `MASTER-SPEC.md`.

## Gate 1 — parse

Command: `quint parse <model>`

Must exit 0. A syntax error means the model is not even a candidate specification. Fix the syntax; do not proceed. Common causes: missing `all { ... }` around multi-assignment action bodies, commas instead of newlines as separators in the wrong place, map literals without tuple pairs. The verified-correct forms are in `quint-cheatsheet.md`.

## Gate 2 — typecheck

Command: `quint typecheck <model>`

Must exit 0. A type error means the domain model is incoherent: a variable is used at two types, a map key type drifts, a set element type is inconsistent, an action tries to return a value. Fix the types; do not proceed. If the real system genuinely has two shapes for one field (string-or-number IDs, nullable-vs-missing), model that explicitly as a union (`{tag, value}` style) rather than letting the checker complain forever — and record the coercion rules.

## Gate 3 — simulate

Command: `quint run <model> --max-samples N --max-steps M [--seed S] --invariants <each invariant>`

Repeat `--invariants` once per invariant name. The command exits 1 on violation and prints a counterexample trace; it prints `[ok] No violation found` and exits 0 when clean. Both the exit code and the marker matter — check both, because a crashed runner can exit nonzero without finding a real violation, and you must be able to tell the difference from the output tail. `fv-run.js` requires the `[ok]` marker, not just exit 0.

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
- Every model carries at least two `run` cases and at least one **negative control**: a scenario asserting an impossible or forbidden outcome must FAIL when executed in isolation, proving the test setup can actually detect violations. A suite in which nothing can fail is decoration — treat it as a FAIL and add the control.
- Fuzz-flavored `run` blocks (randomized operations with `expect` on the outcome) are encouraged for stateful behavior, but they supplement anchored scenario tests, never replace them.

## Gate 5 — verify (exhaustive)

Command: `quint verify <model> --invariant A,B --max-steps N [--temporal T,...]`

Runs the Apalache symbolic backend: instead of sampling traces, it reasons over all executions up to the step bound. This is the gate that turns "tested" into "proven (within bounds)". It needs Java 21 or newer on PATH; `fv-run.js` detects the Java version itself and records `skipped-no-java21` when it is too old — no flag discipline required.

Rules:

- At least one invariant or temporal property is required. Property-less verify is refused by the harness — an unbounded "check everything" invocation proves nothing and reports nothing.
- If no Java 21+ runtime is available, record `verify: skipped-no-java21` in the evidence. The verdict caps at `PASS-WITHOUT-EXHAUSTIVE`. State this plainly in the report: correctness is tested, not proven. Never let "fully correct" appear in a report whose verify gate was skipped.
- A verify counterexample outranks every other artifact: it is a proof that the property fails within the bound. Include the full trace, fix the model or the implementation, re-run all five gates.
- Bounds are part of the verdict. `--max-steps 10` proves the property for executions up to 10 steps — say so. Do not let "verified" imply "verified for all possible executions" unless the bound covers the diameter of the state space, and if you claim that, show why.

## Cross-check A — mutation adequacy (`fv-mutate.js`)

The gates prove the suite passes; mutation proves the suite *can* fail. `fv-mutate` copies the model, applies one named guard-weakening mutation (drop the revocation check, ignore the fencing token, publish a corrupt stage…), and re-runs simulate+test. KILLED = detected; SURVIVED = the property does not guard that behavior. Survivors cap the linked claims at FV-1 and must be killed by strengthening the property or formally examined with a written rationale. Zero applicable mutations is a FAIL — adequacy was not demonstrated.

## Cross-check B — implementation probes (`fv-probe.js`)

Models prove properties of models; probes attack the system. Probe sets are claim-linked JSON (see `assets/probes/`): authorization matrix, BOLA swaps between two tenants, anonymous-surface checks, mass-assignment injection, existence-oracle comparison. Safety law (`SECURITY.md §5`): mutating probes require `--allow-mutating`, targets may be host-pinned, synthetic data only, tokens via environment variables (never printed). A probe PASS means "these executed probes behaved as claimed" — never "the system is secure".

## Cross-check C — harness qualification (`fv-qualify.js`)

The harness qualifies itself on seeded cases: verdict-honesty unit cases, the starter-model corpus, the mutant corpus, and probe detection against a two-faced demo target (secure mode must PASS, insecure mode must FAIL). Run after any harness or engine change; a harness that has not re-qualified may not raise claims.

## Verdicts

- `PASS` — every gate passed, verify included, within the recorded bounds. This is the only verdict that supports "proven within bounds".
- `PASS-WITHOUT-EXHAUSTIVE` — parse, typecheck, simulate, and test passed; verify was skipped (no Java 21) or another gate was explicitly skipped. Correctness is tested, not proven. Say so.
- `FAIL` — any gate failed, or any gate was vacuous (zero tests, zero invariants, skipped simulation, property-less verify, surviving unexamined mutants). Includes traces and exact reproduction commands.

Exit codes everywhere: 0 = PASS, 3 = PASS-WITHOUT-EXHAUSTIVE, 1 = FAIL, 2 = setup error. Pre-v0.2 evidence files are legacy: their verdicts predate this contract and must be re-run.

## Evidence

`scripts/fv-run.js --model <path.qnt> [--main <module>] [--invariants a ...] [--temporal t ...] [--max-samples N] [--max-steps N] [--seed S] [--simulate|--skip-simulate] [--test|--skip-test] [--verify|--skip-verify] [--repo <dir>] [--skill <dir>] [--out <evidence.json>]`

Writes one evidence JSON per model (formatVersion 2): model path + SHA-256, git commit/dirtiness, Quint expected vs actual version, Java detected, seed, budgets, per-gate `{gate, ok, status, detail}`, and the verdict.

`scripts/fv-mutate.js --model <path.qnt> [--invariants a ...] [--mutations <file.json>] [--repo <dir>] [--out <evidence.json>]` — adequacy evidence with per-mutant killed/survived/not-applicable.

`scripts/fv-probe.js --probes <set.json> --base <url> [--allow-mutating] [--pin-host <host>] [--repo <dir>] [--out <evidence.json>]` — probe evidence with per-probe outcomes and observed statuses.

`scripts/fv-report.js --evidence a.json [--evidence b.json ...] [--format text|json]` — aggregates evidence into one verdict (PASS only if every record is PASS). Paste its output, then add the human analysis (scope, mappings, counterexamples, bounds, residuals) around it.
## Cross-check D — claim graph (`fv-claims.js`)

Claims live in `.formal-verification/claims/claims.json`. Adopt catalog claims
(`fv-claims add --claim CLM-...`), bind scope/controls, link evidence per claim
(`link --method ...`), record sign-offs and time-boxed waivers. `status` computes
SUPPORTED/STALE/UNSUPPORTED/REFUTED and FV-0…FV-5 levels from evidence and input
hashes only — prose never raises a level. Intolerable + REFUTED exits 1 (release gate).

## Cross-check E — discovery & trace & fault (`fv-discover.js`, `fv-trace.js`, `fv-fault.js`)

Discovery inventories surfaces (OpenAPI/SQL/routes) and scaffolds the six threat
questions per surface — a worksheet, never an answer. Trace conformance replays
recorded (or live, with the probe safety law) step observations against
model-derived expectations. Fault work is plan-first: `fv-fault plan` validates
F-point coverage per claim; `fv-fault check` judges a filled execution record.
fv-fault never induces faults itself.

## Cross-check F — scan fusion & coverage (`fv-scan.js`, `fv-cover.js`)

Scanner output (SARIF/OSV/secrets) lands as HYPOTHESES mapped to candidate claims;
only executed evidence promotes a hypothesis to a FINDING. Coverage measures
exercised actions, checked invariants, and adversary presence per model, plus
claim-leg coverage per graph. Measurement is not a verdict; gaps are named for
humans and CI policy.

## Cross-check G — assurance export (`fv-assurance.js`)

Exports the claim graph as a GSN-structured case (JSON + Markdown) for reviewers
and assessors: top goal, per-claim goals with strategy/evidence/assumptions,
stale and refuted sections first, residuals as a named section. Exporting records
the FV-5 "case assembled" leg for FV-4 claims. Prohibited-words discipline is
enforced on generated text.

## Cross-check H — continuous staleness (`fv-stale.js`, `assets/ci/`)

Any model-hash or HEAD change marks dependent claims STALE; `fv-stale` reports
the delta (exit 1 when stale) for CI hooks and schedulers. CI templates in
`assets/ci/` encode budget discipline and the verify resource gate.
