// token_lifecycle — credential issuance, use, revocation, expiry, rotation.
// Claims: CLM-AUTHZ-002/003 — a revoked, expired, rotated-away, or never-issued
// credential never grants, and revocation terminates live sessions.
//
// Grants and sessions are tracked per credential, so the invariants can
// actually fail: if `use` ever grants a bad credential, or `revoke` fails to
// end its sessions, the checker finds it. (v0.1.0 tracked only a counter with
// `sessions >= 0` — vacuous. Fixed in v0.2.0; see CHANGELOG.md.)
module token_lifecycle {
  var issued: Set[str]
  var revoked: Set[str]
  var expired: Set[str]
  var grantedEver: Set[str]
  var liveSessions: Set[str]
  var now: int

  pure val TOKENS = Set("t1", "t2", "t3")
  pure val EXPIRY = 10

  action init = all {
    issued' = Set(),
    revoked' = Set(),
    expired' = Set(),
    grantedEver' = Set(),
    liveSessions' = Set(),
    now' = 0,
  }

  action issue(t) = all {
    issued' = issued.union(Set(t)),
    revoked' = revoked,
    expired' = expired,
    grantedEver' = grantedEver,
    liveSessions' = liveSessions,
    now' = now,
  }

  // Revocation both blocks future grants AND terminates live sessions.
  action revoke(t) = all {
    issued' = issued,
    revoked' = revoked.union(Set(t)),
    expired' = expired,
    grantedEver' = grantedEver,
    liveSessions' = liveSessions.exclude(Set(t)),
    now' = now,
  }

  // Clock reaches EXPIRY: every issued credential expires, sessions end.
  action tick = all {
    issued' = issued,
    revoked' = revoked,
    expired' = if (now + 1 >= EXPIRY) issued else expired,
    grantedEver' = grantedEver,
    liveSessions' = if (now + 1 >= EXPIRY) Set() else liveSessions,
    now' = now + 1,
  }

  // Rotation: old credential revoked (sessions end), fresh one issued.
  action rotate(old, new) = all {
    issued' = issued.union(Set(new)),
    revoked' = revoked.union(Set(old)),
    expired' = expired,
    grantedEver' = grantedEver,
    liveSessions' = liveSessions.exclude(Set(old)),
    now' = now,
  }

  // The guard under test: grant only when issued, unrevoked, unexpired.
  action use(t) = {
    if (issued.contains(t) and not(revoked.contains(t)) and not(expired.contains(t))) all {
      issued' = issued,
      revoked' = revoked,
      expired' = expired,
      grantedEver' = grantedEver.union(Set(t)),
      liveSessions' = liveSessions.union(Set(t)),
      now' = now,
    } else all {
      issued' = issued,
      revoked' = revoked,
      expired' = expired,
      grantedEver' = grantedEver,
      liveSessions' = liveSessions,
      now' = now,
    }
  }

  // Adversary attempts share the same guard; if the guard is weakened
  // (mutation testing), these are the traces that expose it.
  action useAfterRevoke(t) = use(t)
  action useExpired(t) = use(t)
  action useUnknown(t) = use(t)

  action step = {
    nondet t = TOKENS.oneOf()
    nondet u = TOKENS.oneOf()
    any {
      issue(t),
      revoke(t),
      tick,
      rotate(t, u),
      use(t),
      useAfterRevoke(t),
      useExpired(t),
      useUnknown(t),
    }
  }

  // Real properties — each fails if its guard is wrong:
  // - no session is ever live for a revoked/expired/never-issued credential
  // - every grant traces to a credential that was valid when granted
  //   (enforced indirectly: grants only happen inside the guarded branch;
  //    the live-session properties are the checkable safety surface)
  val revokedHasNoSession = liveSessions.intersect(revoked).size() == 0
  val expiredHasNoSession = liveSessions.intersect(expired).size() == 0
  val unknownHasNoSession = liveSessions.exclude(issued).size() == 0
  val sessionsBoundToIssued = unknownHasNoSession
  val noBadGrant = revokedHasNoSession and expiredHasNoSession and unknownHasNoSession

  run revokedTokenGrantsNothing = {
    init.then(issue("t1")).then(use("t1")).then(revoke("t1")).then(useAfterRevoke("t1"))
      .expect(liveSessions == Set())
  }

  run unknownTokenGrantsNothing = {
    init.then(useUnknown("t2")).expect(liveSessions == Set())
  }

  run rotationInvalidatesOld = {
    init.then(issue("t1")).then(use("t1")).then(rotate("t1", "t2")).then(use("t1")).then(use("t2"))
      .expect(liveSessions == Set("t2"))
  }

  run expiryDenies = {
    init.then(issue("t1")).then(use("t1")).then(tick).then(tick).then(tick).then(tick).then(tick)
      .then(tick).then(tick).then(tick).then(tick).then(tick).then(useExpired("t1"))
      .expect(liveSessions == Set())
  }

  temporal grantsStayClean = always(noBadGrant)
}
