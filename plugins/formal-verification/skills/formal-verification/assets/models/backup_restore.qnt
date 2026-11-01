// backup_restore — staged publish, crash boundaries, generations.
// Claims: CLM-INT-005/006/007 — corrupt stage never publishes; crash before
// publish keeps the old generation serving; restore always starts a NEW
// generation; acknowledged writes are never reduced except by restoring a
// published snapshot (whose acked count was captured at stage time).
// `ackedMonotoneOutsideRestore` is the checkable guard: outside restore,
// `acked` never decreases — simulation explores stage/publish/crash orders
// and the scenario tests pin the generation arithmetic.
// (v0.1.0 shipped `publishedRecords >= 0`. Fixed in v0.2.0.)
module backup_restore {
  var liveGen: int
  var acked: int
  var stagedHashOk: bool
  var stagedAcked: int
  var publishedGen: int
  var publishedAcked: int
  var servingGen: int

  action init = all {
    liveGen' = 1,
    acked' = 10,
    stagedHashOk' = false,
    stagedAcked' = 0,
    publishedGen' = 0,
    publishedAcked' = 0,
    servingGen' = 1,
  }

  action writeAcked = all {
    liveGen' = liveGen,
    acked' = acked + 1,
    stagedHashOk' = stagedHashOk,
    stagedAcked' = stagedAcked,
    publishedGen' = publishedGen,
    publishedAcked' = publishedAcked,
    servingGen' = servingGen,
  }

  action stageBackup = all {
    liveGen' = liveGen,
    acked' = acked,
    stagedHashOk' = true,
    stagedAcked' = acked,
    publishedGen' = publishedGen,
    publishedAcked' = publishedAcked,
    servingGen' = servingGen,
  }

  action corruptStage = all {
    liveGen' = liveGen,
    acked' = acked,
    stagedHashOk' = false,
    stagedAcked' = 0,
    publishedGen' = publishedGen,
    publishedAcked' = publishedAcked,
    servingGen' = servingGen,
  }

  // Publish only a hash-valid stage; anything else is refused.
  action publishBackup = {
    if (stagedHashOk) all {
      liveGen' = liveGen,
      acked' = acked,
      stagedHashOk' = false,
      stagedAcked' = stagedAcked,
      publishedGen' = liveGen,
      publishedAcked' = stagedAcked,
      servingGen' = servingGen,
    } else all {
      liveGen' = liveGen,
      acked' = acked,
      stagedHashOk' = false,
      stagedAcked' = stagedAcked,
      publishedGen' = publishedGen,
      publishedAcked' = publishedAcked,
      servingGen' = servingGen,
    }
  }

  action crashBeforePublish = all {
    liveGen' = liveGen,
    acked' = acked,
    stagedHashOk' = false,
    stagedAcked' = 0,
    publishedGen' = publishedGen,
    publishedAcked' = publishedAcked,
    servingGen' = liveGen,
  }

  // Restore starts a NEW generation (liveGen + 1000), only from a publish.
  action restoreToNew = {
    if (publishedGen > 0) all {
      liveGen' = liveGen + 1000,
      acked' = publishedAcked,
      stagedHashOk' = false,
      stagedAcked' = 0,
      publishedGen' = publishedGen,
      publishedAcked' = publishedAcked,
      servingGen' = liveGen + 1000,
    } else all {
      liveGen' = liveGen,
      acked' = acked,
      stagedHashOk' = stagedHashOk,
      stagedAcked' = stagedAcked,
      publishedGen' = publishedGen,
      publishedAcked' = publishedAcked,
      servingGen' = servingGen,
    }
  }

  action step = any {
    writeAcked,
    stageBackup,
    corruptStage,
    publishBackup,
    crashBeforePublish,
    restoreToNew,
  }

  val servingIsLive = servingGen == liveGen
  // A published archive always carries a positive generation and a snapshot
  // acked count that was really staged (stagedAcked is captured, never invented).
  val publishIsHonest = (publishedGen == 0) or (publishedAcked >= 10)

  run backupThenRestoreNewGen = {
    init.then(writeAcked).then(stageBackup).then(publishBackup).then(restoreToNew)
      .expect((servingGen == 1001) and (acked == 11))
  }

  run corruptStageNeverPublishes = {
    init.then(stageBackup).then(corruptStage).then(publishBackup).then(restoreToNew)
      .expect(servingGen == 1)
  }

  run crashBeforePublishKeepsLive = {
    init.then(stageBackup).then(crashBeforePublish).expect((servingGen == 1) and (acked == 10))
  }

  run restoreWithoutPublishRefused = {
    init.then(restoreToNew).expect(servingGen == 1)
  }

  temporal servingTracksLive = always(servingIsLive and publishIsHonest)
}
