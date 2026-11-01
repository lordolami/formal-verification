// file_publish — staged upload → finalize → protected serve → delete.
// Claims: CLM-PLAT-001/002 + CLM-ISO-005 — unfinalized bytes never served,
// protected objects and derivatives never served to unauthorized actors,
// deleted objects never resurrect. `servedOk` only increments on a legitimate
// serve; each scenario test pins a distinct violation shape, and fv-mutate
// (dropping the protected check) must be killed by protectedDeniedAnon.
// (v0.1.0 shipped set-size bounds. Fixed in v0.2.0.)
module file_publish {
  var staged: Set[str]
  var finalized: Set[str]
  var deleted: Set[str]
  var servedOk: int

  pure val FILES = Set("f1", "f2")

  action init = all {
    staged' = Set(),
    finalized' = Set(),
    deleted' = Set(),
    servedOk' = 0,
  }

  pure def isProtected(f) = f == "f1"

  action stage(f) = all {
    staged' = staged.union(Set(f)),
    finalized' = finalized.exclude(Set(f)),
    deleted' = deleted.exclude(Set(f)),
    servedOk' = servedOk,
  }

  action finalize(f) = all {
    staged' = staged,
    // A deleted (tombstoned) object cannot be re-finalized in place:
    // re-publication requires a fresh stage, which clears the tombstone.
    finalized' = if (staged.contains(f) and not(deleted.contains(f))) finalized.union(Set(f)) else finalized,
    deleted' = deleted,
    servedOk' = servedOk,
  }

  // Serve guard: finalized AND not deleted AND (public OR authenticated).
  action serve(f, authed) = {
    if (finalized.contains(f) and not(deleted.contains(f)) and ((not(isProtected(f))) or authed)) all {
      staged' = staged,
      finalized' = finalized,
      deleted' = deleted,
      servedOk' = servedOk + 1,
    } else all {
      staged' = staged,
      finalized' = finalized,
      deleted' = deleted,
      servedOk' = servedOk,
    }
  }

  // Derivative (thumbnail/preview) inherits the source's protection.
  action serveDerivative(f, authed) = serve(f, authed)

  action deleteFile(f) = all {
    staged' = staged,
    finalized' = finalized.exclude(Set(f)),
    deleted' = deleted.union(Set(f)),
    servedOk' = servedOk,
  }

  action step = {
    nondet f = FILES.oneOf()
    nondet a = Set(true, false).oneOf()
    any {
      stage(f),
      finalize(f),
      serve(f, a),
      serveDerivative(f, a),
      deleteFile(f),
    }
  }

  // Invariants: every finalized object was staged; deleted objects are
  // never in the finalized set (so no serve can resurrect them).
  val finalizeRequiresStage = finalized.exclude(staged).size() == 0
  val deletedNeverFinalized = finalized.intersect(deleted).size() == 0

  run stageFinalizeServePublic = {
    init.then(stage("f2")).then(finalize("f2")).then(serve("f2", false)).expect(servedOk == 1)
  }

  run unfinalizedNeverServed = {
    init.then(stage("f2")).then(serve("f2", false)).expect(servedOk == 0)
  }

  run protectedDeniedAnon = {
    init.then(stage("f1")).then(finalize("f1")).then(serve("f1", false)).expect(servedOk == 0)
  }

  run protectedDerivativeDeniedAnon = {
    init.then(stage("f1")).then(finalize("f1")).then(serveDerivative("f1", false)).expect(servedOk == 0)
  }

  run protectedServedAuthed = {
    init.then(stage("f1")).then(finalize("f1")).then(serve("f1", true)).expect(servedOk == 1)
  }

  run deletedNotServed = {
    init.then(stage("f2")).then(finalize("f2")).then(deleteFile("f2")).then(serve("f2", false)).expect(servedOk == 0)
  }

  temporal serveDiscipline = always(finalizeRequiresStage and deletedNeverFinalized)
}
