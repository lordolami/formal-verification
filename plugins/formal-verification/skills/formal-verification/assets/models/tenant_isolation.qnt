// tenant_isolation — cross-tenant access guard (CLM-ISO-001, CLM-AUTHZ-004/009).
//
// Tenant isolation is a hyperproperty (two-trace claim). This single-trace
// starter models the enforcement choke: the tenant is resolved from the
// CREDENTIAL, never from a client-supplied hint, and every granted foreign
// access is ledgered. The ledger re-states the safety condition independently
// of the guard (`!=` vs the guard's `==`), so weakening the guard — exactly
// what fv-mutate does to a copy of this file — makes foreign grants land in
// `crossReads`/`crossWrites` and kills the invariant. The differential
// two-trace form is executed by fv-probe; a hyper claim may not be marked
// SUPPORTED on this model alone (MASTER-SPEC §2.3).
module tenant_isolation {
  var ownerOf: str -> str
  var readerTenant: str -> str
  var crossReads: int
  var crossWrites: int
  var ownReads: int

  pure val RECORDS = Set("r1", "r2")
  pure val USERS = Set("uA", "uB")

  action init = all {
    ownerOf' = Map(("r1", "A"), ("r2", "B")),
    readerTenant' = Map(("uA", "A"), ("uB", "B")),
    crossReads' = 0,
    crossWrites' = 0,
    ownReads' = 0,
  }

  // Guard: credential tenant must own the record. `hint` is never consulted.
  action readAs(user, rec, hint) = {
    if (readerTenant.get(user) == ownerOf.get(rec)) all {
      ownerOf' = ownerOf,
      readerTenant' = readerTenant,
      crossReads' = if (readerTenant.get(user) != ownerOf.get(rec)) crossReads + 1 else crossReads,
      crossWrites' = crossWrites,
      ownReads' = ownReads + 1,
    } else all {
      ownerOf' = ownerOf,
      readerTenant' = readerTenant,
      crossReads' = crossReads,
      crossWrites' = crossWrites,
      ownReads' = ownReads,
    }
  }

  action writeAs(user, rec, hint) = {
    if (readerTenant.get(user) == ownerOf.get(rec)) all {
      ownerOf' = ownerOf,
      readerTenant' = readerTenant,
      crossReads' = crossReads,
      crossWrites' = if (readerTenant.get(user) != ownerOf.get(rec)) crossWrites + 1 else crossWrites,
      ownReads' = ownReads,
    } else all {
      ownerOf' = ownerOf,
      readerTenant' = readerTenant,
      crossReads' = crossReads,
      crossWrites' = crossWrites,
      ownReads' = ownReads,
    }
  }

  // Adversary: foreign access attempts carrying a forged owner hint.
  action crossReadAttempt(user, rec) = readAs(user, rec, ownerOf.get(rec))
  action crossWriteAttempt(user, rec) = writeAs(user, rec, ownerOf.get(rec))

  action step = {
    nondet u = USERS.oneOf()
    nondet r = RECORDS.oneOf()
    nondet h = Set("A", "B").oneOf()
    any {
      readAs(u, r, h),
      writeAs(u, r, h),
      crossReadAttempt(u, r),
      crossWriteAttempt(u, r),
    }
  }

  val noCrossTenantRead = crossReads == 0
  val noCrossTenantWrite = crossWrites == 0
  val isolationHolds = noCrossTenantRead and noCrossTenantWrite

  run ownReadAllowed = {
    init.then(readAs("uA", "r1", "A")).expect(ownReads == 1)
  }

  run foreignReadDenied = {
    init.then(crossReadAttempt("uA", "r2")).expect((crossReads == 0) and (ownReads == 0))
  }

  run forgedHintDenied = {
    init.then(readAs("uB", "r1", "A")).expect(ownReads == 0)
  }

  run foreignWriteDenied = {
    init.then(crossWriteAttempt("uB", "r1")).expect(crossWrites == 0)
  }

  temporal isolationAlways = always(isolationHolds)
}
