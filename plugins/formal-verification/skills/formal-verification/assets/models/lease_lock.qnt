// lease_lock — mutual exclusion with fencing tokens (CLM-NET-001 sibling).
// A write is accepted only for the current holder presenting the current
// fencing token; `acceptedWrites` is the observable ledger. The scenario
// staleTokenWritesNothing plus the fencing guard give the property teeth:
// fv-mutate rewrites the guard to `if (true)` in a copy and requires the
// suite to kill that mutant. (v0.1.0 shipped holder-shape bounds only.)
module lease_lock {
  var holder: str
  var fencing: int
  var acceptedWrites: int

  pure val ACTORS = Set("w1", "w2")

  action init = all {
    holder' = "none",
    fencing' = 0,
    acceptedWrites' = 0,
  }

  action acquire(a) = {
    if (holder == "none") all {
      holder' = a,
      fencing' = fencing + 1,
      acceptedWrites' = acceptedWrites,
    } else all {
      holder' = holder,
      fencing' = fencing,
      acceptedWrites' = acceptedWrites,
    }
  }

  action release(a) = {
    if (holder == a) all {
      holder' = "none",
      fencing' = fencing,
      acceptedWrites' = acceptedWrites,
    } else all {
      holder' = holder,
      fencing' = fencing,
      acceptedWrites' = acceptedWrites,
    }
  }

  action expire = all {
    holder' = "none",
    fencing' = fencing,
    acceptedWrites' = acceptedWrites,
  }

  action write(a, token) = {
    if ((holder == a) and (token == fencing)) all {
      holder' = holder,
      fencing' = fencing,
      acceptedWrites' = acceptedWrites + 1,
    } else all {
      holder' = holder,
      fencing' = fencing,
      acceptedWrites' = acceptedWrites,
    }
  }

  action step = {
    nondet a = ACTORS.oneOf()
    nondet t = 0.to(5).oneOf()
    any {
      acquire(a),
      release(a),
      expire,
      write(a, t),
    }
  }

  val mutualExclusion = (holder == "none") or (ACTORS.contains(holder))
  val fencingNonnegative = fencing >= 0

  run acquireWriteRelease = {
    init.then(acquire("w1")).then(write("w1", 1)).then(release("w1")).expect((acceptedWrites == 1) and (holder == "none"))
  }

  run staleTokenWritesNothing = {
    init.then(acquire("w1")).then(expire).then(acquire("w2")).then(write("w1", 1)).expect(acceptedWrites == 0)
  }

  run currentHolderWrongTokenWritesNothing = {
    init.then(acquire("w1")).then(write("w1", 99)).expect(acceptedWrites == 0)
  }

  run doubleAcquireKeepsFirst = {
    init.then(acquire("w1")).then(acquire("w2")).expect(holder == "w1")
  }

  temporal holderAlwaysValid = always(mutualExclusion)
}
