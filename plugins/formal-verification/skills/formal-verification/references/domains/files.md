# Domain: files and storage

## What to extract from the code

Upload paths (multipart, resumable, direct-to-object-store), staging areas, hash verification, finalization/atomic-publish, thumbnail/derivative pipelines, access-token binding, deletion and tombstone handling, remote-object (S3-style) failure modes, and quota/expiry behavior.

## How to model it

State: staged blobs with hashes, finalized objects with generations, derivative artifacts with provenance links, deletion tombstones, outstanding multipart sessions. Actions: `stage`, `verifyHash` (mismatch → reject, staged bytes discarded), `finalize` (idempotent — same content hash finalizes once), `serve` (only finalized objects; protected objects only with valid token), `delete` (tombstone published; serves stop for that generation), `remoteOutage` (remote bytes unavailable → serve degrades to explicit missing, never to stale-or-partial success), `thumbnailDerive` (from verified originals only).

## Invariants

- `incompleteNeverServed` — staged-but-unfinalized bytes are never served as successful downloads.
- `protectedNeverLeaksViaDerivatives` — thumbnails and derived artifacts carry the source's protection; no public cache of protected content.
- `deletedStaysDeleted` — reads after delete fail for that generation; no stale cache resurrects bytes.
- `hashMismatchRejected` — content whose hash does not match its manifest is rejected before finalization.

## Negative controls (must FAIL in isolation)

- Partial upload served as complete.
- Protected original reachable through a public thumbnail URL.
- Deleted file served from cache.
- Corrupted bytes finalized.

## Conformance checks to generate

Interrupt uploads at every chunk boundary (resume or clean restart, never partial success); flip hashes mid-upload (rejected); delete then read through every cache layer; revoke the token then use old URLs (bounded expiry honored); simulate remote-object outage during serve and restore.
