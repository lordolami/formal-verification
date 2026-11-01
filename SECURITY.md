# Security Architecture — MiraVerif

The security layer exists for one reason: formal models prove properties of *models*. Attackers
attack *systems*. MiraVerif closes that gap with (a) adversaries inside the models, (b) probes
against the real system derived from those same models, and (c) honest bounds on what neither
can see.

## 1. Threat-model method

Six questions, answered per system during Stage 3, recorded as graph data:

1. **Harm** — what outcome is intolerable? (cross-tenant disclosure, privilege escalation,
   acknowledged-write loss, silent double-effect, unrecoverable corruption, audit erasure)
2. **Adversary** — which actor class attempts it, with what knowledge/access/compromise? (A0–A6, §2)
3. **Surface** — which entry points reach the asset? (HTTP, realtime, SQL, batch, import,
   backup conveyance, native replication, hooks, CLI, support tooling)
4. **Choke** — which single control must hold? (application resolution pre-auth, rule evaluator,
   generation check, fencing token, manifest hash, idempotency guard)
5. **Tripwire** — what evidence proves the choke held? (claim + invariant + probe)
6. **Residuals** — what stays uncovered? (timing, covert channels, TCB compromise, spec error)

A surface with a harm and no choke is a finding at scoping time — before any model exists.

## 2. Adversary ladder (universal)

| Class | Actor | Knows / controls |
|---|---|---|
| A0 | Anonymous network actor | Public surface only; unlimited request crafting; no credentials |
| A1 | Authenticated low-privilege user | Own credentials; full protocol fluency; attempts BOLA, mass assignment, filter/expansion injection, realtime snooping |
| A2 | Tenant/application administrator | App-level config power; attempts cross-application and instance-operator escalation |
| A3 | Malicious tenant workload | Trusted extension surface (hooks/jobs) inside one tenant; attempts host/peer escape |
| A4 | Compromised component | One replica/queue/worker/broker speaks with valid component credentials; may equivocate, delay, duplicate, reorder |
| A5 | Malicious or compromised peer/replica | Replication peer attempts poisoned frames, generation confusion, stale-cursor resurrection |
| A6 | Supply-chain / operator insider | Build/artifact/update channel, backup media, support access; attempts provenance forgery, rollback injection |

Every adversarial model declares which classes it exercises. A model whose adversary is only A0
may not support a claim whose threat analysis names A2.

## 3. Fault model (universal schedule)

F1 kill-before-commit · F2 kill-after-commit-before-ack · F3 kill-after-ack-before-response ·
F4 duplicate delivery · F5 reorder/delay beyond protocol window · F6 partition (minority, majority,
asymmetric) · F7 clock offset/backward jump/lease-window skew · F8 disk-full at each staged-write
boundary · F9 torn/corrupted artifact at each persisted object · F10 dependency returns error ·
F11 dependency returns *successful lie* (accepted-but-unapplied) · F12 rollback to prior generation
against newer acknowledged state.

The fault schedule attaches to actions; any durability/recovery claim lists which F-points its
conformance run actually executed. "Crash tested" without the F-point is a slogan.

## 4. The claim catalog — 38 checkable security claims

Each claim ships as: natural statement · claim formula · model method · probe method · mutation ·
OWASP/CWE anchors. The catalog is versioned; new classes enter via this file + a starter model +
a corpus mutant.

### Authorization & identity

| ID | Claim | Model | Probe |
|---|---|---|---|
| CLM-AUTHZ-001 | Anonymous reaches only the declared public surface | Adversary A0 explores all actions; granted set ⊆ public | Credential-less crawl of route inventory incl. batch/realtime/SQL surfaces |
| CLM-AUTHZ-002 | Revoked credential grants nothing, any surface, after stated bound | `revoked ⇒ ¬grants`, all surfaces; propagation window as timed variant | Revoke then race-use on every surface/listener; measure window |
| CLM-AUTHZ-003 | Expired/rotated-old credential grants nothing | Expiry+rotation in adversary step | Backdated/expiry-edge token replay; old-after-rotate replay |
| CLM-AUTHZ-004 | No object reference yields another principal's object (BOLA) | Two principals, adversary swaps ids; visibility hyperproperty | ID-swap matrix over every id-bearing route incl. nested/related/expansion/filter |
| CLM-AUTHZ-005 | No function reachable below its privilege floor | Adversary A1 invokes A2/A6 functions | Route×actor matrix; admin functions with user creds on all surfaces |
| CLM-AUTHZ-006 | Mass-assignment cannot write protected properties | Attacker crafts unknown/privileged keys; state unchanged | Property fuzz: inject role/owner/tenant/balance fields in every create/update |
| CLM-AUTHZ-007 | Filter/sort/expansion/projection cannot widen visibility | Query grammar adversary; result ⊆ authorized view | Filter-injection + expansion abuse corpus; compare vs authorized baseline set |
| CLM-AUTHZ-008 | Privileged engines (SQL/PG/native) never reachable with record credentials | Authority classes disjoint in model | Record-token × privileged-surface matrix; error-shape check (no info leak) |
| CLM-AUTHZ-009 | Context (app/db/tenant) resolves before auth; client hints never select it | Adversary forges hints/headers/ids | Hint-confusion probes: mismatched app hint + valid token ⇒ deny + audit |
| CLM-AUTHZ-010 | Credential stuffing/brute-force bounded | Attempt counters + lockout in model | Throttled-rate measurement; lockout bypass attempts (case/encoding variants) |
| CLM-AUTHZ-011 | Session/token binding: no session without valid issuance chain; fixation fails | Issuance-chain invariant | Fixation + pre-auth session adoption attempts |
| CLM-AUTHZ-012 | Step-up/MFA state cannot be skipped or replayed | State machine with adversary skip actions | Direct-call of post-MFA endpoints with pre-MFA token; replay of used OTP |

### Isolation & information flow

| ID | Claim | Model | Probe |
|---|---|---|---|
| CLM-ISO-001 | Tenant isolation (hyper): A's observable behavior independent of B's secrets | Self-composition / differential model | Dual-tenant differential campaign: interleaved ops, compare A's outputs with/without B data variations |
| CLM-ISO-002 | Realtime subscriptions never emit unauthorized records | Subscription set ⊆ readable set invariant | Subscribe as A, mutate as B; capture stream; assert zero B-only events |
| CLM-ISO-003 | Search/vector/text indexes never return unauthorized hits | Index query ⊆ authorized read | Adversarial queries (empty filter, wildcard, embedding-only) vs authorized baseline |
| CLM-ISO-004 | Errors do not leak cross-tenant existence | Error-shape function constant across existent-foreign vs nonexistent | Existence-oracle probes: status/timing/body diff across the two cases |
| CLM-ISO-005 | Derivatives (thumbnails/exports/previews/caches) inherit source protection | Artifact provenance chain in model | Fetch derivative via every cache/CDN-ish path anon + foreign-tenant |
| CLM-ISO-006 | Shared-cache keys cannot collide across tenants | Key-construction model | Cache-poison probes with tenant-varying keys/headers |

### Integrity, durability, recovery

| ID | Claim | Model | Probe |
|---|---|---|---|
| CLM-INT-001 | Acknowledged writes survive F1–F12 per durability class | Committed-set monotonic under faults | Kill-point harness at each F-point; read-back audit |
| CLM-INT-002 | Uncommitted writes never become visible post-crash | Staged⊆committed discipline | Crash mid-transaction at each stage; visibility scan |
| CLM-INT-003 | Effects exactly-once under duplication/retry/crash-between-effect-and-ack | Guarded-effect invariant (idempotent_job++) | Duplicate/retry storms; effect ledger counting |
| CLM-INT-004 | Migration never leaves half-live schema; rollback defined | Schema-version state machine | Kill per migration step; schema coherence check; resume |
| CLM-INT-005 | Backup publishes only with valid manifest; corrupt archive refuses, naming entry | Stage→verify→publish model | Bit-flip one archive entry; restore must refuse with entry named |
| CLM-INT-006 | Restore starts new generation; old cursors/tokens/replicas fail explicitly | Generation transition model | Restore, then replay old cursor/token/frame ⇒ explicit rejection |
| CLM-INT-007 | Rollback never discards acknowledged writes | Acked-set guard | Attempt rollback across ack boundary ⇒ loud failure, data intact |
| CLM-INT-008 | Constraints hold in every committed state | Constraint invariants under adversary writes | Constraint-violating write fuzz incl. concurrent racers |

### Protocol, replication, distribution

| ID | Claim | Model | Probe |
|---|---|---|---|
| CLM-NET-001 | Single leader/holder per epoch; fencing rejects stale holders | Epoch+fence model with partition adversary | Split-brain drill: stale leader writes rejected post-heal |
| CLM-NET-002 | Committed entries survive minority loss; no split-brain commit | Quorum model | Partition-commit-heal; conflict must surface, never silently merge |
| CLM-NET-003 | Acks mean durable local apply; unacked resumes without gaps/dupes | Cursor/ack model + client crash | Kill-between-pull-and-ack; resume continuity audit |
| CLM-NET-004 | Generation change invalidates all old cursors/frames | Generation model | Old-cursor resurrection attempts post-rotation |
| CLM-NET-005 | Malformed/poison frames rejected without state change or crash-loop | Frame adversary model | Protocol fuzz: truncated/replayed/reordered frames |
| CLM-NET-006 | Privileged replication only from authenticated peers; record clients excluded | Peer-auth model | Unauthenticated + record-cred bootstrap attempts ⇒ deny |

### Platform, files, supply chain

| ID | Claim | Model | Probe |
|---|---|---|---|
| CLM-PLAT-001 | Unfinalized/failed-hash uploads never served | Stage→verify→finalize model | Serve attempts at every upload stage; hash-flip mid-upload |
| CLM-PLAT-002 | Deletion is durable across caches/derivatives; no resurrection | Tombstone model | Delete then fetch via each layer/derivative |
| CLM-PLAT-003 | Jobs: expired leases redrive; poison dead-letters; no silent vanish | Lease/DLQ model | Lease-expiry race; poison flood; queue accounting audit |
| CLM-PLAT-004 | Resource bounds enforced (payload, page, query cost, per-tenant quota) | Budget counters in model | Exhaustion probes: oversize, deep pagination, cost-amplification queries |
| CLM-PLAT-005 | Secrets never persist/log/echo outside secret store; redaction holds | Secret-flow model (informal → manual mapping + probes) | Log/echo/error scan for planted canary secrets |
| CLM-PLAT-006 | Only signed, provenance-checked artifacts execute/update | Artifact-chain model | Unsigned/tampered/swapped artifact install attempts ⇒ refuse |

## 5. Probe safety law

Every probe class declares a safety profile: `read-only`, `state-mutating-synthetic`,
`destructive` (F-point execution), `load`. Enforcement is mechanical: production profiles reject
mutating+ unless synthetic namespace + owner signoff + window; all probes resolve base URLs from
allowlisted config; credentials are minted per-run and destroyed post-run; probe traffic carries
a run-id header where the protocol allows, enabling target-side auditing.

## 6. Mapping honesty (OWASP/CWE)

Findings map to OWASP API Security 2023 and CWE as *classifications*, never as proof of coverage.
The report states verbatim: "Classification is not coverage: an unmapped finding class is a scope
gap, and a mapped class without a claim is decoration." Scanner imports (Semgrep/CodeQL/SARIF/OSV)
land as HYPOTHESES — promoted to FINDING only with executed evidence (probe/model), demoted to
INFORMATIONAL otherwise.

## 7. What the layer refuses to claim

- Absence of 0-days, side channels, covert timing channels, or cryptographic primitive breaks.
- Security of anything outside the executed claim set. The report's residual section lists
  *surfaces never attacked* by name — anonymous FTPs of the assurance world are not hidden.
- Anything about frontend/UI security (XSS in the browser DOM, client storage) beyond explicitly
  scoped claims — same boundary discipline as the correctness core.
