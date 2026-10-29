# Domain: concurrency

## What to extract from the code

Shared mutable state, lock/lease/mutex usage, compare-and-swap sites, atomicity boundaries, cancellation paths, and what happens when two actors touch the same record, counter, balance, or queue position.

## How to model it

State: the shared resource, per-actor intents, lock holder (if any), cancellation flags. Actions: `acquire`, `release`, `cancel` (effect must vanish unless explicitly committed), `contend` (two actors attempt the same transition in one step — model the interleaving, not just the outcome).

## Invariants

- `mutualExclusion` — no two actors hold the same lock/lease simultaneously.
- `cancelledHasNoEffect` — cancelled work leaves no visible state unless the system explicitly defines commit-on-cancel (in which case model that rule and its bounds).
- `noLostUpdates` — concurrent writes to one record resolve to exactly one defined outcome (last-writer-wins with a defined clock, merge with defined rules, or conflict error) — never silent loss of one write.

## Negative controls (must FAIL in isolation)

- Two holders of one lock.
- Cancelled write visible in reads.
- Two concurrent increments net to one.

## Conformance checks to generate

Hammer the same record from N concurrent clients; cancel mid-write at every await point; acquire → expire → re-acquire lease races. Count effects: exactly-once means exactly one, and the test must be able to see two.
