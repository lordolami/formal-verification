module lease_lock {
  var holder: str
  var fencing: int
  var writes: int

  pure val ACTORS = Set("w1", "w2")

  action init = all {
    holder' = "none",
    fencing' = 0,
    writes' = 0,
  }

  action acquire(a) = {
    if (holder == "none") all {
      holder' = a,
      fencing' = fencing + 1,
      writes' = writes,
    } else all {
      holder' = holder,
      fencing' = fencing,
      writes' = writes,
    }
  }

  action release(a) = {
    if (holder == a) all {
      holder' = "none",
      fencing' = fencing,
      writes' = writes,
    } else all {
      holder' = holder,
      fencing' = fencing,
      writes' = writes,
    }
  }

  action expire = all {
    holder' = "none",
    fencing' = fencing,
    writes' = writes,
  }

  action write(a, token) = {
    if ((holder == a) and (token == fencing)) all {
      holder' = holder,
      fencing' = fencing,
      writes' = writes + 1,
    } else all {
      holder' = holder,
      fencing' = fencing,
      writes' = writes,
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

  val singleHolder = (holder == "none") or (ACTORS.contains(holder))
  val fencingMonotonic = fencing >= 0

  run acquireWriteRelease = {
    init.then(acquire("w1")).then(write("w1", 1)).then(release("w1")).expect((writes == 1) and (holder == "none"))
  }

  run staleTokenWritesNothing = {
    init.then(acquire("w1")).then(expire).then(acquire("w2")).then(write("w1", 1)).expect(writes == 0)
  }

  run doubleAcquireKeepsFirst = {
    init.then(acquire("w1")).then(acquire("w2")).expect(holder == "w1")
  }

  temporal holderAlwaysValid = always((holder == "none") or (ACTORS.contains(holder)))
}
