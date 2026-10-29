# Domain: jobs, queues, retries

## What to extract from the code

Queue topology, visibility timeouts, lease durations, retry policies (counts, backoff, dead-letter rules), worker crash behavior between effect and ack, poison-message handling, and exactly what "delivered" vs "processed" vs "acknowledged" mean in this system.

## How to model it

State: queue contents, in-flight leases with expiry, attempt counts, effect log, dead-letter set. Actions: `enqueue`, `lease` (visibility timeout starts), `attempt`, `succeed` (effect applies once — guard on already-committed, as the fixed starter shows), `failRetry` (requeue with backoff), `failDead` (dead-letter with reason), `leaseExpire` (message becomes visible again, attempt count kept), `crashBetweenEffectAndAck` (effect applied, ack lost — redelivery must deduplicate).

Starter model: `assets/models/idempotent_job.qnt` — note its history: the first version allowed `succeed` to re-fire after commit and simulation caught the double-effect. That is the harness working as intended. Extend with leases, backoff, and dead-letter for real systems.

## Invariants

- `effectsAtMostOnce` — without explicit at-least-once-plus-dedup downstream, no effect applies twice.
- `noEffectWithoutCommit` — zero effects exist for work never committed.
- `expiredLeasesRedriven` — an expired lease returns its message to visible state; messages never vanish silently.
- `poisonSurfaced` — messages exceeding max attempts land in dead-letter with their reason, never loop forever and never disappear.

## Negative controls (must FAIL in isolation)

- Redelivery after success applies the effect again.
- Expired lease deletes the message.
- Poison message loops without dead-lettering.

## Conformance checks to generate

Kill the worker between effect and ack (redelivery deduplicates); expire a lease mid-processing (no double execution); flood with poison (dead-letters with reasons, queue keeps moving); verify attempt counts and backoff timing against the policy.
