# Domain: auth, sessions, tokens

## What to extract from the code

Credential types (passwords, API keys, OAuth tokens, session cookies, service credentials), issuance paths, verification paths, expiry and rotation rules, revocation paths and their propagation delay, scope/role bindings, and what happens to in-flight requests when revocation lands.

## How to model it

State: `issued` set, `revoked` set, per-token expiry, session count or session table. Actions: `issue`, `use` (grants only when issued, unexpired, unrevoked), `revoke`, `expire`, `rotate` (new credential valid, old invalid from that step). Always model `useAfterRevoke` and `useExpired` as explicit actions that must grant nothing.

Starter model: `assets/models/token_lifecycle.qnt` — extend it with expiry timestamps and scopes for real systems.

## Invariants

- `revokedNeverValid` — a revoked token grants nothing, in every state reachable after revocation.
- `expiredNeverValid` — an expired token grants nothing.
- `unknownNeverValid` — a never-issued token grants nothing.
- `rotationInvalidatesOld` — after rotation, the old credential grants nothing.
- `sessionsBoundToSubject` — sessions reference the issuing subject; no session exists without a valid issuance chain.

## Negative controls (must FAIL in isolation)

- Use-after-revoke succeeds.
- Expired token succeeds.
- Old credential works after rotation.
- Session exists for a never-issued token.

## Conformance checks to generate

Issue → use → revoke → use (must deny); issue → expire → use (must deny); rotate → old-use (must deny) → new-use (must allow). Measure revocation propagation: revoke, then immediately use on every replica/listener — record the window in which the old token still works, and check it against the documented bound (default expectation: 5 seconds; anything longer is a finding).
