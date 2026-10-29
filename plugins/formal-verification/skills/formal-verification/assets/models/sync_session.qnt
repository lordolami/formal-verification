module sync_session {
  var serverSeq: int
  var clientCursor: int
  var clientApplied: int
  var pending: int
  var generation: int
  var conflictSeen: bool

  action init = all {
    serverSeq' = 0,
    clientCursor' = 0,
    clientApplied' = 0,
    pending' = 0,
    generation' = 1,
    conflictSeen' = false,
  }

  action serverAdvance = all {
    serverSeq' = serverSeq + 1,
    clientCursor' = clientCursor,
    clientApplied' = clientApplied,
    pending' = pending,
    generation' = generation,
    conflictSeen' = conflictSeen,
  }

  action push(base) = {
    if (base == serverSeq) all {
      serverSeq' = serverSeq + 1,
      clientCursor' = clientCursor,
      clientApplied' = clientApplied,
      pending' = 0,
      generation' = generation,
      conflictSeen' = conflictSeen,
    } else all {
      serverSeq' = serverSeq,
      clientCursor' = clientCursor,
      clientApplied' = clientApplied,
      pending' = pending,
      generation' = generation,
      conflictSeen' = true,
    }
  }

  action queueLocal = all {
    serverSeq' = serverSeq,
    clientCursor' = clientCursor,
    clientApplied' = clientApplied,
    pending' = pending + 1,
    generation' = generation,
    conflictSeen' = conflictSeen,
  }

  action pull = all {
    serverSeq' = serverSeq,
    clientCursor' = serverSeq,
    clientApplied' = serverSeq,
    pending' = pending,
    generation' = generation,
    conflictSeen' = conflictSeen,
  }

  action generationChange = all {
    serverSeq' = 0,
    clientCursor' = -1,
    clientApplied' = clientApplied,
    pending' = pending,
    generation' = generation + 1,
    conflictSeen' = conflictSeen,
  }

  action rebootstrap = all {
    serverSeq' = serverSeq,
    clientCursor' = serverSeq,
    clientApplied' = serverSeq,
    pending' = pending,
    generation' = generation,
    conflictSeen' = conflictSeen,
  }

  action step = {
    nondet b = 0.to(3).oneOf()
    any {
      serverAdvance,
      push(b),
      queueLocal,
      pull,
      generationChange,
      rebootstrap,
    }
  }

  val cursorNeverAhead = (clientCursor <= serverSeq) or (clientCursor == -1)
  val generationPositive = generation >= 1

  run cleanPushAdvances = {
    init.then(queueLocal).then(push(0)).expect((serverSeq == 1) and (pending == 0) and (conflictSeen == false))
  }

  run stalePushConflicts = {
    init.then(serverAdvance).then(push(0)).expect((conflictSeen == true) and (serverSeq == 1))
  }

  run generationInvalidatesCursor = {
    init.then(pull).then(generationChange).expect(clientCursor == -1)
  }

  temporal cursorBoundedByServer = always((clientCursor <= serverSeq) or (clientCursor == -1))
}
