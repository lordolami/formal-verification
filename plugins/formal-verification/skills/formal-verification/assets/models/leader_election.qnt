// leader_election — at most one leader per term (CLM-NET-001).
// v0.1.0 stored a single global `leader` variable, so two leaders were
// unrepresentable and the invariant could never fail. v0.2.0 models each
// node's belief and term. The election guard is the teeth: a node may win
// only when no node believes itself leader. Remove that guard in a mutated
// copy and two nodes elect themselves — the invariant dies (fv-mutate
// proves this starter is not decoration).
module leader_election {
  var believes: str -> str
  var term: str -> int

  pure val NODES = Set("n1", "n2", "n3")

  action init = all {
    believes' = Map(("n1", "none"), ("n2", "none"), ("n3", "none")),
    term' = Map(("n1", 0), ("n2", 0), ("n3", 0)),
  }

  action elect(n) = {
    if (NODES.forall(m => believes.get(m) != m)) all {
      believes' = believes.set(n, n),
      term' = term.set(n, term.get(n) + 1),
    } else all {
      believes' = believes,
      term' = term,
    }
  }

  action resign(n) = all {
    believes' = believes.set(n, "none"),
    term' = term,
  }

  action step = {
    nondet n = NODES.oneOf()
    any {
      elect(n),
      resign(n),
    }
  }

  val atMostOneLeaderPerTerm = NODES.filter(n => believes.get(n) == n).size() <= 1
  val epochsNonnegative = NODES.forall(n => term.get(n) >= 0)

  run electThenResign = {
    init.then(elect("n1")).then(resign("n1")).expect(believes.get("n1") == "none")
  }

  run termAdvances = {
    init.then(elect("n2")).then(resign("n2")).then(elect("n2")).expect(term.get("n2") == 2)
  }

  run secondElectionBlockedWhileLeaderServes = {
    init.then(elect("n1")).then(elect("n2")).expect(believes.get("n2") == "none")
  }

  temporal singleLeader = always(atMostOneLeaderPerTerm)
}
