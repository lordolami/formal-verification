module backup_restore {
  var liveGen: int
  var liveRecords: int
  var stagedValid: bool
  var publishedGen: int
  var publishedRecords: int
  var servingGen: int

  action init = all {
    liveGen' = 1,
    liveRecords' = 10,
    stagedValid' = false,
    publishedGen' = 0,
    publishedRecords' = 0,
    servingGen' = 1,
  }

  action writeLive = all {
    liveGen' = liveGen,
    liveRecords' = liveRecords + 1,
    stagedValid' = stagedValid,
    publishedGen' = publishedGen,
    publishedRecords' = publishedRecords,
    servingGen' = servingGen,
  }

  action stageBackup = all {
    liveGen' = liveGen,
    liveRecords' = liveRecords,
    stagedValid' = true,
    publishedGen' = publishedGen,
    publishedRecords' = liveRecords,
    servingGen' = servingGen,
  }

  action corruptStage = all {
    liveGen' = liveGen,
    liveRecords' = liveRecords,
    stagedValid' = false,
    publishedGen' = publishedGen,
    publishedRecords' = 0,
    servingGen' = servingGen,
  }

  action publishBackup = {
    if (stagedValid) all {
      liveGen' = liveGen,
      liveRecords' = liveRecords,
      stagedValid' = false,
      publishedGen' = liveGen,
      publishedRecords' = publishedRecords,
      servingGen' = servingGen,
    } else all {
      liveGen' = liveGen,
      liveRecords' = liveRecords,
      stagedValid' = false,
      publishedGen' = publishedGen,
      publishedRecords' = publishedRecords,
      servingGen' = servingGen,
    }
  }

  action crashBeforePublish = all {
    liveGen' = liveGen,
    liveRecords' = liveRecords,
    stagedValid' = false,
    publishedGen' = publishedGen,
    publishedRecords' = publishedRecords,
    servingGen' = liveGen,
  }

  action restoreToNew = {
    if (publishedGen > 0) all {
      liveGen' = publishedGen + 100,
      liveRecords' = publishedRecords,
      stagedValid' = false,
      publishedGen' = publishedGen,
      publishedRecords' = publishedRecords,
      servingGen' = publishedGen + 100,
    } else all {
      liveGen' = liveGen,
      liveRecords' = liveRecords,
      stagedValid' = stagedValid,
      publishedGen' = publishedGen,
      publishedRecords' = publishedRecords,
      servingGen' = servingGen,
    }
  }

  action step = any {
    writeLive,
    stageBackup,
    corruptStage,
    publishBackup,
    crashBeforePublish,
    restoreToNew,
  }

  val servingIsLive = servingGen == liveGen
  val publishedSane = (publishedGen == 0) or (publishedRecords >= 0)

  run backupThenRestoreNewGen = {
    init.then(writeLive).then(stageBackup).then(publishBackup).then(restoreToNew).expect((servingGen == 101) and (liveRecords == 11))
  }

  run corruptStageNeverPublishes = {
    init.then(stageBackup).then(corruptStage).then(publishBackup).then(restoreToNew).expect(servingGen == 1)
  }

  run crashBeforePublishKeepsLive = {
    init.then(stageBackup).then(crashBeforePublish).expect((servingGen == 1) and (liveRecords == 10))
  }

  temporal servingTracksLive = always(servingGen == liveGen)
}
