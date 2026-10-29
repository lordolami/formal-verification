# Domain: sync and replication

## What to extract from the code

Sync protocol (snapshot/bootstrap, deltas, cursors, acks), conflict detection and resolution rules, file/blob staging, generation/epoch handling, what triggers full re-bootstrap, retention and expiry of sync state, and offline behavior (what the client may do while disconnected and what must wait).

## How to model it

State: server version vector or sequence, per-client cursor, pending client mutations with base versions, staged files, generation marker. Actions: `bootstrap` (snapshot at a boundary), `push` (mutation group with base versions — accept or conflict per group), `pull` (delta since cursor), `ack` (client confirms durable local apply — only after actual local commit), `conflict` (base mismatch → defined resolution: reject, merge with rules, or escalate — never silent overwrite), `generationChange` (all old cursors invalid, re-bootstrap required), `clientCrash` (pending mutations survive, unacked pulls resume).

## Invariants

- `ackedIsDurable` — acknowledged data is durably applied on both sides.
- `conflictsNeverSilent` — conflicting writes surface as conflicts with both versions visible, never auto-merge by discarding one side.
- `generationInvalidatesCursors` — after a generation change, no old cursor resumes; re-bootstrap is required.
- `unackedResumes` — unacknowledged work resumes after crash, never assumed complete.

## Negative controls (must FAIL in isolation)

- Ack before local commit, then crash, then data present.
- Stale cursor resumes across a generation change.
- Conflicting writes merge with one side's data lost.

## Conformance checks to generate

Push conflicting groups (conflict reported with both versions); kill client between pull and ack (resume replays, no gaps, no duplicates); rotate generation mid-sync (old cursors rejected, re-bootstrap clean); go offline, mutate, reconnect (pending preserved, ordering defined).
