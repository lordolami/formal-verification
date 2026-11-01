// privileged_boundary — authority classes stay disjoint (CLM-AUTHZ-008).
//
// Record credentials, app-admin, instance-operator, and raw-engine authority
// are distinct classes with per-surface floors. The grant decision is
// duplicated in the safety ledger (`grantedBelowFloor`): a grant is recorded
// as an escalation whenever the credential class is below the surface floor,
// independently of how the guard computed it. Lowering a floor or weakening
// the guard in a mutated copy therefore kills the invariant — which is how
// fv-mutate proves this model is not decoration.
module privileged_boundary {
  var escalations: int
  var confusedAccepted: int
  var grants: int

  pure val FLOOR_RECORD_API = 1
  pure val FLOOR_APP_SETTINGS = 2
  pure val FLOOR_INSTANCE_OPS = 3
  pure val FLOOR_SQL_GATEWAY = 4
  pure val FLOOR_REPLICATION = 4
  pure val OPERATOR = 3

  action init = all {
    escalations' = 0,
    confusedAccepted' = 0,
    grants' = 0,
  }

  action attempt(authority, floor) = {
    if (authority >= floor) all {
      escalations' = if (authority < floor) escalations + 1 else escalations,
      confusedAccepted' = confusedAccepted,
      grants' = grants + 1,
    } else all {
      escalations' = escalations,
      confusedAccepted' = confusedAccepted,
      grants' = grants,
    }
  }

  action attemptRecordApi(auth) = attempt(auth, FLOOR_RECORD_API)
  action attemptAppSettings(auth) = attempt(auth, FLOOR_APP_SETTINGS)
  action attemptInstanceOps(auth) = attempt(auth, FLOOR_INSTANCE_OPS)
  action attemptSqlGateway(auth) = attempt(auth, FLOOR_SQL_GATEWAY)
  action attemptReplication(auth) = attempt(auth, FLOOR_REPLICATION)

  // Confused-context attempt: low credential + operator context hint.
  // The hint is never consulted; authority comes from the credential alone.
  action confusedContextAttempt(auth, hint) = {
    if (auth >= FLOOR_INSTANCE_OPS) all {
      escalations' = if (auth < FLOOR_INSTANCE_OPS) escalations + 1 else escalations,
      confusedAccepted' = if (auth < FLOOR_INSTANCE_OPS) confusedAccepted + 1 else confusedAccepted,
      grants' = grants + 1,
    } else all {
      escalations' = escalations,
      confusedAccepted' = confusedAccepted,
      grants' = grants,
    }
  }

  action step = {
    nondet a = 1.to(4).oneOf()
    any {
      attemptRecordApi(a),
      attemptAppSettings(a),
      attemptInstanceOps(a),
      attemptSqlGateway(a),
      attemptReplication(a),
      confusedContextAttempt(a, OPERATOR),
    }
  }

  val noEscalation = escalations == 0
  val noConfusedAcceptance = confusedAccepted == 0
  val boundaryHolds = noEscalation and noConfusedAcceptance

  run recordCredDeniedSql = {
    init.then(attemptSqlGateway(1)).expect(grants == 0)
  }

  run appAdminDeniedInstanceOps = {
    init.then(attemptInstanceOps(2)).expect(grants == 0)
  }

  run recordCredDeniedReplication = {
    init.then(attemptReplication(1)).expect(grants == 0)
  }

  run confusedHintDenied = {
    init.then(confusedContextAttempt(1, 3)).expect(grants == 0)
  }

  run operatorAllowedInstanceOps = {
    init.then(attemptInstanceOps(3)).expect(grants == 1)
  }

  temporal boundaryAlways = always(boundaryHolds)
}
