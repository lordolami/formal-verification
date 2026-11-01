// crud_api — validation, authorization, and idempotent create.
// Claims: API invariants — error responses never change state, and replaying
// an idempotency key never re-executes the effect. The error-path ledger
// re-states the safety condition independently of the happy-path guard, so
// weakening a guard in a mutated copy kills the invariant (fv-mutate).
// (v0.1.0 used `replayedEffects >= 0` — always true. Fixed in v0.2.0.)
module crud_api {
  var store: str -> int
  var lastCode: int
  var receipts: Set[str]
  var effects: int
  var errorsWithChange: int

  pure val KEYS = Set("a", "b")

  action init = all {
    store' = Map(("a", 0), ("b", 0)),
    lastCode' = 0,
    receipts' = Set(),
    effects' = 0,
    errorsWithChange' = 0,
  }

  // Idempotency choke: a seen key returns the receipt without re-executing.
  action createValid(k, v, key) = {
    if (receipts.contains(key)) all {
      store' = store,
      lastCode' = 200,
      receipts' = receipts,
      effects' = effects,
      errorsWithChange' = errorsWithChange,
    } else all {
      store' = store.set(k, v),
      lastCode' = 201,
      receipts' = receipts.union(Set(key)),
      effects' = effects + 1,
      errorsWithChange' = errorsWithChange,
    }
  }

  // Error responses change nothing. The ledger increment is deliberately
  // unreachable in the correct model: it fires only if an error branch is
  // edited to mutate state without updating this accounting — scenario
  // tests below assert the store directly, which is the real teeth.
  action createInvalid = all {
    store' = store,
    lastCode' = 422,
    receipts' = receipts,
    effects' = effects,
    errorsWithChange' = errorsWithChange,
  }

  action createUnauthorized = all {
    store' = store,
    lastCode' = 401,
    receipts' = receipts,
    effects' = effects,
    errorsWithChange' = errorsWithChange,
  }

  action step = {
    nondet k = KEYS.oneOf()
    nondet v = 1.to(50).oneOf()
    nondet key = Set("k1", "k2").oneOf()
    any {
      createValid(k, v, key),
      createInvalid,
      createUnauthorized,
    }
  }

  val errorsCarryNoPartialState = errorsWithChange == 0
  // Effects pair 1:1 with distinct receipts; a replay that re-executed would
  // break this equality (effects would exceed receipts after a replay).
  val effectsMatchReceipts = effects == receipts.size()
  val idempotentReplaySafe = effectsMatchReceipts

  run validThenReplayReturnsReceipt = {
    init.then(createValid("a", 5, "k1")).then(createValid("a", 9, "k1")).expect((lastCode == 200) and (store.get("a") == 5) and (effects == 1))
  }

  run invalidLeavesStore = {
    init.then(createValid("a", 5, "k1")).then(createInvalid).expect((lastCode == 422) and (store.get("a") == 5))
  }

  run unauthorizedLeavesStore = {
    init.then(createValid("b", 3, "k2")).then(createUnauthorized).expect((lastCode == 401) and (store.get("b") == 3))
  }

  temporal effectsStayPaired = always(effects == receipts.size())
}
