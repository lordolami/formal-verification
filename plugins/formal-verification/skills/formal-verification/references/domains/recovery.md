# Domain: backup and recovery

## What to extract from the code

Backup triggers and scheduling, quiesce/freeze points, manifest contents (what is listed, hashed, and verified), encryption and key references, retention and deletion rules, restore paths (same-generation vs new-generation), rollback windows, and the exact crash behavior at every publication boundary.

## How to model it

State: live data with generation marker, staged backup with manifest, published archive with hashes, restore target with new generation, rollback snapshot with expiry. Actions: `quiesce`, `stageBackup`, `publishBackup` (manifest verified before publish — bad hashes fail the publish, never ship), `crashBeforePublish` (live data untouched, staging discarded or resumable), `crashAfterPublish` (restore completes the published state), `restoreToNewGeneration` (old cursors, tokens, and replicas bound to the prior generation stop working with explicit errors), `rollback` (only within the window, only over unacknowledged writes — acknowledged writes are never discarded by rollback).

## Invariants

- `restoreChangesGeneration` — every restore publishes a new generation; nothing silently reuses the old one.
- `preCutoverCrashKeepsOld` — a crash before the cutover marker leaves the old active data serving.
- `postCutoverCrashCompletesNew` — a crash after the marker completes the new state on recovery, never half-either.
- `rollbackNeverDiscardsAcked` — rollback cannot remove acknowledged writes; attempting it fails loudly.

## Negative controls (must FAIL in isolation)

- Old snapshot restored over newer acknowledged writes.
- Restore reuses the prior generation (stale cursors silently work).
- Rollback after the window discards user data.

## Conformance checks to generate

Kill at every stage boundary (before intent, after intent, after staging, before publish, after publish, before first write on restored data); corrupt an archive entry (restore refuses with the entry named); lose the key (unrecoverable stated plainly, never partially decrypted); fill the disk mid-backup (clean failure, live data untouched); restore then verify every record, file hash, and index against the manifest.
