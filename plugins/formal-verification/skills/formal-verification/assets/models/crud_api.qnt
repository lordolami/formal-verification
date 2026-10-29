module crud_api {
  var store: str -> int
  var lastCode: int
  var receipts: Set[str]
  var replayedEffects: int

  pure val KEYS = Set("a", "b")

  action init = all {
    store' = Map(("a", 0), ("b", 0)),
    lastCode' = 0,
    receipts' = Set(),
    replayedEffects' = 0,
  }

  action createValid(k, v, key) = {
    if (receipts.contains(key)) all {
      store' = store,
      lastCode' = 200,
      receipts' = receipts,
      replayedEffects' = replayedEffects,
    } else all {
      store' = store.set(k, v),
      lastCode' = 201,
      receipts' = receipts.union(Set(key)),
      replayedEffects' = replayedEffects + 1,
    }
  }

  action createInvalid = all {
    store' = store,
    lastCode' = 422,
    receipts' = receipts,
    replayedEffects' = replayedEffects,
  }

  action createUnauthorized = all {
    store' = store,
    lastCode' = 401,
    receipts' = receipts,
    replayedEffects' = replayedEffects,
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

  val errorsCarryNoPartialState = (lastCode == 422) or (lastCode == 401) or (replayedEffects >= 0)
  val receiptsBounded = receipts.size() <= 2

  run validThenReplayReturnsReceipt = {
    init.then(createValid("a", 5, "k1")).then(createValid("a", 9, "k1")).expect((lastCode == 200) and (store.get("a") == 5))
  }

  run invalidLeavesStore = {
    init.then(createValid("a", 5, "k1")).then(createInvalid).expect((lastCode == 422) and (store.get("a") == 5))
  }

  run unauthorizedLeavesStore = {
    init.then(createValid("b", 3, "k2")).then(createUnauthorized).expect((lastCode == 401) and (store.get("b") == 3))
  }

  temporal receiptsStayBounded = always(receipts.size() <= 2)
}
