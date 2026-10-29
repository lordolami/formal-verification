# Quint cheat sheet — verified against `@informalsystems/quint@0.33.1`

Every construct below was executed against the real CLI during harness development. If a construct is not shown here, test it in isolation before using it in a model.

## Module skeleton

```quint
module example {
  var balance: int
  var members: Set[str]
  var store: str -> int

  pure val LIMIT = 100

  action init = all {
    balance' = 0,
    members' = Set("a"),
    store' = Map(("a", 1)),
  }

  action deposit(amount) = all {
    balance' = balance + amount,
    members' = members,
    store' = store,
  }

  action step = {
    nondet amount = 1.to(10).oneOf()
    any {
      deposit(amount),
    }
  }

  val bounded = balance <= LIMIT
  run smoke = { init.then(deposit(5)).expect(balance == 5) }
  temporal neverOver = always(balance <= LIMIT)
}
```

## The rules that bite

These are the mistakes every newcomer makes, verified by hitting each one:

1. **Multi-assignment needs `all { ... }`.** An action body that updates two or more state variables must wrap them: `all { x' = ..., y' = ... }` with comma separators and an optional trailing comma. Plain newline-separated assignments without `all` fail to parse. Joining assignments with `and` fails typecheck with QNT200 — `and` is for temporal definitions, not actions. Single-assignment actions can use bare `{ x' = ... }`.
2. **Maps use tuple pairs.** `Map(("k", v), ("k2", v2))`. `Map("k", v)` fails to typecheck. Access with `m.get(k)`, update with `m.set(k, v)`, enumerate keys with `m.keys()`. There is no `.values()` — quantify over values via `m.keys().forall(k => ... m.get(k) ...)`.
3. **Nondeterminism is explicit.** `nondet name = Set(...).oneOf()` or `nondet n = 1.to(N).oneOf()`, declared inside the action before use. There is no implicit "pick anything".
4. **Choice uses `any { ... }`.** `any { opA, opB, opC }` offers nondeterministic alternatives. Each alternative is an action.
5. **Branches are actions.** `if (cond) <action> else <action>` — each branch must be a complete action (usually an `all { ... }` block). Quint `if` is not an expression returning values in action position.
6. **Definitions have kinds.** `action name(params) = ...` for transitions, `val name = ...` for state predicates and invariants, `pure val NAME = ...` for constants, `run name = { ...expect(...) }` for scenario tests, `temporal name = ...` for temporal properties. Calling a `val` where an `action` is expected (or vice versa) fails typecheck.

## CLI facts that matter

- `quint run` exits 1 on invariant violation, 0 when clean. Check the exit code AND the output marker (`[violation] Found an issue` vs `[ok] No violation found`) — a crashed runner can exit nonzero without a real violation, and the tail tells them apart.
- `run` takes `--invariants` repeatably: `--invariants a --invariants b`. A single comma-joined value is not split.
- `test` needs anchored matching per scenario: `quint test <model> --match "^NAME$"`. Unanchored patterns treat every definition (actions, vals, temporals, constants) as a test and fail spuriously. The harness script extracts `run` names and anchors them automatically.
- `quint test` with no `--match` may discover zero tests and pass vacuously depending on build. The harness refuses this: zero `run` blocks is a FAIL.
- `verify` needs Java 21+. Without it, record `verify: skipped-no-java21` and cap the verdict. `verify` requires at least one invariant or temporal property.
- `--main <module>` selects the module when a file holds several. `--seed` makes simulation reproducible — always record it. `--max-samples` and `--max-steps` bound simulation; `--max-steps` bounds verification depth.

## Modeling guidance

- Model the system's real state, not an abstraction of an abstraction. If the code has `committed` vs `staged`, the model has `committed` vs `staged`. If the code has `issued` vs `revoked`, so does the model.
- Always include the adversary operations in `step`: `crash`, `retry`/`duplicateDelivery`, `revoke`, `expire`, `partition`, `restart`. A step offering only the happy path proves the happy path works, which nobody doubted.
- Name invariants after the property: `revokedNeverValid`, `committedSurvivesCrash`, `effectsAtMostOnce`. Future readers (including you in six months) should understand the safety claim without reading the body.
- Keep models small and numerous rather than large and few. One model per critical behavior. A 500-line model of everything is uncheckable; five 80-line models are verifiable.

## Attribution

Quint is a separate project by its own authors: https://github.com/quint-co/quint. This harness drives its CLI and records results; it does not reimplement, fork, or own Quint.
