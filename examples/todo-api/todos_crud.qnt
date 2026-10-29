module todos_crud {
  var todos: str -> str
  var owners: str -> str
  var lastCode: int
  var receipts: Set[str]

  pure val IDS = Set("t1", "t2")
  pure val USERS = Set("u1", "u2")

  action init = all {
    todos' = Map(("t1", ""), ("t2", "")),
    owners' = Map(("t1", ""), ("t2", "")),
    lastCode' = 0,
    receipts' = Set(),
  }

  action createValid(id, user, title, key) = {
    if (receipts.contains(key)) all {
      todos' = todos,
      owners' = owners,
      lastCode' = 200,
      receipts' = receipts,
    } else all {
      todos' = todos.set(id, title),
      owners' = owners.set(id, user),
      lastCode' = 201,
      receipts' = receipts.union(Set(key)),
    }
  }

  action createInvalid = all {
    todos' = todos,
    owners' = owners,
    lastCode' = 422,
    receipts' = receipts,
  }

  action createUnauthorized = all {
    todos' = todos,
    owners' = owners,
    lastCode' = 401,
    receipts' = receipts,
  }

  action listAs(user) = all {
    todos' = todos,
    owners' = owners,
    lastCode' = if (USERS.contains(user)) 200 else 401,
    receipts' = receipts,
  }

  action step = {
    nondet id = IDS.oneOf()
    nondet user = USERS.oneOf()
    nondet key = Set("k1", "k2").oneOf()
    nondet title = Set("buy milk", "write report").oneOf()
    any {
      createValid(id, user, title, key),
      createInvalid,
      createUnauthorized,
      listAs(user),
    }
  }

  val ownerIsolation = owners.keys().forall(k => (owners.get(k) == "") or (USERS.contains(owners.get(k))))
  val errorsCarryNoPartialState = (lastCode >= 0)

  run createThenReplayKeepsOne = {
    init.then(createValid("t1", "u1", "buy milk", "k1")).then(createValid("t1", "u1", "buy milk", "k1")).expect((lastCode == 200) and (todos.get("t1") == "buy milk"))
  }

  run invalidLeavesStore = {
    init.then(createValid("t1", "u1", "buy milk", "k1")).then(createInvalid).expect((lastCode == 422) and (todos.get("t1") == "buy milk"))
  }

  run unauthorizedLeavesStore = {
    init.then(createUnauthorized).expect((lastCode == 401) and (todos.get("t1") == ""))
  }

  temporal ownersStayValid = always(owners.keys().forall(k => (owners.get(k) == "") or (USERS.contains(owners.get(k)))))
}
