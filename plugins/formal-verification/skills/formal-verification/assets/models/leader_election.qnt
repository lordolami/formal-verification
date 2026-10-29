module leader_election {
  var leader: str
  var epoch: int

  pure val NODES = Set("n1", "n2", "n3")

  action init = all {
    leader' = "none",
    epoch' = 0,
  }

  action elect(n) = all {
    leader' = n,
    epoch' = epoch + 1,
  }

  action resign = all {
    leader' = "none",
    epoch' = epoch + 1,
  }

  action step = {
    nondet n = NODES.oneOf()
    any {
      elect(n),
      resign,
    }
  }

  val atMostOneLeader = (leader == "none") or (NODES.contains(leader))
  val epochMonotonic = epoch >= 0

  run electThenResign = {
    init.then(elect("n1")).then(resign).expect(leader == "none")
  }

  run epochAdvances = {
    init.then(elect("n2")).then(resign).expect(epoch == 2)
  }

  temporal leaderStaysValid = always((leader == "none") or (NODES.contains(leader)))
}
