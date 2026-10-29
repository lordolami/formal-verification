module idempotent_job {
  var attempts: int
  var committed: bool
  var effects: int
  var resultSeen: bool

  action init = all {
    attempts' = 0,
    committed' = false,
    effects' = 0,
    resultSeen' = false,
  }

  action attempt = all {
    attempts' = attempts + 1,
    committed' = committed,
    effects' = effects,
    resultSeen' = resultSeen,
  }

  action succeed = {
    if (not(committed)) all {
      attempts' = attempts + 1,
      committed' = true,
      effects' = effects + 1,
      resultSeen' = true,
    } else all {
      attempts' = attempts,
      committed' = committed,
      effects' = effects,
      resultSeen' = true,
    }
  }

  action duplicateDelivery = all {
    attempts' = attempts,
    committed' = committed,
    effects' = effects,
    resultSeen' = committed,
  }

  action step = any {
    attempt,
    succeed,
    duplicateDelivery,
  }

  val effectsAtMostOnce = effects <= 1
  val noEffectWithoutCommit = (effects == 0) or (committed == true)

  run firstSuccessCommits = {
    init.then(attempt).then(succeed).expect(committed and (effects == 1))
  }

  run retryAfterSuccessIsDuplicate = {
    init.then(succeed).then(duplicateDelivery).expect((effects == 1) and resultSeen)
  }

  temporal effectBounded = always(effects <= 1)
}
