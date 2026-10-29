# Domain: distributed systems

## What to extract from the code

Membership, leader election or coordination mechanism, terms/epochs/generations, quorum rules, message paths (what can be lost, duplicated, reordered, delayed), lease and timeout values, partition handling, replica lag behavior, and what happens when a minority or majority is unreachable.

## How to model it

State: node set, per-node role, current term/epoch, log or version vector, partition map. Actions: `elect`, `resign`/`stepDown`, `partition` (split the network), `heal`, `messageLoss`, `messageDuplicate`, `messageReorder`, `timeout`, `commitEntry` (only with quorum — model the quorum check explicitly, never assume it).

Starter model: `assets/models/leader_election.qnt` — extend with logs, quorum commits, and partitions for real systems.

## Invariants

- `atMostOneLeaderPerTerm` — no two nodes consider themselves leader of the same term.
- `epochsAdvanceMonotonically` — terms/epochs never go backward on any node.
- `committedSurvivesMinorityFailure` — quorum-committed entries remain committed after any minority loss.
- `noSplitBrainCommit` — no two partitions commit conflicting entries for the same slot.

## Negative controls (must FAIL in isolation)

- Two leaders in one term both commit.
- Committed entry lost after minority failure.
- Stale leader (old term) commits after a new election.

## Conformance checks to generate

Partition → write on each side → heal (conflict surfaces explicitly, never silent merge); kill leader mid-commit (entry either commits on quorum or rolls back visibly); clock-skew lease expiry (no two holders of one lease); old-term message arrives late (ignored, never applied).
