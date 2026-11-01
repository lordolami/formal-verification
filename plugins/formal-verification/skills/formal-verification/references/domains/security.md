# Domain: security — adversaries, isolation, privileged boundaries

This domain is the difference between *"the happy path is correct"* and *"an attacker cannot break
it"*. Correctness domains (api, auth, database, sync…) model a cooperative world: crashes,
retries, duplicates. This domain puts an adversary inside the model and probes against the real
system. Full method in the repo-root `SECURITY.md`; claim catalog (36 claims) in `MASTER-SPEC.md §9`.

## What to extract from the code (threat model first)

Answer six questions per system before modeling (MASTER-SPEC Stage 3):

1. **Harm** — what outcome is intolerable? (cross-tenant disclosure, privilege escalation,
   acknowledged-write loss, silent double-effect, unrecoverable corruption, audit erasure)
2. **Adversary** — which class attempts it? (ladder below)
3. **Surface** — which entry points reach the asset? (HTTP, batch, realtime/subscriptions,
   file/derivative serving, SQL gateways, replication endpoints, imports, hooks/jobs, CLI)
4. **Choke** — which single control must hold? (credential→tenant resolution, rule evaluator,
   generation check, fencing token, manifest hash, idempotency guard)
5. **Tripwire** — what claim + invariant + probe proves the choke held?
6. **Residuals** — what stays uncovered? (timing/covert channels, TCB compromise, spec error)

A surface with a harm and no choke is a finding at scoping time — before any model exists.

## Adversary ladder (declare per model which classes are exercised)

| Class | Actor | Controls |
|---|---|---|
| A0 | Anonymous | Public surface, unlimited request crafting, no credentials |
| A1 | Authenticated low-privilege user | Own credentials; BOLA, mass assignment, filter/expansion injection, realtime snooping |
| A2 | Tenant/app administrator | App-level config; attempts cross-tenant and instance-operator escalation |
| A3 | Malicious tenant workload | Trusted extension surface (hooks/jobs) inside one tenant; attempts host/peer escape |
| A4 | Compromised component | One replica/queue/worker with valid component credentials; equivocate, delay, duplicate, reorder |
| A5 | Malicious/compromised peer | Replication peer; poisoned frames, generation confusion, stale-cursor resurrection |
| A6 | Supply-chain / operator insider | Build/artifact/update channel, backup media, support access; provenance forgery, rollback injection |

A model exercising only A0 may not support a claim whose threat analysis names A2.

## How to model it

- **Decision duplication.** Every safety invariant re-states the guard's safety condition
  independently of the guard (opposite polarity or a different formulation). Identical text
  restated proves nothing; a mutated guard must be able to diverge from the invariant.
- **Ledgers.** Granted foreign accesses, below-floor grants, stale acceptances, cross-tenant reads
  are *state*, counted at the grant point with an independently-phrased condition.
- **Hints are attacker data.** Tenant/app/context selectors from the client are modeled as
  uninterpreted adversary input that the choke never consults for authorization.
- **Hyperproperties.** Tenant isolation, replica equivalence, and error-shape indistinguishability
  are two-trace claims. Model the single-trace choke here; execute the differential form with
  `fv-probe` (dual-tenant campaign). Never mark a hyper claim SUPPORTED on model evidence alone.

Starter models: `tenant_isolation.qnt` (CLM-ISO-001), `privileged_boundary.qnt` (CLM-AUTHZ-008),
plus the security-relevant parts of `token_lifecycle.qnt` (CLM-AUTHZ-002/003) and
`file_publish.qnt` (CLM-ISO-005).

## Invariants (adapt names to the system)

- `noCrossTenantRead` / `noCrossTenantWrite` — foreign grants ledger stays empty.
- `hintsNeverAuthorize` — forged context hints never produce a grant.
- `noEscalation` — no grant below a surface's authority floor, on any surface.
- `revokedHasNoSession` — revocation terminates live sessions, not just future grants.
- `protectedNeverLeaks` — protected originals *and derivatives* deny unauthorized serve.
- `errorsDoNotDistinguish` — foreign-existent vs nonexistent objects yield identical error shape
  (probe-executed; models approximate with a constant error function).

## Negative controls (must FAIL in isolation)

- Foreign read granted with a forged tenant hint.
- Record credential accepted by the SQL gateway / replication endpoint.
- Revoked credential opens a session; rotated-away credential still works.
- Protected thumbnail served anonymously; deleted file resurrected via derivative.
- These controls are also the fv-mutate targets: the mutator weakens each guard in a *copy* and
  requires the suite to kill the mutant. A survivor means the property is decoration.

## Conformance checks to generate (fv-probe)

- Route×actor authorization matrix incl. batch, realtime-subscribe, and privileged surfaces.
- BOLA swap: every id-bearing route replayed with the other tenant's credentials (dual-tenant).
- Revocation race: revoke, then immediately use on every surface; measure the propagation window
  and compare to the documented bound.
- Mass-assignment fuzz: inject owner/role/tenant/privileged fields into every create/update.
- Existence-oracle: foreign-existent vs nonexistent ids compared on status, body class, timing.
- Artifact chain: unsigned/tampered backup or update artifact install attempts must refuse.

## Fault schedule (attach to durability/security claims)

F1 kill-before-commit · F2 kill-after-commit-before-ack · F3 kill-after-ack-before-response ·
F4 duplicate delivery · F5 reorder/delay · F6 partition · F7 clock skew · F8 disk-full at each
staged boundary · F9 torn artifact · F10 dependency error · F11 dependency successful-lie ·
F12 rollback across acknowledged state. A claim lists which F-points were actually executed.
