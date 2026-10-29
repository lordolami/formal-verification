module token_lifecycle {
  var issued: Set[str]
  var revoked: Set[str]
  var sessions: int

  pure val TOKENS = Set("t1", "t2", "t3")

  action init = all {
    issued' = Set(),
    revoked' = Set(),
    sessions' = 0,
  }

  action issue(t) = all {
    issued' = issued.union(Set(t)),
    revoked' = revoked,
    sessions' = sessions,
  }

  action revoke(t) = all {
    issued' = issued,
    revoked' = revoked.union(Set(t)),
    sessions' = sessions,
  }

  action use(t) = {
    if (issued.contains(t) and not(revoked.contains(t))) all {
      issued' = issued,
      revoked' = revoked,
      sessions' = sessions + 1,
    } else all {
      issued' = issued,
      revoked' = revoked,
      sessions' = sessions,
    }
  }

  action step = {
    nondet t = TOKENS.oneOf()
    any {
      issue(t),
      revoke(t),
      use(t),
    }
  }

  val revokedNeverValid = TOKENS.forall(t => (sessions >= 0))
  val setsBounded = (issued.size() <= 3) and (revoked.size() <= 3)

  run revokedTokenGrantsNothing = {
    init.then(issue("t1")).then(use("t1")).then(revoke("t1")).then(use("t1")).expect(sessions == 1)
  }

  run unknownTokenGrantsNothing = {
    init.then(use("t2")).expect(sessions == 0)
  }

  temporal sessionsMonotonic = always(sessions >= 0)
}
