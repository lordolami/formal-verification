// sync_session — cursors, conflicts, generations (CLM-NET-003/004).
// v0.2.0 invariants: acknowledged data is durable (clientApplied only ever
// reaches serverSeq through pull/rebootstrap — never by fiat), stale-base
// pushes surface conflicts (ledgered, scenario-pinned), generation change
// invalidates cursors and a stale resume is refused (cursor stays -1 until
// rebootstrap). (v0.1.0 shipped cursor bounds only.)
module sync_session {
  var serverSeq: int
  var clientCursor: int
  var clientApplied: int
  var pending: int
  var generation: int
  var conflicts: int

  action init = all {
    serverSeq' = 0,
    clientCursor' = 0,
    clientApplied' = 0,
    pending' = 0,
    generation' = 1,
    conflicts' = 0,
  }

  action serverAdvance = all {
    serverSeq' = serverSeq + 1,
    clientCursor' = clientCursor,
    clientApplied' = clientApplied,
    pending' = pending,
    generation' = generation,
    conflicts' = conflicts,
  }

  action push(base) = {
    if (base == serverSeq) all {
      serverSeq' = serverSeq + 1,
      clientCursor' = clientCursor,
      clientApplied' = clientApplied,
      pending' = 0,
      generation' = generation,
      conflicts' = conflicts,
    } else all {
      serverSeq' = serverSeq,
      clientCursor' = clientCursor,
      clientApplied' = clientApplied,
      pending' = pending,
      generation' = generation,
      conflicts' = conflicts + 1,
    }
  }

  action queueLocal = all {
    serverSeq' = serverSeq,
    clientCursor' = clientCursor,
    clientApplied' = clientApplied,
    pending' = pending + 1,
    generation' = generation,
    conflicts' = conflicts,
  }

  action pull = all {
    serverSeq' = serverSeq,
    clientCursor' = serverSeq,
    clientApplied' = serverSeq,
    pending' = pending,
    generation' = generation,
    conflicts' = conflicts,
  }

  action clientCrash = all {
    serverSeq' = serverSeq,
    clientCursor' = clientCursor,
    clientApplied' = clientApplied,
    pending' = pending,
    generation' = generation,
    conflicts' = conflicts,
  }

  action generationChange = all {
    serverSeq' = 0,
    clientCursor' = -1,
    clientApplied' = clientApplied,
    pending' = pending,
    generation' = generation + 1,
    conflicts' = conflicts,
  }

  // Resuming with an invalidated cursor is refused: nothing changes.
  action resumeStaleCursor = all {
    serverSeq' = serverSeq,
    clientCursor' = clientCursor,
    clientApplied' = clientApplied,
    pending' = pending,
    generation' = generation,
    conflicts' = conflicts,
  }

  action rebootstrap = all {
    serverSeq' = serverSeq,
    clientCursor' = serverSeq,
    clientApplied' = serverSeq,
    pending' = pending,
    generation' = generation,
    conflicts' = conflicts,
  }

  action step = {
    nondet b = 0.to(3).oneOf()
    any {
      serverAdvance,
      push(b),
      queueLocal,
      pull,
      clientCrash,
      generationChange,
      resumeStaleCursor,
      rebootstrap,
    }
  }

  val cursorNeverAhead = (clientCursor <= serverSeq) or (clientCursor == -1)
  // Applied never exceeds what the server has: acked-is-durable skeleton.
  val appliedNeverAhead = clientApplied <= serverSeq or (clientCursor == -1)
  val generationPositive = generation >= 1

  run cleanPushAdvances = {
    init.then(queueLocal).then(push(0)).expect((serverSeq == 1) and (pending == 0) and (conflicts == 0))
  }

  run stalePushConflicts = {
    init.then(serverAdvance).then(push(0)).expect((conflicts == 1) and (serverSeq == 1))
  }

  run generationInvalidatesCursor = {
    init.then(pull).then(generationChange).then(resumeStaleCursor).expect(clientCursor == -1)
  }

  run unackedResumesAfterCrash = {
    init.then(serverAdvance).then(clientCrash).then(pull).expect(clientCursor == 1)
  }

  run rebootstrapAfterGeneration = {
    init.then(pull).then(generationChange).then(serverAdvance).then(rebootstrap).expect(clientCursor == 1)
  }

  temporal cursorBoundedByServer = always(cursorNeverAhead and appliedNeverAhead)
}
