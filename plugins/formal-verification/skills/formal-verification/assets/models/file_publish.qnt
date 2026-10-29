module file_publish {
  var staged: Set[str]
  var finalized: Set[str]
  var servedOk: int
  var servedDenied: int
  var protected: Set[str]

  pure val FILES = Set("f1", "f2")

  action init = all {
    staged' = Set(),
    finalized' = Set(),
    servedOk' = 0,
    servedDenied' = 0,
    protected' = Set("f1"),
  }

  action stage(f) = all {
    staged' = staged.union(Set(f)),
    finalized' = finalized,
    servedOk' = servedOk,
    servedDenied' = servedDenied,
    protected' = protected,
  }

  action finalize(f) = {
    if (staged.contains(f)) all {
      staged' = staged,
      finalized' = finalized.union(Set(f)),
      servedOk' = servedOk,
      servedDenied' = servedDenied,
      protected' = protected,
    } else all {
      staged' = staged,
      finalized' = finalized,
      servedOk' = servedOk,
      servedDenied' = servedDenied,
      protected' = protected,
    }
  }

  action serve(f, authed) = {
    if (finalized.contains(f) and ((not(protected.contains(f))) or (authed))) all {
      staged' = staged,
      finalized' = finalized,
      servedOk' = servedOk + 1,
      servedDenied' = servedDenied,
      protected' = protected,
    } else all {
      staged' = staged,
      finalized' = finalized,
      servedOk' = servedOk,
      servedDenied' = servedDenied + 1,
      protected' = protected,
    }
  }

  action deleteFile(f) = all {
    staged' = staged,
    finalized' = finalized.exclude(Set(f)),
    servedOk' = servedOk,
    servedDenied' = servedDenied,
    protected' = protected,
  }

  action step = {
    nondet f = FILES.oneOf()
    nondet a = Set(true, false).oneOf()
    any {
      stage(f),
      finalize(f),
      serve(f, a),
      deleteFile(f),
    }
  }

  val stagedBounded = staged.size() <= 2
  val finalizedBounded = finalized.size() <= 2

  run stageFinalizeServePublic = {
    init.then(stage("f2")).then(finalize("f2")).then(serve("f2", false)).expect(servedOk == 1)
  }

  run unfinalizedNeverServed = {
    init.then(stage("f2")).then(serve("f2", false)).expect((servedOk == 0) and (servedDenied == 1))
  }

  run protectedDeniedAnon = {
    init.then(stage("f1")).then(finalize("f1")).then(serve("f1", false)).expect((servedOk == 0) and (servedDenied == 1))
  }

  run protectedServedAuthed = {
    init.then(stage("f1")).then(finalize("f1")).then(serve("f1", true)).expect(servedOk == 1)
  }

  run deletedNotServed = {
    init.then(stage("f2")).then(finalize("f2")).then(deleteFile("f2")).then(serve("f2", false)).expect((servedOk == 0) and (servedDenied == 1))
  }

  temporal setsStayBounded = always((staged.size() <= 2) and (finalized.size() <= 2))
}
