module kv_store {
  var committed: str -> int
  var staged: str -> int
  var dirty: Set[str]
  var lastRead: int

  pure val KEYS = Set("a", "b")

  action init = all {
    committed' = Map(("a", 0), ("b", 0)),
    staged' = Map(("a", 0), ("b", 0)),
    dirty' = Set(),
    lastRead' = 0,
  }

  action write(k, v) = all {
    committed' = committed,
    staged' = staged.set(k, v),
    dirty' = dirty.union(Set(k)),
    lastRead' = lastRead,
  }

  action commit = all {
    committed' = staged,
    staged' = staged,
    dirty' = Set(),
    lastRead' = lastRead,
  }

  action crash = all {
    committed' = committed,
    staged' = committed,
    dirty' = Set(),
    lastRead' = lastRead,
  }

  action read(k) = all {
    committed' = committed,
    staged' = staged,
    dirty' = dirty,
    lastRead' = if (dirty.contains(k)) staged.get(k) else committed.get(k),
  }

  action step = {
    nondet k = KEYS.oneOf()
    nondet v = 0.to(100).oneOf()
    any {
      write(k, v),
      commit,
      crash,
      read(k),
    }
  }

  val dirtyBounded = dirty.size() <= 2
  val stagedShaped = staged.keys() == KEYS
  val committedShaped = committed.keys() == KEYS

  run writeThenCommit = {
    init.then(write("a", 5)).then(commit).then(read("a")).expect(lastRead == 5)
  }

  run crashLosesUncommitted = {
    init.then(write("a", 5)).then(crash).then(read("a")).expect(lastRead == 0)
  }

  run commitPreservesOtherKey = {
    init.then(write("a", 7)).then(commit).then(write("b", 3)).then(read("a")).expect(lastRead == 7)
  }

  temporal dirtyAlwaysBounded = always(dirty.size() <= 2)
}
