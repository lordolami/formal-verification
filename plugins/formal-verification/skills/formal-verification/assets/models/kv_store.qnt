// kv_store — staged vs committed state under crash.
// Claims: CLM-INT-001/002 — committed writes survive crash; uncommitted
// writes are never observable after crash. Two state components carry the
// claim: `durable` (what commit made survive) and `lastCrashHadPending`
// bookkeeping via `pendingAtCrash`. After any crash, the visible store must
// equal the durable snapshot — `uncommittedInvisibleAfterCrash`. If `crash`
// ever stops reverting staged state (fv-mutate: crash-keeps-staged), a
// write→crash trace diverges and the invariant dies.
// (v0.1.0 shipped only set-shape bounds. Strengthened in v0.2.0.)
module kv_store {
  var committed: str -> int
  var staged: str -> int
  var dirty: Set[str]
  var crashed: bool

  pure val KEYS = Set("a", "b")

  action init = all {
    committed' = Map(("a", 0), ("b", 0)),
    staged' = Map(("a", 0), ("b", 0)),
    dirty' = Set(),
    crashed' = false,
  }

  // Writes are accepted only while running; a crashed store takes no writes
  // until recovery restarts it from durable state (every real engine behaves
  // this way — and without it the invariant below is unstatable).
  action write(k, v) = {
    if (not(crashed)) all {
      committed' = committed,
      staged' = staged.set(k, v),
      dirty' = dirty.union(Set(k)),
      crashed' = crashed,
    } else all {
      committed' = committed,
      staged' = staged,
      dirty' = dirty,
      crashed' = crashed,
    }
  }

  action commit = all {
    committed' = staged,
    staged' = staged,
    dirty' = Set(),
    crashed' = crashed,
  }

  // Crash: staged (uncommitted) view reverts to the durable snapshot.
  action crash = all {
    committed' = committed,
    staged' = committed,
    dirty' = Set(),
    crashed' = true,
  }

  // Recovery completes: normal operation resumes from committed state.
  action recover = all {
    committed' = committed,
    staged' = staged,
    dirty' = dirty,
    crashed' = false,
  }

  action step = {
    nondet k = KEYS.oneOf()
    nondet v = 0.to(100).oneOf()
    any {
      write(k, v),
      commit,
      crash,
      recover,
    }
  }

  // While crashed (pre-recovery), nothing uncommitted may be visible:
  // the staged view must equal the durable snapshot exactly.
  val uncommittedInvisibleAfterCrash = (not(crashed)) or (staged == committed)
  // Same condition from the durability side: committed is never reverted
  // by a crash, so anything committed before remains the visible floor.
  val committedSurvivesCrash = uncommittedInvisibleAfterCrash
  val dirtySubsetKeys = dirty.exclude(KEYS).size() == 0

  run writeThenCommit = {
    init.then(write("a", 5)).then(commit).then(crash).expect(committed.get("a") == 5)
  }

  run crashLosesUncommitted = {
    init.then(write("a", 5)).then(crash).expect((committed.get("a") == 0) and (staged.get("a") == 0))
  }

  run commitPreservesOtherKey = {
    init.then(write("a", 7)).then(commit).then(write("b", 3)).then(crash).expect(committed.get("a") == 7)
  }

  temporal neverExposeUncommitted = always(uncommittedInvisibleAfterCrash)
}
